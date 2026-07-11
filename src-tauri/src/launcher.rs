use anyhow::Result;
use tokio::fs;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::io::AsyncWriteExt;
use crate::versions::{Library, MinecraftVersion, VersionManifest};
use reqwest;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;

pub struct MinecraftLauncher {
    pub config: LauncherConfig,
}

impl MinecraftLauncher {
    pub fn new() -> Result<Self> {
        Ok(Self { config: LauncherConfig::new()? })
    }

    // Find Java executable in common locations
    pub fn find_java(&self) -> Result<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            if let Ok(output) = Command::new("java")
                .arg("-version")
                .creation_flags(0x08000000)
                .output() {
                if output.status.success() {
                    return Ok(PathBuf::from("java"));
                }
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
        if let Ok(output) = Command::new("java").arg("-version").output() {
            if output.status.success() {
                return Ok(PathBuf::from("java"));
                }
            }
        }
        let common_paths = vec![
            "C:\\Program Files\\Java\\jdk-8\\bin\\java.exe",
            "C:\\Program Files\\Java\\jdk-11\\bin\\java.exe",
            "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
            "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",
            "C:\\Program Files\\Java\\jdk-25\\bin\\java.exe",
        ];
        for path in common_paths {
            if Path::new(path).exists() {
                return Ok(PathBuf::from(path));
            }
        }
        anyhow::bail!("Java not found")
    }

    pub async fn build_classpath(&self, version: &str) -> Result<String> {
        let version_dir = self.config.versions_dir.join(version);
        let version_file = version_dir.join(format!("{}.json", version));
        let version_data = fs::read_to_string(&version_file).await?;
        #[derive(serde::Deserialize)]
        struct VersionJson {
            libraries: Vec<Library>,
        }
        let version_json: VersionJson = serde_json::from_str(&version_data)?;
        let os_name = "windows";
        let mut classpath = Vec::new();
        for lib in &version_json.libraries {
            if !crate::versions::is_library_allowed(lib, os_name) { continue; }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let lib_path = self.config.libraries_dir.join(&artifact.path);
                    classpath.push(lib_path);
                }
            }
        }
        let jar_path = version_dir.join(format!("{}.jar", version));
        classpath.push(jar_path);
        let cp = classpath.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(";");
        Ok(cp)
    }

    pub async fn get_available_versions(&self) -> Result<Vec<MinecraftVersion>> {
        let url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        match client.get(url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    let text = response.text().await?;
                    match serde_json::from_str::<VersionManifest>(&text) {
                        Ok(manifest) => {
                            let release_versions: Vec<MinecraftVersion> = manifest
                                .versions
                                .into_iter()
                                .filter(|v| v.version_type == "release")
                                .collect();
                            Ok(release_versions)
                        }
                        Err(e) => Err(e.into())
                    }
                } else {
                    Err(anyhow::anyhow!("API error: {}", response.status()))
                }
            }
            Err(e) => Err(e.into())
        }
    }

    pub async fn download_version(&self, version: &MinecraftVersion) -> Result<()> {
        let version_dir = self.config.versions_dir.join(&version.id);
        fs::create_dir_all(&version_dir).await?;
        let natives_dir = version_dir.join("natives");
        fs::create_dir_all(&natives_dir).await?;

        let version_response = reqwest::get(&version.url).await?;
        let version_data = version_response.text().await?;
        let version_file = version_dir.join(format!("{}.json", version.id));
        fs::write(&version_file, &version_data).await?;

        // Parse version JSON and download client.jar
        #[derive(serde::Deserialize)]
        struct VersionJson {
            downloads: VersionJsonDownloads,
            libraries: Vec<Library>,
            #[serde(rename = "assetIndex")]
            asset_index: Option<AssetIndex>,
        }
        #[derive(serde::Deserialize)]
        struct VersionJsonDownloads {
            client: Option<DownloadInfo>,
        }
        #[derive(serde::Deserialize)]
        struct DownloadInfo {
            url: String,
        }
        #[derive(serde::Deserialize)]
        struct AssetIndex {
            id: String,
            url: String,
        }

        let version_json: VersionJson = serde_json::from_str(&version_data)?;
        if let Some(client) = version_json.downloads.client {
            let jar_url = client.url;
            let jar_path = version_dir.join(format!("{}.jar", version.id));
            let resp = reqwest::get(&jar_url).await?;
            let bytes = resp.bytes().await?.to_vec();
            let mut out = File::create(&jar_path)?;
            out.write_all(&bytes)?;
        }

        let os_name = "windows";
        for lib in &version_json.libraries {
            if !crate::versions::is_library_allowed(lib, os_name) { continue; }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let lib_path = self.config.libraries_dir.join(&artifact.path);
                    if !lib_path.exists() {
                        if let Some(parent) = lib_path.parent() {
                            fs::create_dir_all(parent).await?;
                        }
                        let resp = reqwest::get(&artifact.url).await?;
                        let bytes = resp.bytes().await?.to_vec();
                        let mut out = File::create(&lib_path)?;
                        out.write_all(&bytes)?;
                    }
                }
            }
        }

        // Download assets if asset index is present
        if let Some(asset_index) = &version_json.asset_index {
            let indexes_dir = self.config.assets_dir.join("indexes");
            fs::create_dir_all(&indexes_dir).await?;
            let index_path = indexes_dir.join(format!("{}.json", asset_index.id));

            let resp = reqwest::get(&asset_index.url).await?;
            let bytes = resp.bytes().await?.to_vec();
            let mut out = File::create(&index_path)?;
            out.write_all(&bytes)?;

            let index_data = String::from_utf8(bytes)?;
            #[derive(serde::Deserialize)]
            struct AssetIndexJson {
                objects: HashMap<String, AssetObject>,
            }
            #[derive(serde::Deserialize, Clone)]
            struct AssetObject {
                hash: String,
            }

            let asset_index_json: AssetIndexJson = serde_json::from_str(&index_data)?;

            let mut missing_assets = Vec::new();
            for (_key, obj) in &asset_index_json.objects {
                let hash_prefix = &obj.hash[0..2];
                let object_dir = self.config.assets_dir.join("objects").join(hash_prefix);
                let object_path = object_dir.join(&obj.hash);
                if !object_path.exists() {
                    missing_assets.push(obj.clone());
                }
            }

            if !missing_assets.is_empty() {
                let client = reqwest::Client::new();
                for chunk in missing_assets.chunks(50) {
                    let mut tasks = Vec::new();
                    for obj in chunk {
                        let hash_prefix = &obj.hash[0..2];
                        let object_dir = self.config.assets_dir.join("objects").join(hash_prefix);
                        fs::create_dir_all(&object_dir).await?;
                        let object_path = object_dir.join(&obj.hash);
                        let object_url = format!("https://resources.download.minecraft.net/{}/{}", hash_prefix, obj.hash);

                        let client_clone = client.clone();
                        let task = tokio::spawn(async move {
                            match client_clone.get(&object_url).send().await {
                                Ok(resp) => {
                                    match resp.bytes().await {
                                        Ok(bytes) => {
                                            match tokio::fs::File::create(&object_path).await {
                                                Ok(mut out) => {
                                                    match out.write_all(&bytes).await {
                                                        Ok(_) => Ok(()),
                                                        Err(e) => Err(anyhow::anyhow!("Write failed: {}", e))
                                                    }
                                                }
                                                Err(e) => Err(anyhow::anyhow!("File create failed: {}", e))
                                            }
                                        }
                                        Err(e) => Err(anyhow::anyhow!("Bytes failed: {}", e))
                                    }
                                }
                                Err(e) => Err(anyhow::anyhow!("Request failed: {}", e))
                            }
                        });
                        tasks.push(task);
                    }

                    for task in tasks {
                        if let Err(e) = task.await {
                            eprintln!("Asset download task failed: {}", e);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn launch_minecraft(
        &self,
        version: &str,
        username: &str,
        ram_mb: u32,
        access_token: Option<&str>,
        uuid: Option<&str>
    ) -> Result<()> {
        let java_path = self.find_java()?;
        let version_dir = self.config.versions_dir.join(version);
        let jar_path = version_dir.join(format!("{}.jar", version));
        let natives_dir = version_dir.join("natives");

        if !jar_path.exists() {
            return Err(anyhow::anyhow!("Version not downloaded"));
        }

        let classpath = self.build_classpath(version).await?;

        let mut command = Command::new(&java_path);
        command
            .arg(format!("-Xmx{}M", ram_mb))
            .arg(format!("-Xms{}M", ram_mb / 2))
            .arg(format!("-Djava.library.path={}", natives_dir.display()))
            .arg("-cp")
            .arg(classpath)
            .arg("net.minecraft.client.main.Main")
            .arg("--username")
            .arg(username)
            .arg("--version")
            .arg(version)
            .arg("--gameDir")
            .arg(&self.config.minecraft_dir)
            .arg("--assetsDir")
            .arg(&self.config.assets_dir);

        let version_file = version_dir.join(format!("{}.json", version));
        let version_data = fs::read_to_string(&version_file).await?;
        #[derive(serde::Deserialize)]
        struct VersionJson {
            #[serde(rename = "assetIndex")]
            asset_index: Option<AssetIndex>,
        }
        #[derive(serde::Deserialize)]
        struct AssetIndex {
            id: String,
        }
        let version_json: VersionJson = serde_json::from_str(&version_data)?;
        if let Some(asset_index) = version_json.asset_index {
            command.arg("--assetIndex").arg(asset_index.id);
        }
        command.arg("--accessToken").arg(access_token.unwrap_or("0"))
               .arg("--uuid").arg(uuid.unwrap_or("00000000-0000-0000-0000-000000000000"))
               .arg("--userType").arg("msa")
               .arg("--userProperties").arg("{}");

        // Launch Minecraft in detached mode
        let _child = command.spawn()?;
        Ok(())
    }
}

pub fn get_total_ram_mb() -> anyhow::Result<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = Command::new("wmic")
            .arg("OS")
            .arg("get")
            .arg("TotalVisibleMemorySize")
            .creation_flags(0x08000000)
            .output() {
        if output.status.success() {
            let stdout = String::from_utf8(output.stdout)?;
            for line in stdout.lines() {
                if let Ok(kb) = line.trim().parse::<u64>() {
                    return Ok((kb / 1024) as u32);
                }
            }
        }
    }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "linux")]
        {
            if let Ok(output) = Command::new("free").arg("-b").output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for line in stdout.lines() {
                        if line.starts_with("Mem:") {
                            if let Some(kb_str) = line.split_whitespace().nth(1) {
                                if let Ok(bytes) = kb_str.parse::<u64>() {
                                    return Ok((bytes / 1024 / 1024) as u32);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = Command::new("sysctl").arg("-n").arg("hw.memsize").output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Ok(bytes) = stdout.trim().parse::<u64>() {
                        return Ok((bytes / 1024 / 1024) as u32);
                    }
                }
            }
        }
    }
    
    Ok(4096)
}

pub fn get_required_java_version_for_minecraft(mc_version: &str) -> u8 {
    let version_parts: Vec<&str> = mc_version.split('.').collect();
    
    if version_parts.len() < 2 {
        return 8;
    }
    
    let major = version_parts.get(0).and_then(|v| v.parse::<u32>().ok()).unwrap_or(1);
    let minor = version_parts.get(1).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let patch = version_parts.get(2).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);

    // Minecraft 26+ 
    if major >= 26 || (major == 1 && minor >= 26) {
        return 25;
    }
    
    if major == 1 && (minor > 20 || (minor == 20 && patch >= 5)) {
        return 21;
    }
    
    if major == 1 && minor >= 18 && minor <= 20 {
        return 17;
    }
    
    if major == 1 && minor == 17 {
        return 16;
    }
    8
}

#[allow(dead_code)]
pub async fn find_java_executable() -> Result<String, String> {
    let common_paths = [
        "java",
        "/usr/bin/java",
        "/usr/local/bin/java",
        "C:\\Program Files\\Java\\bin\\java.exe",
        "C:\\Program Files (x86)\\Java\\bin\\java.exe",
    ];

    for path in &common_paths {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            if let Ok(output) = Command::new(path)
                .arg("-version")
                .creation_flags(0x08000000)
                .output() {
                if output.status.success() {
                    return Ok(path.to_string());
                }
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
        if let Ok(output) = Command::new(path).arg("-version").output() {
            if output.status.success() {
                return Ok(path.to_string());
                }
            }
        }
    }

    let java_path = get_java_path_from_env();
    if !java_path.is_empty() {
        return Ok(java_path);
    }

    // Si no se encuentra, intentar usar Java 8 como fallback desde runtime
    let kindly_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".kindlyklanklient");
    
    let java_8_path = kindly_dir.join("runtime").join("java-8").join("bin").join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
    
    if java_8_path.exists() {
        return Ok(java_8_path.to_string_lossy().to_string());
    }

    Err("Java executable not found. Please ensure Java is installed.".to_string())
}

