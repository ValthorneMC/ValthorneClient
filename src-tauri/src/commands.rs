use tokio::fs;
use std::fs::File;
use std::io::Write;
use reqwest;
use tauri::{AppHandle, State};
use tauri::Emitter;
use crate::UpdateState;
use crate::models::{LauncherConfig, RamConfig, AdvancedConfig, UpdateInstallOutcome};
use crate::DistributionManifest;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

/// Checks whether a file should be ignored based on the ignore patterns :)
/// Patterns without '/' only match files at the root.
/// Patterns with '/' can match full paths.
fn should_ignore_config_file(file_path: &str, ignored_patterns: &[String]) -> bool {
    let is_root_file = !file_path.contains('/');
    
    if is_root_file {
        crate::utils::matches_glob_patterns(file_path, ignored_patterns)
    } else {
        let matches_full_path = crate::utils::matches_glob_patterns(file_path, ignored_patterns);
        if matches_full_path {
            true
        } else {
            let has_simple_pattern = ignored_patterns.iter().any(|p| !p.contains('/'));
            if has_simple_pattern {
                // Do NOT ignore
                false
            } else {
                // No simple patterns, only compare with the full path
                false
            }
        }
    }
}

#[tauri::command]
pub async fn create_instance_directory(instance_id: String, java_version: String) -> Result<String, String> {
    let kindly_dir = crate::utils::valthorne_dir();

    let instance_dir = kindly_dir.join(&instance_id);
    let java_dir = crate::utils::java_runtime_dir(&java_version);

    fs::create_dir_all(&instance_dir).await
        .map_err(|e| format!("Failed to create instance directory: {}", e))?;
    fs::create_dir_all(&java_dir).await
        .map_err(|e| format!("Failed to create Java directory: {}", e))?;

    Ok(format!("Instance directory created: {}", instance_dir.display()))
}

#[tauri::command]
pub async fn get_required_java_version_command(minecraft_version: String) -> Result<String, String> {
    Ok(super::get_required_java_version(&minecraft_version))
}

#[tauri::command]
pub async fn check_java_version(version: String) -> Result<String, String> {
    let java_path = crate::utils::java_executable_for_version(&version);
    if java_path.exists() { Ok("installed".to_string()) } else { Ok("not_installed".to_string()) }
}

#[tauri::command]
pub async fn set_downloading_state(state: State<'_, Arc<Mutex<bool>>>, is_downloading: bool) -> Result<(), String> {
    if let Ok(mut downloading) = state.lock() {
        *downloading = is_downloading;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_java(version: String, app_handle: AppHandle, state: State<'_, Arc<Mutex<bool>>>) -> Result<String, String> {
    if let Ok(mut downloading) = state.lock() {
        *downloading = true;
    }

    // Clear the flag on failure too: a download that errored out used to leave the
    // launcher convinced one was still running, which blocked closing the app
    let result = download_java_inner(version, app_handle).await;

    if let Ok(mut downloading) = state.lock() {
        *downloading = false;
    }

    result
}

async fn download_java_inner(version: String, app_handle: AppHandle) -> Result<String, String> {
    // Notify that the download started
    let _ = app_handle.emit("java-download-started", serde_json::json!({ "version": version }));
    
    let runtime_dir = crate::utils::runtime_dir();
    let java_dir = crate::utils::java_runtime_dir(&version);
    fs::create_dir_all(&runtime_dir).await.map_err(|e| format!("Failed to create runtime directory: {}", e))?;
    let (os, arch) = crate::utils::adoptium_os_and_arch();
    let extension = crate::utils::adoptium_archive_extension();
    let jre_url = format!("https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse", version, os, arch);
    
    // Emit initial progress
    let _ = app_handle.emit("java-download-progress", serde_json::json!({
        "percentage": 0,
        "status": "Downloading Java"
    }));
    
    let client = reqwest::Client::new();
    let response = client.get(&jre_url).header("User-Agent", "ValthorneClient/1.0").header("Accept", "application/octet-stream").send().await.map_err(|e| format!("Failed to download Java: {}", e))?;
    if !response.status().is_success() { return Err(format!("Download failed with status: {}", response.status())); }
    
    // Get total size if available
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;

    // Emit progress during download
    let _ = app_handle.emit("java-download-progress", serde_json::json!({
        "percentage": 10,
        "status": "Downloading Java"
    }));
    
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    use futures_util::TryStreamExt;
    loop {
        match stream.try_next().await {
            Ok(Some(chunk)) => {
                downloaded += chunk.len() as u64;
                bytes.extend_from_slice(&chunk);
                
                // Update progress every 5%
                if total_size > 0 {
                    let percentage = ((downloaded * 100) / total_size).min(80);
                    let _ = app_handle.emit("java-download-progress", serde_json::json!({
                        "percentage": percentage,
                        "status": "Downloading Java"
                    }));
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("Failed to read chunk: {}", e)),
        }
    }
    
    let temp_file = runtime_dir.join(format!("java-{}.{}", version, extension));
    let mut file = File::create(&temp_file).map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;
    file.flush().map_err(|e| format!("Failed to flush file: {}", e))?; 
    drop(file);
    
    // Emit extraction progress
    let _ = app_handle.emit("java-download-progress", serde_json::json!({
        "percentage": 85,
        "status": "Extracting Java"
    }));
    
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    if java_dir.exists() { let _ = std::fs::remove_dir_all(&java_dir); }

    {
        let app_handle = app_handle.clone();
        crate::utils::extract_java_archive(&temp_file, &runtime_dir, move |done, total| {
            // tar.gz reports total = 0 (unknown up front); keep the bar moving anyway
            let extraction_progress = if total > 0 {
                85 + ((done * 10) / total)
            } else {
                (85 + done / 200).min(94)
            };
            let _ = app_handle.emit("java-download-progress", serde_json::json!({
                "percentage": extraction_progress,
                "status": "Extracting Java"
            }));
        })?;
    }

    // Emit final progress
    let _ = app_handle.emit("java-download-progress", serde_json::json!({
        "percentage": 95,
        "status": "Finalizing installation"
    }));

    crate::utils::finalize_extracted_java(&runtime_dir, &java_dir)?;
    let _ = std::fs::remove_file(&temp_file);
    
    // Emit completed progress
    let _ = app_handle.emit("java-download-progress", serde_json::json!({
        "percentage": 100,
        "status": "Completed"
    }));
    let _ = app_handle.emit("java-download-completed", serde_json::json!({ "version": version }));

    Ok(format!("Java {} downloaded and installed successfully", version))
}

#[tauri::command]
pub async fn get_java_path(version: String) -> Result<String, String> {
    let java_path = crate::utils::java_executable_for_version(&version);
    if java_path.exists() { Ok(java_path.to_string_lossy().to_string()) } else { Err(format!("Java executable not found at: {}", java_path.display())) }
}

#[tauri::command]
pub async fn upload_skin_to_mojang(file_path: String, variant: String, access_token: String) -> Result<String, String> {
    use std::fs;
    let path = std::path::Path::new(&file_path);
    if !path.exists() { return Err(format!("File does not exist: {}", file_path)); }
    if path.extension().unwrap_or_default() != "png" { return Err("File must be a PNG image".to_string()); }
    let file_data = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Normalize the texture to the modern 64x64 RGBA format before sending it to Mojang.
    // This is what actually prevents most of the confusing 400 Bad Request errors: Mojang's
    // skin endpoint rejects anything that isn't exactly a well-formed 64x64/64x32 skin, and
    // this also transparently upgrades legacy 64x32 skins the same way the vanilla client does.
    let normalized_data = crate::skin_texture::normalize_skin_texture(&file_data)?;
    if normalized_data.len() > 24 * 1024 { return Err("Skin file must be smaller than 24KB".to_string()); }

    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .text("variant", variant)
        .part("file", reqwest::multipart::Part::bytes(normalized_data).file_name("skin.png").mime_str("image/png").unwrap());
    let response = client.post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(&access_token)
        .multipart(form).send().await.map_err(|e| format!("Failed to upload skin: {}", e))?;
    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        // Improve error messages based on the status code
        if status.as_u16() == 429 {
            return Err(format!("Rate limit exceeded (429). Mojang API allows 600 requests per 10 minutes. Please wait before trying again."));
        }
        if status.as_u16() == 401 {
            return Err(format!("Unauthorized (401). Session expired or invalid token. Please restart your session."));
        }
        if status.as_u16() == 400 {
            return Err(format!("Bad request (400). Invalid skin file or variant. {}", response_text));
        }
        return Err(format!("Mojang API error ({}): {}", status, response_text));
    }
    Ok("Skin uploaded successfully".to_string())
}

// ============================================================================
// Cape management
// ============================================================================

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CapeInfo {
    pub id: String,
    pub state: String,
    pub url: String,
    pub alias: String,
}

#[derive(serde::Deserialize)]
struct MojangProfileCapesResponse {
    #[serde(default)]
    capes: Vec<CapeInfo>,
}

#[tauri::command]
pub async fn get_player_capes(access_token: String) -> Result<Vec<CapeInfo>, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("Unauthorized (401). Session expired or invalid token.".to_string());
        }
        return Err(format!("Mojang API error ({}): {}", status, response_text));
    }

    let profile: MojangProfileCapesResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;

    Ok(profile.capes)
}

