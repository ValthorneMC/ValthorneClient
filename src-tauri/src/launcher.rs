use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct MinecraftLauncher {
    pub config: LauncherConfig,
}

impl MinecraftLauncher {
    pub fn new() -> Result<Self> {
        Ok(Self { config: LauncherConfig::new()? })
    }
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

    // If not found, try to use Java 8 as a fallback from runtime
    let java_8_path = crate::utils::java_executable_for_version("8");

    if java_8_path.exists() {
        return Ok(java_8_path.to_string_lossy().to_string());
    }

    Err("Java executable not found. Please ensure Java is installed.".to_string())
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
    
    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to read Java download: {}", e))?;
    
    let temp_file = runtime_dir.join(format!("java-{}.{}", version_str, extension));
    tokio::fs::write(&temp_file, &bytes).await
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    
    if java_dir.exists() {
        let _ = std::fs::remove_dir_all(&java_dir);
    }
    
    crate::utils::extract_java_archive(&temp_file, &runtime_dir, |_, _| {})?;
    crate::utils::finalize_extracted_java(&runtime_dir, &java_dir)?;

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
                ".valthorneclient/java/bin/java",
                "C:\\Users\\{username}\\.valthorneclient\\java\\bin\\java",
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
				// Normalize the path to compare against exclude_jars
				let canonical_opt = p.canonicalize().ok();
				let canonical_str = canonical_opt.as_ref()
					.map(|c| c.to_string_lossy().to_string());
				let path_str = p.to_string_lossy().to_string();

				// Remove Windows \\?\ prefix if present
				let canonical_clean = canonical_str.as_ref()
					.map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).to_string());
				let path_clean = path_str.strip_prefix("\\\\?\\").unwrap_or(&path_str).to_string();

				// Normalize path separators for comparison
				let normalized_canonical = canonical_clean.as_ref()
					.map(|s| s.replace("\\", "/"));
				let normalized_path = path_clean.replace("\\", "/");

				// Check whether it's excluded (compare against all possible variants)
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
					// Use dunce::canonicalize to normalize the path correctly on Windows
					// This automatically converts separators to \ and removes the \\?\ prefix
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
                            // Conditional arguments - process value
                            if let Some(value) = obj.get("value") {
                                if let Some(value_str) = value.as_str() {
                                    Some(value_str.to_string())
                                } else if let Some(value_arr) = value.as_array() {
                                    // If it's an array, take the first value or concatenate
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
                            // Replace ALL placeholders
                            let processed_arg = arg_str
                                .replace("${library_directory}", &library_directory)
                                .replace("${natives_directory}", &natives_directory)
                                .replace("${classpath_separator}", classpath_separator)
                                .replace("${version_name}", &version_name)
                                .replace("${launcher_name}", "ValthorneClient")
                                .replace("${launcher_version}", "1.0.0")
                                .replace("${classpath}", ""); // Passed separately, remove

                            // Filter out incompatible arguments. -XstartOnFirstThread is
                            // dropped here on every platform: build_minecraft_jvm_args
                            // already adds it on macOS, and it's invalid elsewhere.
                            if processed_arg == "-XstartOnFirstThread" {
                                continue;
                            }

                            // Remove -cp and classpath since it's passed separately
                            if processed_arg == "-cp" || processed_arg.starts_with("-cp ") {
                                continue;
                            }
                            if processed_arg.contains("${classpath}") || processed_arg == "${classpath}" {
                                continue;
                            }

                            // Validate module paths when it's -p (module path)
                            if processed_arg == "-p" {
                                additional_args.push(processed_arg);
                                continue;
                            }

                            // If the previous argument was -p, validate that the JARs exist and normalize paths
                            if !additional_args.is_empty() && additional_args.last() == Some(&"-p".to_string()) {
                                let module_paths: Vec<&str> = processed_arg.split(classpath_separator).collect();
                                let mut valid_paths = Vec::new();

                                for jar_path in module_paths {
                                    let jar_path_trimmed = jar_path.trim();
                                    // Normalize the path: replace / with \ on Windows and strip the \\?\ prefix
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

// Launcher directory configuration
pub struct LauncherConfig {
    pub minecraft_dir: PathBuf,
}

impl LauncherConfig {
    pub fn new() -> Result<Self> {
        Ok(Self { minecraft_dir: crate::utils::valthorne_dir() })
    }
}