/// Busca o instala automáticamente el ejecutable de Java para una versión específica de Minecraft
pub async fn find_or_install_java_for_minecraft(mc_version: &str) -> Result<String, String> {
    let required_java_version = get_required_java_version_for_minecraft(mc_version);
    
    // Verificar si ya existe la versión requerida en runtime
    let kindly_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".kindlyklanklient");
    
    let java_path = kindly_dir
        .join("runtime")
        .join(format!("java-{}", required_java_version))
        .join("bin")
        .join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
    
    if java_path.exists() {
        return Ok(java_path.to_string_lossy().to_string());
    }
    
    log::warn!("⚠️  Java {} no encontrado, se requiere para Minecraft {}", required_java_version, mc_version);
    log::info!("🔽 Descargando Java {} automáticamente...", required_java_version);
    
    download_java_silent(required_java_version).await?;
    
    if java_path.exists() {
        return Ok(java_path.to_string_lossy().to_string());
    }
    
    Err(format!(
        "Error al instalar Java {}. Por favor, intente instalarlo manualmente.",
        required_java_version
    ))
}

/// Descarga e instala Java sin interfaz de usuario
async fn download_java_silent(java_version: u8) -> Result<(), String> {
    let version_str = java_version.to_string();
    
    let kindly_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".kindlyklanklient");
    
    let runtime_dir = kindly_dir.join("runtime");
    let java_dir = runtime_dir.join(format!("java-{}", version_str));
    
    tokio::fs::create_dir_all(&runtime_dir).await
        .map_err(|e| format!("Failed to create runtime directory: {}", e))?;
    
    let (os, arch, extension) = if cfg!(target_os = "windows") {
        ("windows", "x64", "zip")
    } else if cfg!(target_os = "macos") {
        ("mac", "x64", "tar.gz")
    } else {
        ("linux", "x64", "tar.gz")
    };
    
    let jre_url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse",
        version_str, os, arch
    );
    
    log::info!("Downloading Java {} from: {}", version_str, jre_url);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&jre_url)
        .header("User-Agent", "KindlyKlanKlient/1.0")
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Failed to download Java: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to read Java download: {}", e))?;
    
    let temp_file = runtime_dir.join(format!("java-{}.{}", version_str, extension));
    tokio::fs::write(&temp_file, &bytes).await
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    
    if java_dir.exists() {
        let _ = std::fs::remove_dir_all(&java_dir);
    }
    
    if temp_file.extension().map_or(false, |e| e == "zip") {
        let reader = std::fs::File::open(&temp_file)
            .map_err(|e| format!("Open zip failed: {}", e))?;
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|e| format!("Read zip failed: {}", e))?;
        
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Zip index failed: {}", e))?;
            let outpath = runtime_dir.join(file.mangled_name());
            
            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Create dir failed: {}", e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p)
                        .map_err(|e| format!("Create parent failed: {}", e))?;
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Create file failed: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Write file failed: {}", e))?;
            }
        }
    }
    
    // Renombrar el directorio extraído al nombre esperado
    let all_entries = std::fs::read_dir(&runtime_dir)
        .map_err(|e| format!("Failed to read runtime directory: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read directory entries: {}", e))?;
    
    let extracted_dirs: Vec<_> = all_entries
        .into_iter()
        .filter(|entry| {
            let path = entry.path();
            path.is_dir() && path != java_dir
        })
        .map(|entry| entry.path())
        .collect();
    
    if let Some(extracted_dir) = extracted_dirs.first() {
        if java_dir.exists() {
            let _ = std::fs::remove_dir_all(&java_dir);
        }
        std::fs::rename(extracted_dir, &java_dir)
            .map_err(|e| format!("Failed to move Java directory: {}", e))?;
        
        for dir in extracted_dirs.iter().skip(1) {
            let _ = std::fs::remove_dir_all(dir);
        }
    } else {
        return Err("No Java directory found after extraction".to_string());
    }
    
    let _ = std::fs::remove_file(&temp_file);
    
    log::info!("Java {} installed successfully", version_str);
    Ok(())
}