#[derive(serde::Serialize)]
struct SetActiveCapeBody {
    #[serde(rename = "capeId")]
    cape_id: String,
}

#[tauri::command]
pub async fn set_active_cape(cape_id: String, access_token: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .put("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(&access_token)
        .json(&SetActiveCapeBody { cape_id })
        .send()
        .await
        .map_err(|e| format!("Failed to set active cape: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("Unauthorized (401). Session expired or invalid token.".to_string());
        }
        return Err(format!("Mojang API error ({}): {}", status, response_text));
    }

    Ok("Cape activated".to_string())
}

#[tauri::command]
pub async fn remove_active_cape(access_token: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to remove active cape: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("Unauthorized (401). Session expired or invalid token.".to_string());
        }
        return Err(format!("Mojang API error ({}): {}", status, response_text));
    }

    Ok("Cape removed".to_string())
}

#[tauri::command]
pub async fn create_temp_file(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
use std::fs::File;
    use std::io::Write;
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&file_name);
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&file_data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

// ============================================================================
// Skin File Management Cmds
// ============================================================================

fn get_skins_directory() -> std::path::PathBuf {
    crate::utils::valthorne_dir().join("skins")
}

#[tauri::command]
pub async fn save_skin_file(skin_id: String, file_data: Vec<u8>) -> Result<String, String> {
    let skins_dir = get_skins_directory();
    fs::create_dir_all(&skins_dir).await
        .map_err(|e| format!("Failed to create skins directory: {}", e))?;
    
    let file_path = skins_dir.join(format!("{}.png", skin_id));
    fs::write(&file_path, &file_data).await
        .map_err(|e| format!("Failed to save skin file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn load_skin_file(skin_id: String) -> Result<Vec<u8>, String> {
    let skins_dir = get_skins_directory();
    let file_path = skins_dir.join(format!("{}.png", skin_id));
    
    if !file_path.exists() {
        return Err(format!("Skin file not found: {}", skin_id));
    }
    
    let file_data = fs::read(&file_path).await
        .map_err(|e| format!("Failed to read skin file: {}", e))?;
    
    Ok(file_data)
}

#[tauri::command]
pub async fn delete_skin_file(skin_id: String) -> Result<String, String> {
    let skins_dir = get_skins_directory();
    let file_path = skins_dir.join(format!("{}.png", skin_id));
    
    if file_path.exists() {
        fs::remove_file(&file_path).await
            .map_err(|e| format!("Failed to delete skin file: {}", e))?;
    }
    
    Ok("Skin file deleted".to_string())
}

#[tauri::command]
pub async fn list_skin_files() -> Result<Vec<String>, String> {
    let skins_dir = get_skins_directory();
    
    if !skins_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut skin_ids = Vec::new();
    let mut entries = fs::read_dir(&skins_dir).await
        .map_err(|e| format!("Failed to read skins directory: {}", e))?;
    
    while let Some(entry) = entries.next_entry().await
        .map_err(|e| format!("Failed to read directory entry: {}", e))? {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_stem() {
                if let Some(id) = file_name.to_str() {
                    skin_ids.push(id.to_string());
                }
            }
        }
    }
    
    Ok(skin_ids)
}

/// Update package already downloaded and waiting to be installed
pub struct PendingUpdate {
    pub version: String,
    pub bytes: Vec<u8>,
}

pub type PendingUpdateState = Arc<Mutex<Option<PendingUpdate>>>;

#[tauri::command]
pub async fn check_for_updates(app_handle: AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app_handle.updater().map_err(|e| format!("Failed to get updater: {}", e))?;
    let mut state = load_update_state().await;
    // Ensure that always use the real version
    state.current_version = env!("CARGO_PKG_VERSION").to_string();
    state.last_check = chrono::Utc::now().to_rfc3339();
    match updater.check().await {
        Ok(update) => {
            if let Some(update) = update {
                state.available_version = Some(update.version.clone());
                state.downloaded = false;
                state.download_ready = false;
                state.manual_download = false;
                save_update_state(&state).await?;
                Ok(format!("Update available: {}", update.version))
            } else {
                state.available_version = None;
                state.downloaded = false;
                state.download_ready = false;
                state.manual_download = false;
                save_update_state(&state).await?;
                Ok("No updates available".to_string())
            }
        }
        Err(e) => {
            save_update_state(&state).await?;
            Err(format!("Failed to check for updates: {}", e))
        }
    }
}

#[tauri::command]
pub async fn install_update(app_handle: AppHandle, pending: State<'_, PendingUpdateState>) -> Result<UpdateInstallOutcome, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app_handle.updater().map_err(|e| format!("Failed to get updater: {}", e))?;

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            // Nothing to install: the stored state was pointing at a version
            // that is already installed, so drop it instead of asking again.
            clear_update_state().await?;
            return Ok(UpdateInstallOutcome {
                installed: false,
                message: "No update available to install".to_string(),
            });
        }
        Err(e) => return Err(format!("Failed to check for updates: {}", e)),
    };

    let cached_bytes = pending
        .lock()
        .ok()
        .and_then(|mut slot| match slot.as_ref() {
            Some(p) if p.version == update.version => slot.take().map(|p| p.bytes),
            _ => None,
        });

    app_handle.emit("update-install-start", ()).unwrap_or_default();

    // Clear the pending update *before* installing: on Windows the installer
    // terminates this process, so anything after `install` may never run. If the
    // install fails, the next startup check finds the update again.
    clear_update_state().await.ok();

    let result = match cached_bytes {
        Some(bytes) => {
            log::info!("Installing already downloaded update {}", update.version);
            let _ = app_handle.emit("update-install-complete", ());
            update.install(bytes).map_err(|e| format!("Failed to install update: {}", e))
        }
        None => {
            log::info!("No cached package for {}, downloading before install", update.version);
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        let percentage = match content_length {
                            Some(total) if total > 0 => ((chunk_length as f64 / total as f64) * 100.0) as u32,
                            _ => 0,
                        };
                        let _ = app_handle.emit("update-download-progress", percentage);
                    },
                    || {
                        let _ = app_handle.emit("update-install-complete", ());
                    },
                )
                .await
                .map_err(|e| format!("Failed to install update: {}", e))
        }
    };

    if let Err(e) = result {
        log::error!("Update install failed: {}", e);
        return Err(e);
    }

    // On Windows the installer exits the app on its own; on macOS and Linux the new
    // bundle is only swapped in place, so the running process has to be restarted.
    #[cfg(not(target_os = "windows"))]
    {
        log::info!("Update installed, restarting app");
        app_handle.restart();
    }

    #[cfg(target_os = "windows")]
    Ok(UpdateInstallOutcome {
        installed: true,
        message: "Update installed successfully".to_string(),
    })
}

