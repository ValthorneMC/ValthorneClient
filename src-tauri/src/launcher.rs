use anyhow::Result;
use std::path::{Path, PathBuf};

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

/// Automatically finds or installs the Java executable for a specific Minecraft version
pub async fn find_or_install_java_for_minecraft(mc_version: &str) -> Result<String, String> {
    let required_java_version = get_required_java_version_for_minecraft(mc_version);

    // Check whether the required version already exists in runtime
    let java_path = crate::utils::java_executable_for_version(&required_java_version.to_string());

    if java_path.exists() {
        return Ok(java_path.to_string_lossy().to_string());
    }
    
    log::warn!("⚠️  Java {} not found, required for Minecraft {}", required_java_version, mc_version);
    log::info!("🔽 Downloading Java {} automatically...", required_java_version);
    
    download_java_silent(required_java_version).await?;

    // Resolve again: the layout is only known once extracted (macOS JDKs live
    // under Contents/Home instead of bin/)
    let java_path = crate::utils::java_executable_for_version(&required_java_version.to_string());
    if java_path.exists() {
        return Ok(java_path.to_string_lossy().to_string());
    }

    Err(format!(
        "Error al instalar Java {}. Por favor, intente instalarlo manualmente.",
        required_java_version
    ))
}

/// Downloads and installs Java without a user interface
async fn download_java_silent(java_version: u8) -> Result<(), String> {
    let version_str = java_version.to_string();
    
    let runtime_dir = crate::utils::runtime_dir();
    let java_dir = crate::utils::java_runtime_dir(&version_str);

    tokio::fs::create_dir_all(&runtime_dir).await
        .map_err(|e| format!("Failed to create runtime directory: {}", e))?;

    let (os, arch) = crate::utils::adoptium_os_and_arch();
    let extension = crate::utils::adoptium_archive_extension();

    let jre_url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse",
        version_str, os, arch
    );
    
    log::info!("Downloading Java {} from: {}", version_str, jre_url);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&jre_url)
        .header("User-Agent", "ValthorneClient/1.0")
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Failed to download Java: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let temp_file = runtime_dir.join(format!("java-{}.{}", version_str, extension));

    // Stream to disk instead of buffering the whole JDK archive (150-200 MB) in memory.
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&temp_file).await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    let mut stream = response.bytes_stream();
    use futures_util::TryStreamExt;
    while let Some(chunk) = stream.try_next().await
        .map_err(|e| format!("Failed to read Java download: {}", e))?
    {
        file.write_all(&chunk).await
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
    }
    file.flush().await
        .map_err(|e| format!("Failed to flush temp file: {}", e))?;
    drop(file);
    
    if java_dir.exists() {
        let _ = std::fs::remove_dir_all(&java_dir);
    }
    
    crate::utils::extract_java_archive(&temp_file, &runtime_dir, |_, _| {})?;
    crate::utils::finalize_extracted_java(&runtime_dir, &java_dir)?;

    let _ = std::fs::remove_file(&temp_file);
    
    log::info!("Java {} installed successfully", version_str);
    Ok(())
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
    
    // Check if this JSON inherits from another (Fabric inherits from vanilla MC)
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
    
    // Parse libraries from the mod loader JSON (Fabric specific libraries)
    // These OVERRIDE base libraries with same artifact ID (e.g., asm-9.9 overrides asm-9.6)
    if let Some(libraries) = version_info.get("libraries").and_then(|v| v.as_array()) {
        for lib in libraries {
            add_library_to_classpath(lib, &libs_dir, &mut jar_map)?;
        }
    }
    
    // The client jar comes from the vanilla version the Fabric profile inherits from.
    let client_version = version_info.get("inheritsFrom")
        .and_then(|v| v.as_str())
        .or_else(|| version_info.get("id").and_then(|v| v.as_str()))
        .ok_or("Version ID not found in JSON")?;

    let client_jar = instance_dir.join("versions").join(client_version).join(format!("{}.jar", client_version));
    if client_jar.exists() {
        let normalized = dunce::canonicalize(&client_jar).unwrap_or(client_jar.clone());
        let normalized_str = if cfg!(target_os = "windows") {
            normalized.to_string_lossy()
                .strip_prefix("\\\\?\\").unwrap_or(&normalized.to_string_lossy())
                .replace("/", "\\")
        } else {
            normalized.to_string_lossy().to_string()
        };
        jar_map.insert("minecraft:client".to_string(), normalized_str);
    }

    if jar_map.is_empty() {
        return Err("No jars found for classpath".to_string());
    }
    
    // Convert HashMap values to Vec
    // Mods are not on the classpath: Fabric loads them from mods/ and from -Dfabric.addMods.
    let jars: Vec<String> = jar_map.into_values().collect();

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

    // Skip libraries whose rules exclude this platform, so natives left over from
    // another OS/arch never leak into the classpath
    if !crate::versions::is_library_value_allowed(
        lib,
        crate::utils::minecraft_os_name(),
        crate::utils::minecraft_os_arch(),
    ) {
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

/// Path of the Fabric profile JSON the installer created (`versions/fabric-loader-*/...json`).
pub fn find_fabric_version_json(instance_dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(instance_dir.join("versions")).ok()?;
    entries.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("fabric-loader-") {
            return None;
        }
        let json = entry.path().join(format!("{name}.json"));
        json.exists().then_some(json)
    })
}

pub fn select_main_class(instance_dir: &Path) -> String {
    find_fabric_version_json(instance_dir)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json.get("mainClass").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string())
}

/// JVM arguments declared by the Fabric profile, plus `-Dfabric.addMods` so the pack's
/// jars load from `libraries/valthorne` while `mods/` stays free for the player.
pub fn get_mod_loader_jvm_args(instance_dir: &Path) -> Vec<String> {
    let mut args = Vec::new();

    let profile = find_fabric_version_json(instance_dir)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());

    if let Some(jvm) = profile.as_ref().and_then(|p| p.get("arguments")).and_then(|a| a.get("jvm")).and_then(|j| j.as_array()) {
        let library_directory = instance_dir.join("libraries").to_string_lossy().to_string();
        let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
        for arg in jvm.iter().filter_map(|a| a.as_str()) {
            let arg = arg
                .replace("${library_directory}", &library_directory)
                .replace("${classpath_separator}", separator)
                .replace("${launcher_name}", "ValthorneClient")
                .replace("${launcher_version}", env!("CARGO_PKG_VERSION"));
            if !arg.trim().is_empty() && !arg.contains("${") {
                args.push(arg);
            }
        }
    }

    args.push(format!("-Dfabric.addMods={}", crate::dist::mods_store_dir(instance_dir).to_string_lossy()));
    args
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

	// macOS requires GLFW to run on the main thread, otherwise LWJGL aborts on
	// startup. The dock name keeps the app from showing up as "java".
	#[cfg(target_os = "macos")]
	{
		args.push("-XstartOnFirstThread".to_string());
		args.push("-Dapple.awt.application.name=Valthorne".to_string());
	}

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
	crate::utils::valthorne_dir().join(instance_id)
}