#[allow(dead_code)]
fn get_java_path_from_env() -> String {
    std::env::var("JAVA_HOME")
        .map(|java_home| format!("{}/bin/java", java_home))
        .unwrap_or_else(|_| {
            let possible_paths = [
                ".kindlyklanklient/java/bin/java",
                "C:\\Users\\{username}\\.kindlyklanklient\\java\\bin\\java",
            ];

            for path in &possible_paths {
                if std::fs::metadata(path).is_ok() {
                    return path.to_string();
                }
            }

            String::new()
        })
}

pub fn build_minecraft_classpath_from_json(instance_dir: &Path, version_json_path: &Path) -> Result<String, String> {
    let json_content = std::fs::read_to_string(version_json_path)
        .map_err(|e| format!("Failed to read version JSON: {}", e))?;
    let version_info: serde_json::Value = serde_json::from_str(&json_content)
        .map_err(|e| format!("Failed to parse version JSON: {}", e))?;
    
    // Use HashMap to deduplicate by artifact (not by full path)
    // Key = "groupId:artifactId:classifier" to allow different versions but keep classifiers separate
    // This ensures Fabric's asm-9.9 overrides vanilla's asm-9.6, but lwjgl:natives-windows != lwjgl
    let mut jar_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let libs_dir = instance_dir.join("libraries");
    let classpath_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    
    // Check if this JSON inherits from another (e.g., NeoForge inherits from vanilla MC)
    if let Some(inherits_from) = version_info.get("inheritsFrom").and_then(|v| v.as_str()) {
        // Parse the base JSON first (e.g., 1.21.8.json) to get LWJGL and other base libraries
        let base_json_path = instance_dir
            .join("versions")
            .join(inherits_from)
            .join(format!("{}.json", inherits_from));
        
        if base_json_path.exists() {
            let base_json_content = std::fs::read_to_string(&base_json_path)
                .map_err(|e| format!("Failed to read base version JSON: {}", e))?;
            let base_version_info: serde_json::Value = serde_json::from_str(&base_json_content)
                .map_err(|e| format!("Failed to parse base version JSON: {}", e))?;
            
            // Parse libraries from base JSON
            if let Some(libraries) = base_version_info.get("libraries").and_then(|v| v.as_array()) {
                for lib in libraries {
                    add_library_to_classpath(lib, &libs_dir, &mut jar_map)?;
                }
            }
        }
    }
    
    // Parse libraries from the mod loader JSON (NeoForge/Forge/Fabric specific libraries)
    // These OVERRIDE base libraries with same artifact ID (e.g., asm-9.9 overrides asm-9.6)
    if let Some(libraries) = version_info.get("libraries").and_then(|v| v.as_array()) {
        for lib in libraries {
            add_library_to_classpath(lib, &libs_dir, &mut jar_map)?;
        }
    }
    
    // Add client JAR (from versions directory)
    // CRITICAL: NeoForge/Forge DON'T need the client JAR in classpath because BootstrapLauncher loads it specially
    // Only Fabric (and vanilla) need the client JAR in the classpath
    // Detect NeoForge/Forge by checking if mainClass is BootstrapLauncher
    let main_class = version_info.get("mainClass").and_then(|v| v.as_str()).unwrap_or("");
    let is_neoforge_or_forge = main_class.contains("bootstraplauncher.BootstrapLauncher");
    
    if !is_neoforge_or_forge {
        // For Fabric/Vanilla: Add the client JAR
        // For Fabric with inheritsFrom, use the vanilla MC client JAR (inheritsFrom value)
        // Example: Fabric JSON has id="fabric-loader-0.17.3-1.21.8" and inheritsFrom="1.21.8"
        //          The client JAR is at versions/1.21.8/1.21.8.jar
        let client_version = version_info.get("inheritsFrom")
            .and_then(|v| v.as_str())
            .or_else(|| version_info.get("id").and_then(|v| v.as_str()))
            .ok_or("Version ID not found in JSON")?;
        
        let client_jar = instance_dir.join("versions").join(client_version).join(format!("{}.jar", client_version));
        if client_jar.exists() {
            let normalized = dunce::canonicalize(&client_jar)
                .unwrap_or(client_jar.clone());
            let normalized_str = if cfg!(target_os = "windows") {
                normalized.to_string_lossy()
                    .strip_prefix("\\\\?\\").unwrap_or(&normalized.to_string_lossy())
                    .replace("/", "\\")
            } else {
                normalized.to_string_lossy().to_string()
            };
            jar_map.insert("minecraft:client".to_string(), normalized_str);
        }
    }
    
    if jar_map.is_empty() {
        return Err("No jars found for classpath".to_string());
    }
    
    // Convert HashMap values to Vec
    let mut jars: Vec<String> = jar_map.into_values().collect();
    
    // Add mods from mods directory (for remote instances that might not have complete metadata)
    let mods_dir = instance_dir.join("mods");
    if mods_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |e| e == "jar") {
                    if let Ok(normalized) = dunce::canonicalize(&path) {
                        let normalized_str = if cfg!(target_os = "windows") {
                            normalized.to_string_lossy()
                                .strip_prefix("\\\\?\\").unwrap_or(&normalized.to_string_lossy())
                                .replace("/", "\\")
                        } else {
                            normalized.to_string_lossy().to_string()
                        };
                        jars.push(normalized_str);
                    }
                }
            }
        }
    }
    
    Ok(jars.join(classpath_separator))
}