fn launcher_config_path() -> std::path::PathBuf {
    crate::utils::valthorne_dir().join("launcher.json")
}

fn update_state_path() -> std::path::PathBuf {
    crate::utils::valthorne_dir().join("update_state.json")
}

async fn load_launcher_config() -> LauncherConfig {
    let path = launcher_config_path();
    
    // Try to load from launcher.json
    if let Ok(text) = tokio::fs::read_to_string(&path).await {
        if let Ok(mut config) = serde_json::from_str::<LauncherConfig>(&text) {
            // Ensure the current version is correct
            let real_version = env!("CARGO_PKG_VERSION").to_string();
            config.update_state.current_version = real_version;
            return config;
        }
    }

    // If it doesn't exist, try to migrate from old files
    let mut config = LauncherConfig::default();

    // Migrate update_state from update_state.json
    if let Some(old_state) = read_update_state_file().await {
        config.update_state = old_state;
        let real_version = env!("CARGO_PKG_VERSION").to_string();
        config.update_state.current_version = real_version;
    }

    // Migrate ram_config from ram_config.json
    if let Ok((min_ram, max_ram)) = load_ram_config_legacy().await {
        config.ram_config = RamConfig { min_ram, max_ram };
    }

    // Migrate advanced_config from advanced_config.json
    if let Ok((jvm_args, gc, width, height)) = load_advanced_config_legacy().await {
        config.advanced_config = AdvancedConfig {
            jvm_args,
            garbage_collector: gc,
            window_width: width,
            window_height: height,
        };
    }

    // Save the unified config
    let _ = save_launcher_config_internal(&config).await;
    
    config
}

async fn save_launcher_config_internal(config: &LauncherConfig) -> Result<(), String> {
    let path = launcher_config_path();
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    
    let mut config_to_save = config.clone();
    config_to_save.last_updated = chrono::Utc::now().to_rfc3339();
    
    let data = serde_json::to_string_pretty(&config_to_save).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data).await.map_err(|e| e.to_string())
}