/// Helper function to add a library to the classpath, respecting `include_in_classpath`
/// Uses HashMap with key = "groupId:artifactId:classifier" for proper deduplication
/// This allows Fabric's asm-9.9 to override vanilla's asm-9.6, while keeping lwjgl:natives-windows separate
fn add_library_to_classpath(lib: &serde_json::Value, libs_dir: &Path, jars: &mut std::collections::HashMap<String, String>) -> Result<(), String> {
    // Check `include_in_classpath` field (default true if not present)
    let include_in_classpath = lib.get("include_in_classpath")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    
    if !include_in_classpath {
        return Ok(());
    }
    
    // Get library name (Maven coordinates: groupId:artifactId:version[:classifier][:extension])
    if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
        // Extract key = "groupId:artifactId:classifier" (without version)
        // Examples:
        //   "org.ow2.asm:asm:9.6" -> key = "org.ow2.asm:asm"
        //   "org.lwjgl:lwjgl-tinyfd:3.3.1:natives-windows" -> key = "org.lwjgl:lwjgl-tinyfd:natives-windows"
        let parts: Vec<&str> = name.split(':').collect();
        let key = if parts.len() >= 4 {
            // Has classifier: groupId:artifactId:classifier
            format!("{}:{}:{}", parts[0], parts[1], parts[3])
        } else if parts.len() >= 2 {
            // No classifier: groupId:artifactId
            format!("{}:{}", parts[0], parts[1])
        } else {
            // Invalid format, use full name as key
            name.to_string()
        };
        
        // Check if library has downloads.artifact (main JAR)
        if let Some(artifact) = lib.get("downloads")
            .and_then(|d| d.get("artifact"))
            .and_then(|a| a.get("path"))
            .and_then(|p| p.as_str())
        {
            // Use the path from JSON (already in correct format)
            let full_path = libs_dir.join(artifact);
            if full_path.exists() {
                let normalized = dunce::canonicalize(&full_path)
                    .unwrap_or(full_path.clone());
                let normalized_str = if cfg!(target_os = "windows") {
                    normalized.to_string_lossy()
                        .strip_prefix("\\\\?\\").unwrap_or(&normalized.to_string_lossy())
                        .replace("/", "\\")
                } else {
                    normalized.to_string_lossy().to_string()
                };
                jars.insert(key, normalized_str);
            }
        } else {
            // Fallback: Convert Maven coordinates to path
            let lib_path = maven_to_path(name)?;
            let full_path = libs_dir.join(&lib_path);
            
            if full_path.exists() {
                let normalized = dunce::canonicalize(&full_path)
                    .unwrap_or(full_path.clone());
                let normalized_str = if cfg!(target_os = "windows") {
                    normalized.to_string_lossy()
                        .strip_prefix("\\\\?\\").unwrap_or(&normalized.to_string_lossy())
                        .replace("/", "\\")
                } else {
                    normalized.to_string_lossy().to_string()
                };
                jars.insert(key, normalized_str);
            }
        }
    }
    
    Ok(())
}

/// Converts Maven coordinates to file path
/// Example: org.example:artifact:1.0 -> org/example/artifact/1.0/artifact-1.0.jar
fn maven_to_path(maven_coords: &str) -> Result<String, String> {
    let parts: Vec<&str> = maven_coords.split(':').collect();
    if parts.len() < 3 {
        return Err(format!("Invalid Maven coordinates: {}", maven_coords));
    }
    
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = if parts.len() > 3 { format!("-{}", parts[3]) } else { String::new() };
    
    Ok(format!("{}/{}/{}/{}-{}{}.jar", group, artifact, version, artifact, version, classifier))
}

/// Legacy function for backward compatibility - DO NOT USE FOR NEW CODE
#[allow(dead_code)]
pub fn build_minecraft_classpath(instance_dir: &Path) -> Result<String, String> {
	build_minecraft_classpath_excluding(instance_dir, &std::collections::HashSet::new())
}

/// Legacy function for backward compatibility - DO NOT USE FOR NEW CODE
#[allow(dead_code)]
pub fn build_minecraft_classpath_excluding(instance_dir: &Path, exclude_jars: &std::collections::HashSet<String>) -> Result<String, String> {
	let mut jars: Vec<String> = Vec::new();
	
	let libs_dir = instance_dir.join("libraries");
	if libs_dir.exists() { collect_jars_recursively_excluding(&libs_dir, &mut jars, exclude_jars)?; }
	let versions_dir = instance_dir.join("versions");
	if versions_dir.exists() { collect_jars_recursively_excluding(&versions_dir, &mut jars, exclude_jars)?; }
	let mods_dir = instance_dir.join("mods");
	if mods_dir.exists() { collect_jars_recursively_excluding(&mods_dir, &mut jars, exclude_jars)?; }
	if jars.is_empty() { return Err("No jars found for classpath".to_string()); }
	
	Ok(jars.join(if cfg!(target_os = "windows") { ";" } else { ":" }))
}