async fn load_ram_config_legacy() -> Result<(f64, f64), String> {
    use std::fs;
    let config_dir = dirs::config_dir().ok_or("Could not find config directory")?.join("ValthorneClient");
    let config_file = config_dir.join("ram_config.json");
    if !config_file.exists() {
        return Err("File not found".to_string());
    }
    let config_content = fs::read_to_string(&config_file).map_err(|e| format!("Failed to read config file: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&config_content).map_err(|e| format!("Failed to parse config file: {}", e))?;
    let min_ram = config["min_ram"].as_f64().unwrap_or(2.0);
    let max_ram = config["max_ram"].as_f64().unwrap_or(4.0);
    Ok((min_ram, max_ram))
}

async fn load_advanced_config_legacy() -> Result<(String, String, u32, u32), String> {
    use std::fs;
    let config_dir = dirs::config_dir().ok_or("Could not find config directory")?.join("ValthorneClient");
    let config_file = config_dir.join("advanced_config.json");
    if !config_file.exists() {
        return Err("File not found".to_string());
    }
    let config_content = fs::read_to_string(&config_file).map_err(|e| format!("Failed to read config file: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&config_content).map_err(|e| format!("Failed to parse config file: {}", e))?;
    let jvm_args = config["jvm_args"].as_str().unwrap_or("").to_string();
    let garbage_collector = config["garbage_collector"].as_str().unwrap_or("G1").to_string();
    let window_width = config["window_width"].as_u64().unwrap_or(1280) as u32;
    let window_height = config["window_height"].as_u64().unwrap_or(720) as u32;
    Ok((jvm_args, garbage_collector, window_width, window_height))
}

async fn save_update_state(state: &UpdateState) -> Result<(), String> {
    let mut config = load_launcher_config().await;
    config.update_state = state.clone();
    save_launcher_config_internal(&config).await
}

async fn read_update_state_file() -> Option<UpdateState> {
    let path = update_state_path();
    let Ok(text) = tokio::fs::read_to_string(&path).await else { return None; };
    serde_json::from_str(&text).ok()
}

/// Drops update state that advertises a version we are already running.
///
/// On Windows the installer terminates the app, so the cleanup at the end of
/// `install_update` never runs and the stored state keeps claiming an update is
/// ready to install forever. Returns whether anything was discarded.
fn discard_stale_update_state(state: &mut UpdateState) -> bool {
    let Some(available) = state.available_version.as_deref() else {
        return false;
    };

    let is_stale = match (
        semver::Version::parse(available),
        semver::Version::parse(&state.current_version),
    ) {
        (Ok(available), Ok(current)) => available <= current,
        // Unparseable versions: only discard on an exact match, never guess.
        _ => available == state.current_version,
    };

    if is_stale {
        state.available_version = None;
        state.downloaded = false;
        state.download_ready = false;
        state.manual_download = false;
    }

    is_stale
}

async fn load_update_state() -> UpdateState {
    let config = load_launcher_config().await;
    let mut state = config.update_state;
    state.current_version = env!("CARGO_PKG_VERSION").to_string();

    if discard_stale_update_state(&mut state) {
        log::info!("Discarded update state for already-installed {}", state.current_version);
        let _ = save_update_state(&state).await;
    }

    state
}

#[tauri::command]
pub async fn get_update_state() -> Result<UpdateState, String> {
    let mut state = load_update_state().await;
    state.current_version = env!("CARGO_PKG_VERSION").to_string();
    Ok(state)
}

/// Clears any pending update from the persisted state (`launcher.json`).
///
/// Note this is not the legacy `update_state.json`, which is only read once to
/// migrate into `launcher.json` and is never written again.
#[tauri::command]
pub async fn clear_update_state() -> Result<String, String> {
    let mut state = load_update_state().await;
    state.available_version = None;
    state.downloaded = false;
    state.download_ready = false;
    state.manual_download = false;
    save_update_state(&state).await?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn download_update_silent(
    app_handle: AppHandle,
    manual: Option<bool>,
    pending: State<'_, PendingUpdateState>,
) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app_handle.updater().map_err(|e| format!("Failed to get updater: {}", e))?;
    let is_manual = manual.unwrap_or(false);
    match updater.check().await {
        Ok(Some(update)) => {
            // Emit the download start event
            let _ = app_handle.emit("update-download-start", ());

            // Download the update with callbacks to report progress
            let bytes = update.download(
                |chunk_length, content_length| {
                    let percentage = if let Some(total) = content_length {
                        ((chunk_length as f64 / total as f64) * 100.0) as u32
                    } else {
                        0
                    };
                    let _ = app_handle.emit("update-download-progress", percentage);
                },
                || {
                    let _ = app_handle.emit("update-download-complete", ());
                }
            ).await.map_err(|e| format!("Failed to download update: {}", e))?;

            if let Ok(mut slot) = pending.lock() {
                *slot = Some(PendingUpdate { version: update.version.clone(), bytes });
            }

            // Update the state to indicate that the download is ready
            let mut state = load_update_state().await;
            state.available_version = Some(update.version.clone());
            state.downloaded = true;
            state.download_ready = true;
            state.manual_download = is_manual;
            save_update_state(&state).await?;
            Ok("downloaded successfully".to_string())
        }
        Ok(None) => Ok("no-update".to_string()),
        Err(e) => Err(format!("Failed to check for updates: {}", e))
    }
}

#[tauri::command]
pub async fn download_instance_assets(
    instance_id: String,
    minecraft_version: String,
    base_url: Option<String>,
    instance_url: Option<String>,
    app_handle: AppHandle,
    state: State<'_, Arc<Mutex<bool>>>
) -> Result<String, String> {
    // Set download state
    if let Ok(mut downloading) = state.lock() {
        *downloading = true;
    }
    let instance_dir = crate::utils::valthorne_dir().join(&instance_id);
    let _ = tokio::fs::create_dir_all(instance_dir.join("libraries")).await;
    let _ = tokio::fs::create_dir_all(instance_dir.join("mods")).await;
    let _ = app_handle.emit("asset-download-progress", serde_json::json!({
        "current": 0,
        "total": 1,
        "percentage": 0,
        "current_file": "",
        "status": "Starting"
    }));
    let _ = app_handle.emit("asset-download-progress", serde_json::json!({
        "current": 0,
        "total": 100,
        "percentage": 1,
        "current_file": "",
        "status": "Version"
    }));
    crate::instances::ensure_minecraft_client_present(&instance_dir, &minecraft_version).await?;
    
    let mut instance_manifest_for_assets: Option<crate::models::InstanceManifest> = None;
    let mut base_url_for_assets: Option<String> = None;
    let mut installed_mod_loader_version_id: Option<String> = None;
    if let (Some(base_ml), Some(inst_url_ml)) = (base_url.clone(), instance_url.clone()) {
        base_url_for_assets = Some(base_ml.clone());
        let full_url = if inst_url_ml.starts_with("http") { inst_url_ml } else { format!("{}/{}", base_ml.trim_end_matches('/'), inst_url_ml.trim_start_matches('/')) };
        let client = reqwest::Client::new();
        let response = client.get(&full_url).send().await.map_err(|e| format!("Failed to fetch instance details: {}", e))?;
        if !response.status().is_success() { return Err(format!("HTTP error: {}", response.status())); }
        let manifest: crate::models::InstanceManifest = response.json().await.map_err(|e| format!("Failed to parse instance JSON: {}", e))?;
        instance_manifest_for_assets = Some(manifest.clone());
        if let Some(mod_loader) = manifest.instance.mod_loader.as_ref() {
            let _ = app_handle.emit("asset-download-progress", serde_json::json!({
                "current": 3,
                "total": 100,
                "percentage": 3,
                "current_file": "",
                "status": "ModLoader"
            }));
            installed_mod_loader_version_id = crate::instances::install_mod_loader(&minecraft_version, mod_loader, &instance_dir).await?;
        }
    }

    let _ = app_handle.emit("asset-download-progress", serde_json::json!({
        "current": 10,
        "total": 100,
        "percentage": 10,
        "current_file": "",
        "status": "Mojang"
    }));
    let _ = crate::instances::ensure_assets_present_with_progress(&app_handle, &instance_dir, &minecraft_version, None).await?;
    
    let _ = app_handle.emit("asset-download-progress", serde_json::json!({
        "current": 90,
        "total": 100,
        "percentage": 90,
        "current_file": "",
        "status": "Libraries"
    }));
    crate::instances::ensure_version_libraries(&instance_dir, &minecraft_version).await?;
    
    // Download mod loader libraries if applicable (using the version_id returned by install_mod_loader)
    if let Some(version_id) = &installed_mod_loader_version_id {
        crate::instances::ensure_mod_loader_libraries(&instance_dir, version_id).await?;
    }
    
    if let (Some(instance), Some(base)) = (instance_manifest_for_assets, base_url_for_assets) {
        let _ = app_handle.emit("asset-download-progress", serde_json::json!({
            "current": 95,
            "total": 100,
            "percentage": 95,
            "current_file": "",
            "status": "Instance"
        }));
        // Load previous manifest history
        let previous_history = crate::instances::load_manifest_history(&instance_dir)?;

        // Get ignored file patterns
        let ignored_patterns = instance.ignored_files.as_ref();
        let empty_vec = Vec::<String>::new();
        let ignored_mods = ignored_patterns.map(|p| &p.mods).unwrap_or(&empty_vec);
        let ignored_configs = ignored_patterns.map(|p| &p.configs).unwrap_or(&empty_vec);
        let ignored_resourcepacks = ignored_patterns.map(|p| &p.resourcepacks).unwrap_or(&empty_vec);
        let ignored_shaderpacks = ignored_patterns.map(|p| &p.shaderpacks).unwrap_or(&empty_vec);
        
        use std::collections::HashSet;
        let mut expected_mods: HashSet<String> = HashSet::new();
        
        // Prepare mods directory
        let mods_dir = instance_dir.join("mods");
        if let Some(parent) = mods_dir.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        tokio::fs::create_dir_all(&mods_dir).await.map_err(|e| e.to_string())?;

        // Prepare list of files to download in parallel
        let mut mods_to_download: Vec<(String, std::path::PathBuf)> = Vec::new();
        for mod_file in &instance.files.mods {
            expected_mods.insert(mod_file.name.clone());
            let should_ignore = crate::utils::matches_glob_patterns(&mod_file.name, ignored_mods);
            let file_url = if mod_file.url.starts_with("http") { 
                mod_file.url.clone() 
            } else { 
                format!("{}/{}", base.trim_end_matches('/'), mod_file.url.trim_start_matches('/')) 
            };
            let target_path = mods_dir.join(&mod_file.name);
            
            if should_ignore {
                // Ignored file: only download if it does NOT exist (first time)
                if !target_path.exists() {
                    mods_to_download.push((file_url, target_path));
                }
            } else {
                // Non-ignored file: check whether it needs downloading
            let mut needs_download = true;
            if target_path.exists() {
                if !mod_file.sha256.is_empty() {
                        if crate::instances::verify_file_checksum(&target_path, &mod_file.sha256).is_ok() { 
                            needs_download = false; 
                        }
                } else if let Some(md5) = mod_file.md5.as_ref() {
                    if !md5.is_empty() {
                            if crate::instances::verify_file_md5(&target_path, md5).is_ok() { 
                                needs_download = false; 
                            }
                    }
                }
            }
                if needs_download {
                    mods_to_download.push((file_url, target_path));
                }
            }
        }
        
        // Download mods in parallel
        if !mods_to_download.is_empty() {
            use futures_util::stream::{self, StreamExt};
            let parallel = num_cpus::get().saturating_mul(8).max(50).min(mods_to_download.len());

            // HTTP client optimized with a large connection pool
            let client = std::sync::Arc::new(reqwest::Client::builder()
                .user_agent("ValthorneClient/1.0")
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .pool_max_idle_per_host(50)
                .pool_idle_timeout(std::time::Duration::from_secs(60))
                .tcp_nodelay(true)
                .build()
                .map_err(|e| format!("Failed to build HTTP client: {}", e))?);

            let results: Vec<Result<(), String>> = stream::iter(mods_to_download.into_iter())
                .map(|(url, path)| {
                    let client = client.clone();
                    async move {
                        crate::instances::download_file_with_retry_and_client(&client, &url, &path).await
                    }
                })
                .buffer_unordered(parallel)
                .collect()
                .await;
            
            for result in results {
                if let Err(e) = result {
                    log::warn!("Error downloading mod: {}", e);
                }
            }
        }
        
        if let Some(history) = &previous_history {
            let mods_dir = instance_dir.join("mods");
            if mods_dir.exists() {
                for entry in std::fs::read_dir(&mods_dir).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        // Only delete if it was in the history but is no longer in the current manifest
                        if history.files.mods.contains(&name) && !expected_mods.contains(&name) {
                            let should_ignore = crate::utils::matches_glob_patterns(&name, ignored_mods);
                            if !should_ignore {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        }

        let mut expected_configs: HashSet<String> = HashSet::new();
        let mut expected_root_files: HashSet<String> = HashSet::new();
        
        // Prepare list of configs to download in parallel
        let mut configs_to_download: Vec<(String, std::path::PathBuf)> = Vec::new();
        for config_file in &instance.files.configs {
            let file_url = if config_file.url.starts_with("http") { 
                config_file.url.clone() 
            } else { 
                format!("{}/{}", base.trim_end_matches('/'), config_file.url.trim_start_matches('/')) 
            };
            let rel = crate::instances::normalize_install_path(
                config_file.target.as_deref().unwrap_or(&config_file.path),
            );
            if rel.is_empty() {
                log::warn!("Skipping config with invalid target: {}", config_file.path);
                continue;
            }
            expected_configs.insert(rel.clone());
            
            if !rel.contains('/') {
                expected_root_files.insert(rel.clone());
            }
            
            let should_ignore = should_ignore_config_file(&rel, ignored_configs);
            let target_path = instance_dir.join(&rel);
            
            // Create parent directory if needed
            if let Some(parent) = target_path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
            }

            if should_ignore {
                // Ignored file: only download if it does NOT exist (first time)
                if !target_path.exists() {
                    configs_to_download.push((file_url, target_path));
                }
            } else {
                // Non-ignored file: check whether it needs downloading
            let mut needs_download = true;
            if target_path.exists() {
                if !config_file.sha256.is_empty() {
                        if crate::instances::verify_file_checksum(&target_path, &config_file.sha256).is_ok() { 
                            needs_download = false; 
                        }
                } else if let Some(md5) = config_file.md5.as_ref() {
                    if !md5.is_empty() {
                            if crate::instances::verify_file_md5(&target_path, md5).is_ok() { 
                                needs_download = false; 
                            }
                    }
                }
            }
                if needs_download {
                    configs_to_download.push((file_url, target_path));
                }
            }
        }
        
        // Download configs in parallel
        if !configs_to_download.is_empty() {
            use futures_util::stream::{self, StreamExt};
            let parallel = num_cpus::get().saturating_mul(4).max(20).min(configs_to_download.len());

            // HTTP client optimized with a large connection pool
            let client = std::sync::Arc::new(reqwest::Client::builder()
                .user_agent("ValthorneClient/1.0")
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .pool_max_idle_per_host(50)
                .pool_idle_timeout(std::time::Duration::from_secs(60))
                .tcp_nodelay(true)
                .build()
                .map_err(|e| format!("Failed to build HTTP client: {}", e))?);

            let results: Vec<Result<(), String>> = stream::iter(configs_to_download.into_iter())
                .map(|(url, path)| {
                    let client = client.clone();
                    async move {
                        crate::instances::download_file_with_retry_and_client(&client, &url, &path).await
                    }
                })
                .buffer_unordered(parallel)
                .collect()
                .await;
            
            for result in results {
                if let Err(e) = result {
                    log::warn!("Error downloading config: {}", e);
                }
            }
        }
        
        if let Some(history) = &previous_history {
            let config_dir = instance_dir.join("config");
            if config_dir.exists() {
                for entry in walkdir::WalkDir::new(&config_dir) {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_type().is_file() {
                        let rel_path = entry.path().strip_prefix(&instance_dir).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
                        // Only delete if it was in the history but is no longer in the current manifest
                        if history.files.configs.contains(&rel_path) && !expected_configs.contains(&rel_path) {
                            let should_ignore = should_ignore_config_file(&rel_path, ignored_configs);
                            if !should_ignore {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        }
        
        // Clean up root files: only delete if they were in the history but are no longer in the current manifest
        if let Some(history) = &previous_history {
            if let Ok(entries) = std::fs::read_dir(&instance_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                            // Ignore system files (.manifest_history.json, etc.)
                            if file_name.starts_with('.') {
                                continue;
                            }
                            // Only process files that were in the root_files history
                            if history.files.root_files.contains(&file_name.to_string()) && !expected_root_files.contains(file_name) {
                                let should_ignore = should_ignore_config_file(file_name, ignored_configs);
                                if !should_ignore {
                                    let _ = std::fs::remove_file(&path);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Clean up resourcepacks: only delete if they were in the history but are no longer in the current manifest
        if let Some(history) = &previous_history {
            let mut expected_resourcepacks: HashSet<String> = HashSet::new();
            if let Some(resourcepacks) = &instance.files.resourcepacks {
                for rp_file in resourcepacks {
                    expected_resourcepacks.insert(rp_file.name.clone());
                }
            }
            
            let resourcepacks_dir = instance_dir.join("resourcepacks");
            if resourcepacks_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&resourcepacks_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                if history.files.resourcepacks.contains(&file_name.to_string()) && !expected_resourcepacks.contains(file_name) {
                                    let should_ignore = crate::utils::matches_glob_patterns(file_name, ignored_resourcepacks);
                                    if !should_ignore {
                                        let _ = std::fs::remove_file(&path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Clean up shaderpacks: only delete if they were in the history but are no longer in the current manifest
        if let Some(history) = &previous_history {
            let mut expected_shaderpacks: HashSet<String> = HashSet::new();
            if let Some(shaderpacks) = &instance.files.shaderpacks {
                for sp_file in shaderpacks {
                    expected_shaderpacks.insert(sp_file.name.clone());
                }
            }
            
            let shaderpacks_dir = instance_dir.join("shaderpacks");
            if shaderpacks_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&shaderpacks_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                if history.files.shaderpacks.contains(&file_name.to_string()) && !expected_shaderpacks.contains(file_name) {
                                    let should_ignore = crate::utils::matches_glob_patterns(file_name, ignored_shaderpacks);
                                    if !should_ignore {
                                        let _ = std::fs::remove_file(&path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Save the new history after processing all files
        crate::instances::save_manifest_history(&instance_dir, &instance).await?;
    }
    
    let _ = app_handle.emit("asset-download-progress", serde_json::json!({
        "current": 100,
        "total": 100,
        "percentage": 100,
        "current_file": "",
        "status": "Completed"
    }));
    let _ = app_handle.emit("asset-download-completed", serde_json::json!({ "phase": "complete" }));
    
    // Clear download state
    if let Ok(mut downloading) = state.lock() {
        *downloading = false;
    }

    Ok("ok".to_string())
}

#[tauri::command]
pub async fn load_distribution_manifest(url: String) -> Result<DistributionManifest, String> {
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| format!("Failed to fetch manifest: {}", e))?;
    if !response.status().is_success() { return Err(format!("HTTP error: {}", response.status())); }
    let manifest: DistributionManifest = response.json().await.map_err(|e| format!("Failed to parse manifest JSON: {}", e))?;
    Ok(manifest)
}

#[tauri::command]
pub async fn get_instance_background_video(
    base_url: String,
    instance_id: String,
    video_path: String,
) -> Result<Vec<u8>, String> {
    use std::path::Path;
    
    let launcher = crate::launcher::MinecraftLauncher::new().map_err(|e| e.to_string())?;
    let instance_dir = launcher.config.minecraft_dir.join("instances").join(&instance_id);
    let video_dir = instance_dir.join("assets");
    tokio::fs::create_dir_all(&video_dir).await.map_err(|e| e.to_string())?;
    
    // Build the file name from the path (e.g. "instances/thanatophobia2/assets/th2trailer.mp4" -> "th2trailer.mp4")
    let video_file_name = Path::new(&video_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid video path".to_string())?;
    
    let local_video_path = video_dir.join(video_file_name);
    
    // If the video doesn't exist locally, download it
    if !local_video_path.exists() {
        // Build the full video URL
        let video_url = if video_path.starts_with("http") {
            video_path
        } else {
            format!("{}/{}", base_url.trim_end_matches('/'), video_path.trim_start_matches('/'))
        };

        // Download the video
        crate::instances::download_file(&video_url, &local_video_path).await.map_err(|e| e.to_string())?;
    }

    // Read the file as bytes
    let video_bytes = tokio::fs::read(&local_video_path).await.map_err(|e| format!("Failed to read video file: {}", e))?;
    
    Ok(video_bytes)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ProfileResponse {
    pub status: String,
    pub profile: Option<serde_json::Value>,
    pub code: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn get_minecraft_profile_safe(access_token: String) -> Result<ProfileResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;
    if response.status().as_u16() == 401 {
        return Ok(ProfileResponse { status: "Err".into(), profile: None, code: Some("PROFILE_401".into()), message: Some("Unauthorized".into()) });
    }
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Ok(ProfileResponse { status: "Err".into(), profile: None, code: Some("PROFILE_OTHER".into()), message: Some(error_text) });
    }
    let json = response.json::<serde_json::Value>().await.map_err(|e| format!("Failed to parse profile json: {}", e))?;
    Ok(ProfileResponse { status: "Ok".into(), profile: Some(json), code: None, message: None })
}

pub fn get_required_java_version(minecraft_version: &str) -> String {
    crate::launcher::get_required_java_version_for_minecraft(minecraft_version).to_string()
}

#[tauri::command]
pub async fn save_advanced_config(
    jvm_args: String,
    garbage_collector: String,
    window_width: u32,
    window_height: u32
) -> Result<(), String> {
    let mut config = load_launcher_config().await;
    config.advanced_config = AdvancedConfig {
        jvm_args,
        garbage_collector,
        window_width,
        window_height,
    };
    save_launcher_config_internal(&config).await
}

#[tauri::command]
pub async fn load_advanced_config() -> Result<(String, String, u32, u32), String> {
    let config = load_launcher_config().await;
    Ok((
        config.advanced_config.jvm_args,
        config.advanced_config.garbage_collector,
        config.advanced_config.window_width,
        config.advanced_config.window_height,
    ))
}

#[tauri::command]
pub async fn save_ram_config(min_ram: f64, max_ram: f64) -> Result<(), String> {
    let mut config = load_launcher_config().await;
    config.ram_config = RamConfig { min_ram, max_ram };
    save_launcher_config_internal(&config).await
}

#[tauri::command]
pub async fn load_ram_config() -> Result<(f64, f64), String> {
    let config = load_launcher_config().await;
    Ok((config.ram_config.min_ram, config.ram_config.max_ram))
}

#[tauri::command]
pub async fn save_language(language: String) -> Result<(), String> {
    let mut config = load_launcher_config().await;
    config.language = language;
    save_launcher_config_internal(&config).await
}

#[tauri::command]
pub async fn load_language() -> Result<String, String> {
    let config = load_launcher_config().await;
    Ok(config.language)
}

#[tauri::command]
pub fn get_system_ram() -> Result<u32, String> {
    use sysinfo::System;
    let mut system = System::new_all();
    system.refresh_memory();
    let total_memory_bytes = system.total_memory();
    let total_memory_gb = (total_memory_bytes / (1024 * 1024 * 1024)) as u32;
    Ok(std::cmp::max(total_memory_gb, 4))
}

#[tauri::command]
pub async fn stop_minecraft_instance(
    instance_id: String,
    state: State<'_, Arc<Mutex<HashMap<String, u32>>>>
) -> Result<String, String> {
    let pid = {
        let processes = state.lock().map_err(|e| format!("Failed to lock processes: {}", e))?;
        processes.get(&instance_id).copied()
    };
    
    if let Some(pid) = pid {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            let output = Command::new("taskkill")
                .args(&["/PID", &pid.to_string(), "/F", "/T"])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("Failed to kill process: {}", e))?;
            
            if output.status.success() {
                let mut processes = state.lock().map_err(|e| format!("Failed to lock processes: {}", e))?;
                processes.remove(&instance_id);
    Ok(format!("Minecraft instance {} stopped", instance_id))
            } else {
                Err(format!("Failed to stop process: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            use std::process::Command;
            let output = Command::new("kill")
                .args(&["-9", &pid.to_string()])
                .output()
                .map_err(|e| format!("Failed to kill process: {}", e))?;
            
            if output.status.success() {
                let mut processes = state.lock().map_err(|e| format!("Failed to lock processes: {}", e))?;
                processes.remove(&instance_id);
                Ok(format!("Minecraft instance {} stopped", instance_id))
            } else {
                Err(format!("Failed to stop process: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
    } else {
        Err(format!("No running Minecraft instance found for {}", instance_id))
    }
}

// ==================== FRONTEND LOGGING ====================

/// Gets the frontend log file path
fn get_frontend_log_path() -> Result<std::path::PathBuf, String> {
    let log_dir = crate::utils::valthorne_dir().join("logs");
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;
    
    Ok(log_dir.join("frontend.log"))
}

#[tauri::command]
pub async fn log_frontend_error(level: String, message: String, context: Option<String>) -> Result<(), String> {
    let log_path = get_frontend_log_path()?;
    
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let context_str = context.map(|c| format!(" [{}]", c)).unwrap_or_default();
    let log_line = format!("[{}] {}{}: {}\n", timestamp, level.to_uppercase(), context_str, message);
    
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    
    file.write_all(log_line.as_bytes())
        .map_err(|e| format!("Failed to write to log file: {}", e))?;
    
    match level.to_lowercase().as_str() {
        "error" => log::error!("[Frontend]{} {}", context_str, message),
        "warn" => log::warn!("[Frontend]{} {}", context_str, message),
        "info" => log::info!("[Frontend]{} {}", context_str, message),
        _ => log::debug!("[Frontend]{} {}", context_str, message),
    }
    
    Ok(())
}

#[tauri::command]
pub async fn get_frontend_logs() -> Result<String, String> {
    let log_path = get_frontend_log_path()?;
    
    if !log_path.exists() {
        return Ok(String::from("No logs available yet."));
    }
    
    std::fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log file: {}", e))
}

#[tauri::command]
pub async fn clear_frontend_logs() -> Result<(), String> {
    let log_path = get_frontend_log_path()?;
    
    if log_path.exists() {
        std::fs::remove_file(&log_path)
            .map_err(|e| format!("Failed to clear log file: {}", e))?;
    }
    
    Ok(())
}

// DevTools are only attached in debug builds (the `devtools` Tauri feature that would
// force-attach them in release is intentionally not enabled), so this command is a no-op
// in production regardless of who calls it.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn toggle_devtools(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let window = app_handle.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    // Toggle DevTools: open if closed, close if open
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }

    Ok(())
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub async fn toggle_devtools(_app_handle: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn open_frontend_log_folder() -> Result<(), String> {
    let log_path = get_frontend_log_path()?;
    let log_dir = log_path.parent()
        .ok_or_else(|| "Failed to get log directory".to_string())?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn open_backend_log_folder() -> Result<(), String> {
    use crate::logging::Logger;
    
    let log_dir = Logger::get_log_directory()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }
    
    Ok(())
}

// ========== Discord RPC Commands ==========

#[tauri::command]
pub async fn initialize_discord_rpc() -> Result<String, String> {
    crate::discord_rpc::initialize_discord_rpc()
        .map(|_| "Discord RPC initialized successfully".to_string())
}

#[tauri::command]
pub async fn update_discord_presence(state: String, details: String, button_label: String) -> Result<String, String> {
    crate::discord_rpc::update_discord_presence(&state, &details, &button_label)
        .map(|_| "Discord presence updated successfully".to_string())
}

#[tauri::command]
pub async fn shutdown_discord_rpc() -> Result<String, String> {
    crate::discord_rpc::shutdown_discord_rpc()
        .map(|_| "Discord RPC shut down successfully".to_string())
}

#[tauri::command]
pub async fn is_discord_rpc_enabled() -> Result<bool, String> {
    Ok(crate::discord_rpc::is_discord_rpc_enabled())
}

#[tauri::command]
pub async fn load_discord_rpc_config() -> Result<crate::DiscordRpcConfig, String> {
    let config_path = dirs::config_dir()
        .ok_or("error.config.dir_unavailable")?
        .join("valthorneclient")
        .join("discord_rpc.json");

    if config_path.exists() {
        let content = tokio::fs::read_to_string(&config_path)
            .await
            .map_err(|e| format!("error.config.read_failed|{}", e))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("error.config.parse_failed|{}", e))
    } else {
        Ok(crate::DiscordRpcConfig::default())
    }
}

#[tauri::command]
pub async fn save_discord_rpc_config(enabled: bool) -> Result<String, String> {
    let config = crate::DiscordRpcConfig { enabled };

    let config_dir = dirs::config_dir()
        .ok_or("error.config.dir_unavailable")?
        .join("valthorneclient");

    tokio::fs::create_dir_all(&config_dir)
        .await
        .map_err(|e| format!("error.config.write_failed|{}", e))?;

    let config_path = config_dir.join("discord_rpc.json");
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("error.config.write_failed|{}", e))?;

    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| format!("error.config.write_failed|{}", e))?;

    Ok("Configuration saved successfully".to_string())
}


#[cfg(test)]
mod update_state_tests {
    use super::discard_stale_update_state;
    use crate::models::UpdateState;

    fn state(available: Option<&str>, current: &str) -> UpdateState {
        UpdateState {
            available_version: available.map(str::to_string),
            current_version: current.to_string(),
            downloaded: true,
            download_ready: true,
            ..Default::default()
        }
    }

    #[test]
    fn discards_already_installed_version() {
        let mut s = state(Some("1.0.8"), "1.0.8");
        assert!(discard_stale_update_state(&mut s));
        assert!(!s.download_ready);
        assert_eq!(s.available_version, None);
    }

    #[test]
    fn discards_older_than_installed() {
        let mut s = state(Some("1.0.7"), "1.0.8");
        assert!(discard_stale_update_state(&mut s));
    }

    #[test]
    fn keeps_genuinely_newer_version() {
        let mut s = state(Some("1.0.9"), "1.0.8");
        assert!(!discard_stale_update_state(&mut s));
        assert!(s.download_ready);
        assert_eq!(s.available_version.as_deref(), Some("1.0.9"));
    }

    #[test]
    fn keeps_state_without_pending_version() {
        let mut s = state(None, "1.0.8");
        assert!(!discard_stale_update_state(&mut s));
    }
}