#[allow(dead_code)]
fn collect_jars_recursively_excluding(dir: &Path, out: &mut Vec<String>, exclude_jars: &std::collections::HashSet<String>) -> Result<(), String> {
	for entry in walkdir::WalkDir::new(dir) {
		let entry = entry.map_err(|e| e.to_string())?;
		if entry.file_type().is_file() {
			let p = entry.into_path();
			if p.extension().map_or(false, |e| e == "jar") {
				// Normalizar la ruta para comparar con exclude_jars
				let canonical_opt = p.canonicalize().ok();
				let canonical_str = canonical_opt.as_ref()
					.map(|c| c.to_string_lossy().to_string());
				let path_str = p.to_string_lossy().to_string();
				
				// Remover prefijo \\?\ de Windows si está presente
				let canonical_clean = canonical_str.as_ref()
					.map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).to_string());
				let path_clean = path_str.strip_prefix("\\\\?\\").unwrap_or(&path_str).to_string();
				
				// Normalizar separadores de ruta para comparación
				let normalized_canonical = canonical_clean.as_ref()
					.map(|s| s.replace("\\", "/"));
				let normalized_path = path_clean.replace("\\", "/");
				
				// Verificar si está excluido (comparar con todas las variantes posibles)
				let is_excluded = {
					let mut excluded = false;
					if let Some(ref canonical) = canonical_str {
						excluded = excluded || exclude_jars.contains(canonical);
					}
					if let Some(ref canonical_clean_str) = canonical_clean {
						excluded = excluded || exclude_jars.contains(canonical_clean_str);
					}
					excluded = excluded || exclude_jars.contains(&path_str);
					excluded = excluded || exclude_jars.contains(&path_clean);
					if let Some(ref norm_canonical) = normalized_canonical {
						excluded = excluded || exclude_jars.contains(norm_canonical);
					}
					excluded = excluded || exclude_jars.contains(&normalized_path);
					excluded
				};
				
				if !is_excluded {
					// Usar dunce::canonicalize para normalizar el path correctamente en Windows
					// Esto convierte automáticamente separadores a \ y remueve el prefijo \\?\
					let normalized_path = dunce::canonicalize(&p)
						.unwrap_or_else(|_| p.clone())
						.to_string_lossy()
						.to_string();
					
					out.push(normalized_path);
				}
			}
		}
	}
	Ok(())
}


pub fn select_main_class(instance_dir: &Path, version_id: Option<&str>) -> String {
    if let Some(vid) = version_id {
        let versions_dir = instance_dir.join("versions");
        let json_path = versions_dir.join(vid).join(format!("{}.json", vid));
        
        if json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(main_class) = json.get("mainClass").and_then(|v| v.as_str()) {
                        return main_class.to_string();
                    }
                }
            }
        }
    }
    let versions_dir = instance_dir.join("versions");
    if versions_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name();
                    let json_path = path.join(format!("{}.json", dir_name.to_string_lossy()));
                    
                    if json_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&json_path) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let Some(main_class) = json.get("mainClass").and_then(|v| v.as_str()) {
                                    if main_class.contains("neoforge") || main_class.contains("neoforged") {
                                        return main_class.to_string();
                                    } else if main_class.contains("minecraftforge") || main_class.contains("forge") {
                                        return main_class.to_string();
                                    } else if main_class.contains("fabricmc") || main_class.contains("fabric") {
                                        return main_class.to_string();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    let neoforge_loader_dir = instance_dir.join("libraries").join("net").join("neoforged");
    if neoforge_loader_dir.exists() { 
        return "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string(); 
    }
    
    let forge_loader_dir = instance_dir.join("libraries").join("net").join("minecraftforge");
    if forge_loader_dir.exists() { 
        return "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string();
    }
    
	let fabric_loader_dir = instance_dir.join("libraries").join("net").join("fabricmc");
    if fabric_loader_dir.exists() { 
        return "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string();
    }
    
    "net.minecraft.client.main.Main".to_string()
}

pub fn get_mod_loader_jvm_args(instance_dir: &Path, version_id: Option<&str>, mod_loader_type: Option<&str>, _mod_loader_version: Option<&str>) -> Vec<String> {
    let mut additional_args = Vec::new();
    let loader_type = mod_loader_type;
    
    let selected_json = if let Some(vid) = version_id {
        let versions_dir = instance_dir.join("versions");
        let json_path = versions_dir.join(vid).join(format!("{}.json", vid));
        
        if json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    Some((json_path, json))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    
    let selected_json = selected_json.or_else(|| {
        let versions_dir = instance_dir.join("versions");
        if !versions_dir.exists() {
            return None;
        }
        
        let mut candidate_json: Option<(std::path::PathBuf, serde_json::Value)> = None;
        let mut fallback_json: Option<(std::path::PathBuf, serde_json::Value)> = None;
        
        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name();
                    let dir_name_str = dir_name.to_string_lossy();
                    let json_path = path.join(format!("{}.json", dir_name_str));
                    
                    if json_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&json_path) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                let is_mod_loader = json.get("mainClass")
                                    .and_then(|v| v.as_str())
                                    .map(|mc| mc.contains("forge") || mc.contains("neoforge") || mc.contains("fabric"))
                                    .unwrap_or(false)
                                    || json.get("arguments")
                                        .and_then(|a| a.get("jvm"))
                                        .is_some();
                                
                                if is_mod_loader {
                                    let json_id = json.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                    let matches_loader = if let Some(loader) = loader_type {
                                        match loader {
                                            "neoforge" => json_id.starts_with("neoforge-") || dir_name_str.starts_with("neoforge-"),
                                            "forge" => (json_id.starts_with("forge-") && !json_id.starts_with("neoforge-")) || (dir_name_str.starts_with("forge-") && !dir_name_str.starts_with("neoforge-")),
                                            "fabric" => json_id.starts_with("fabric-loader-") || dir_name_str.starts_with("fabric-loader-"),
                                            _ => false,
                                        }
                                    } else {
                                        false
                                    };
                                    
                                    if matches_loader {
                                        candidate_json = Some((json_path.clone(), json));
                                        break;
                                    } else {
                                        if fallback_json.is_none() {
                                            fallback_json = Some((json_path.clone(), json));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        candidate_json.or(fallback_json)
    });
    
    if let Some((json_path, json)) = selected_json {
        let path = json_path.parent().unwrap();
        let dir_name = path.file_name().unwrap();
        let library_directory = instance_dir.join("libraries").to_string_lossy().to_string();
        let natives_directory = path.join("natives").to_string_lossy().to_string();
        let version_name = dir_name.to_string_lossy().to_string();
        let classpath_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
        
        if let Some(arguments) = json.get("arguments") {
            if let Some(jvm_args) = arguments.get("jvm") {
                if let Some(jvm_array) = jvm_args.as_array() {
                    for arg in jvm_array {
                        let arg_str_opt = if let Some(arg_str) = arg.as_str() {
                            Some(arg_str.to_string())
                        } else if let Some(obj) = arg.as_object() {
                            // Argumentos condicionales - procesar value
                            if let Some(value) = obj.get("value") {
                                if let Some(value_str) = value.as_str() {
                                    Some(value_str.to_string())
                                } else if let Some(value_arr) = value.as_array() {
                                    // Si es un array, tomar el primer valor o concatenar
                                    value_arr.first()
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        
                        if let Some(arg_str) = arg_str_opt {
                            // Reemplazar TODOS los placeholders
                            let processed_arg = arg_str
                                .replace("${library_directory}", &library_directory)
                                .replace("${natives_directory}", &natives_directory)
                                .replace("${classpath_separator}", classpath_separator)
                                .replace("${version_name}", &version_name)
                                .replace("${launcher_name}", "KindlyKlanKlient")
                                .replace("${launcher_version}", "1.0.0")
                                .replace("${classpath}", ""); // Se pasa por separado, eliminar
                            
                            // NO MODIFICAR NADA - usar el JSON tal cual lo proporciona NeoForge
                            // Filtrar argumentos incompatibles
                            #[cfg(target_os = "windows")]
                            {
                                if processed_arg == "-XstartOnFirstThread" {
                                    continue;
                                }
                            }
                            
                            // Eliminar -cp y classpath ya que se pasa por separado
                            if processed_arg == "-cp" || processed_arg.starts_with("-cp ") {
                                continue;
                            }
                            if processed_arg.contains("${classpath}") || processed_arg == "${classpath}" {
                                continue;
                            }
                            
                            // Validar rutas de módulos si es -p (module path)
                            if processed_arg == "-p" {
                                additional_args.push(processed_arg);
                                continue;
                            }
                            
                            // Si el argumento anterior era -p, validar que los JARs existan y normalizar rutas
                            if !additional_args.is_empty() && additional_args.last() == Some(&"-p".to_string()) {
                                let module_paths: Vec<&str> = processed_arg.split(classpath_separator).collect();
                                let mut valid_paths = Vec::new();
                                
                                for jar_path in module_paths {
                                    let jar_path_trimmed = jar_path.trim();
                                    // Normalizar la ruta: reemplazar / por \ en Windows y quitar prefijo \\?\
                                    let normalized_path = if cfg!(target_os = "windows") {
                                        jar_path_trimmed
                                            .strip_prefix("\\\\?\\").unwrap_or(jar_path_trimmed)
                                            .replace("/", "\\")
                                    } else {
                                        jar_path_trimmed.to_string()
                                    };
                                    
                                    let path = std::path::Path::new(&normalized_path);
                                    if path.exists() {
                                        valid_paths.push(normalized_path);
                                    } else {
                                    }
                                }
                                
                                if !valid_paths.is_empty() {
                                    additional_args.pop();
                                    additional_args.push("-p".to_string());
                                    let final_module_path = valid_paths.join(classpath_separator);
                                    additional_args.push(final_module_path);
                                }
                                continue;
                            }
                            
                            if !processed_arg.trim().is_empty() {
                                additional_args.push(processed_arg);
                            }
                        }
                    }
                    
                    if !additional_args.is_empty() {
                        ensure_required_add_opens(loader_type, &mut additional_args);
                        return additional_args;
                    }
                }
            }
        }
    }
    
    if additional_args.is_empty() {
        if let Some(loader) = loader_type {
            match loader {
                "neoforge" | "forge" => {
                    additional_args.extend(vec![
                        "--add-opens".to_string(),
                        "java.base/java.lang.invoke=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.nio=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.lang=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.util=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.util.concurrent=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.util.concurrent.locks=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.lang.reflect=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.text=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.time=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.io=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.net=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.security=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.security.cert=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/sun.nio.ch=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/sun.util.calendar=ALL-UNNAMED".to_string(),
                        "--add-opens".to_string(),
                        "java.base/java.util.jar=ALL-UNNAMED".to_string(),
                    ]);
                }
                "fabric" => {
                    additional_args.extend(vec![
                        "--add-opens".to_string(),
                        "java.base/java.lang.invoke=ALL-UNNAMED".to_string(),
                    ]);
                }
                _ => {}
            }
        }
    }
    
    if !additional_args.is_empty() {
        ensure_required_add_opens(loader_type, &mut additional_args);
    }
    
    additional_args
}

pub fn get_mod_loader_game_args(instance_dir: &Path, version_id: Option<&str>) -> Vec<String> {
    let mut game_args = Vec::new();
    
    let selected_json = if let Some(vid) = version_id {
        let versions_dir = instance_dir.join("versions");
        let json_path = versions_dir.join(vid).join(format!("{}.json", vid));
        
        if json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    Some(json)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    
    if let Some(json) = selected_json {
        if let Some(arguments) = json.get("arguments") {
            if let Some(game_args_json) = arguments.get("game") {
                if let Some(game_array) = game_args_json.as_array() {
                    for arg in game_array {
                        if let Some(arg_str) = arg.as_str() {
                            game_args.push(arg_str.to_string());
                        }
                    }
                }
            }
        }
    }
    
    game_args
}


fn ensure_required_add_opens(loader_type: Option<&str>, args: &mut Vec<String>) {
    if let Some(loader) = loader_type {
        if loader == "neoforge" || loader == "forge" {
            let mut has_all_unnamed = false;
            for i in 0..args.len().saturating_sub(1) {
                if args[i] == "--add-opens" {
                    let next = &args[i + 1];
                    if next.contains("java.base/java.lang.invoke") && next.contains("ALL-UNNAMED") {
                        has_all_unnamed = true;
                        break;
                    }
                }
            }
            if !has_all_unnamed {
                args.push("--add-opens".to_string());
                args.push("java.base/java.lang.invoke=ALL-UNNAMED".to_string());
            }
        }
    }
}

pub fn build_minecraft_jvm_args(
	access_token: &str,
	min_ram_gb: f64,
	max_ram_gb: f64,
	garbage_collector: &str,
	additional_jvm_args: &str
) -> Result<Vec<String>, String> {
	let mut args = vec![
		format!("-Xmx{}G", max_ram_gb as u32),
		format!("-Xms{}G", min_ram_gb as u32),
		"-XX:+UnlockExperimentalVMOptions".to_string(),
	];
	match garbage_collector {
		"G1" => { args.extend(vec!["-XX:+UseG1GC".into(), "-XX:G1NewSizePercent=20".into(), "-XX:G1ReservePercent=20".into(), "-XX:MaxGCPauseMillis=50".into(), "-XX:G1HeapRegionSize=32M".into()]); },
		"ZGC" => { args.extend(vec!["-XX:+UseZGC".into(), "-XX:+UnlockExperimentalVMOptions".into()]); },
		"Parallel" => { args.extend(vec!["-XX:+UseParallelGC".into(), "-XX:ParallelGCThreads=4".into()]); },
		_ => { args.extend(vec!["-XX:+UseG1GC".into(), "-XX:G1NewSizePercent=20".into(), "-XX:G1ReservePercent=20".into(), "-XX:MaxGCPauseMillis=50".into(), "-XX:G1HeapRegionSize=32M".into()]); }
	}
	if !additional_jvm_args.trim().is_empty() {
		let additional_args: Vec<&str> = additional_jvm_args.split_whitespace().collect();
		for arg in additional_args { if !arg.is_empty() { args.push(arg.to_string()); } }
	}
	args.push("-Dminecraft.api.auth.host=https://authserver.mojang.com".to_string());
	args.push("-Dminecraft.api.account.host=https://api.mojang.com".to_string());
	args.push("-Dminecraft.api.session.host=https://sessionserver.mojang.com".to_string());
	args.push("-Dminecraft.api.services.host=https://api.minecraftservices.com".to_string());
	args.push(format!("-Dminecraft.api.accessToken={}", access_token));
	Ok(args)
}

pub fn get_instance_directory(instance_id: &str) -> PathBuf {
	let base = std::env::var("USERPROFILE")
		.map(|p| std::path::Path::new(&p).join(".kindlyklanklient"))
		.unwrap_or_else(|_| std::path::Path::new(".").join(".kindlyklanklient"));
	base.join(instance_id)
}

// Launcher directory configuration
pub struct LauncherConfig {
    pub minecraft_dir: PathBuf,
    pub versions_dir: PathBuf,
    pub assets_dir: PathBuf,
    pub libraries_dir: PathBuf,
}

impl LauncherConfig {
    pub fn new() -> Result<Self> {
        let home = env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let minecraft_dir = PathBuf::from(home).join(".kindlyklanklient");
        Ok(Self {
            versions_dir: minecraft_dir.join("versions"),
            assets_dir: minecraft_dir.join("assets"),
            libraries_dir: minecraft_dir.join("libraries"),
            minecraft_dir,
        })
    }

    pub async fn ensure_directories(&self) -> Result<()> {
        fs::create_dir_all(&self.minecraft_dir).await?;
        fs::create_dir_all(&self.versions_dir).await?;
        fs::create_dir_all(&self.assets_dir).await?;
        fs::create_dir_all(&self.libraries_dir).await?;
        Ok(())
    }
}


