// Kindly Klan Klient
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::env;
 
use std::process::Command;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
 
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod logging;
mod sessions;
mod models;
mod versions;
mod launcher;
mod utils;
mod whitelist;
mod sessions_api;
mod instances;
mod auth_ms;
mod commands;
mod admins;
mod local_instances;
mod modrinth;
mod http_client;
mod discord_rpc;
pub use models::*;
pub use versions::*;
pub use whitelist::*;
pub use utils::*;
pub use sessions_api::*;
pub use instances::*;
pub use auth_ms::*;
pub use commands::*;
pub use admins::*;
pub use local_instances::*;
 

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub username: String,
    pub uuid: String,
    pub user_type: String,
    pub expires_at: Option<i64>,
    pub refresh_token: Option<String>,
}
 

const AZURE_CLIENT_ID: &str = "d1538b43-1083-43ac-89d5-c88cb0049ada";

#[allow(dead_code)]
async fn validate_access_token(access_token: &str) -> Result<bool, String> {
    match crate::auth_ms::get_minecraft_profile_from_token(access_token).await {
        Ok(_) => Ok(true),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("401") || err_str.contains("Unauthorized") {
                Ok(false)
            } else {
                Err(err_str)
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", content = "data")]
pub enum EnsureSessionResponse {
    Ok { session: sessions::Session, refreshed: bool },
    Err { code: String, message: String },
}

#[tauri::command]
async fn launch_minecraft_with_java(
    app_handle: tauri::AppHandle,
    instance_id: String,
    java_path: String,
    minecraft_version: String,
    _java_version: String,
    access_token: String,
    min_ram_gb: Option<f64>,
    max_ram_gb: Option<f64>
) -> Result<String, String> {
    let instance_dir = crate::launcher::get_instance_directory(&instance_id);
    if !instance_dir.exists() {
        return Err(format!("Instance directory does not exist: {}", instance_dir.display()));
    }

    launch_minecraft_with_auth(&app_handle, &instance_id, &minecraft_version, &java_path, &access_token, min_ram_gb, max_ram_gb).await
}

/// Busca el JSON del mod loader o usa el de la versión vanilla como fallback
/// Usa la misma lógica que get_mod_loader_jvm_args para detectar mod loaders
fn find_version_json_path(instance_dir: &std::path::Path, minecraft_version: &str) -> Result<std::path::PathBuf, String> {
    use std::path::PathBuf;
    
    let versions_dir = instance_dir.join("versions");
    if !versions_dir.exists() {
        // Fallback: usar el JSON de la versión vanilla
        let vanilla_json = versions_dir.join(minecraft_version).join(format!("{}.json", minecraft_version));
        if vanilla_json.exists() {
            return Ok(vanilla_json);
        }
        return Err(format!("Versions directory does not exist: {}", versions_dir.display()));
    }
    
    // Buscar el JSON del mod loader usando la misma lógica que get_mod_loader_jvm_args
    let mut candidate_json: Option<PathBuf> = None;
    let mut fallback_json: Option<PathBuf> = None;
    
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
                            // Verificar que sea un mod loader (tiene mainClass de mod loader o arguments.jvm)
                            // Esta es la misma lógica que usa get_mod_loader_jvm_args
                            let is_mod_loader = json.get("mainClass")
                                .and_then(|v| v.as_str())
                                .map(|mc| mc.contains("forge") || mc.contains("neoforge") || mc.contains("fabric") || mc.contains("Knot"))
                                .unwrap_or(false)
                                || json.get("arguments")
                                    .and_then(|a| a.get("jvm"))
                                    .is_some();
                            
                            if is_mod_loader {
                                let json_id = json.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                
                                let is_clear_mod_loader = json_id.starts_with("fabric-loader-") 
                                    || json_id.starts_with("forge-") 
                                    || json_id.starts_with("neoforge-")
                                    || dir_name_str.starts_with("fabric-loader-")
                                    || dir_name_str.starts_with("forge-")
                                    || dir_name_str.starts_with("neoforge-");
                                
                                if is_clear_mod_loader {
                                    candidate_json = Some(json_path);
                                    break;
                                } else {
                                    if fallback_json.is_none() {
                                        fallback_json = Some(json_path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    if let Some(json_path) = candidate_json.or(fallback_json) {
        return Ok(json_path);
    }
    
    let vanilla_json = versions_dir.join(minecraft_version).join(format!("{}.json", minecraft_version));
    if vanilla_json.exists() {
        return Ok(vanilla_json);
    }
    
    Err(format!("No version JSON found for {}", minecraft_version))
}

async fn launch_minecraft_with_auth(
    app_handle: &tauri::AppHandle,
    instance_id: &str,
    minecraft_version: &str,
    java_path: &str,
    access_token: &str,
    min_ram_gb: Option<f64>,
    max_ram_gb: Option<f64>
) -> Result<String, String> {
    let instance_dir = crate::launcher::get_instance_directory(instance_id);

    ensure_minecraft_client_present(&instance_dir, minecraft_version).await?;
    crate::instances::ensure_version_libraries(&instance_dir, minecraft_version).await?;

    let _ = std::fs::create_dir_all(instance_dir.join("libraries"));
    let _ = std::fs::create_dir_all(instance_dir.join("mods"));
    
    let version_json_path = find_version_json_path(&instance_dir, minecraft_version)?;
    
    let version_id = version_json_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());
    
    let classpath = crate::launcher::build_minecraft_classpath_from_json(&instance_dir, &version_json_path)?;
    {
        let mut has_lwjgl = false;
        for entry in walkdir::WalkDir::new(instance_dir.join("libraries")) {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().is_file() {
                let p = entry.path();
                if p.to_string_lossy().contains("lwjgl") {
                    has_lwjgl = true;
                    break;
                }
            }
        }
        if !has_lwjgl { ensure_minecraft_client_present(&instance_dir, minecraft_version).await?; }
    }

    let min_ram = min_ram_gb.unwrap_or(2.0);
    let max_ram = max_ram_gb.unwrap_or(4.0);
    
    let (jvm_args_config, gc_config, window_width, window_height) = load_advanced_config().await.unwrap_or((
        String::new(), "G1".to_string(), 1280, 720
    ));
    
    let mut jvm_args = crate::launcher::build_minecraft_jvm_args(access_token, min_ram, max_ram, &gc_config, &jvm_args_config)?;
    
    let mod_loader_jvm_args = crate::launcher::get_mod_loader_jvm_args(&instance_dir, None, None, None);
    if !mod_loader_jvm_args.is_empty() {
        jvm_args.extend(mod_loader_jvm_args);
    }
    
    let asset_index_id = ensure_assets_present(app_handle, &instance_dir, minecraft_version).await?;

    let profile = crate::auth_ms::get_minecraft_profile_from_token(access_token).await
        .map_err(|e| e.to_string())?;
    let username = profile["name"].as_str().unwrap_or("Player");
    let uuid = profile["id"].as_str().unwrap_or("00000000000000000000000000000000");

    let assets_dir = instance_dir.join("assets");
    let mut mc_args = vec![
        "--username".to_string(), username.to_string(),
        "--uuid".to_string(), uuid.to_string(),
        "--accessToken".to_string(), access_token.to_string(),
        "--version".to_string(), minecraft_version.to_string(),
        "--gameDir".to_string(), instance_dir.to_string_lossy().to_string(),
        "--assetsDir".to_string(), assets_dir.to_string_lossy().to_string(),
        "--assetIndex".to_string(), asset_index_id,
        "--userType".to_string(), "msa".to_string(),
        "--versionType".to_string(), "release".to_string(),
    ];

    mc_args.push("--width".to_string());
    mc_args.push(window_width.to_string());
    mc_args.push("--height".to_string());
    mc_args.push(window_height.to_string());

    let main_class = crate::launcher::select_main_class(&instance_dir, version_id.as_deref());
    
    log::info!("Launching instance {} with main class: {}", instance_id, main_class);
    
    let mut command = Command::new(java_path);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    
    command
        .args(&jvm_args)
        .arg("-cp")
        .arg(&classpath)
        .arg(&main_class)
        .args(&mc_args)
        .current_dir(&instance_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    
    let mut child = command.spawn()
        .map_err(|e| format!("Failed to start Minecraft: {}", e))?;
    
    let pid = child.id();
    
    if let Some(state) = app_handle.try_state::<Arc<Mutex<HashMap<String, u32>>>>() {
        if let Ok(mut processes) = state.lock() {
            processes.insert(instance_id.to_string(), pid);
        }
    } else {
        log::warn!("Failed to get processes state");
    }
    
    if let Some(stdout) = child.stdout.take() {
        use std::io::{BufRead, BufReader};
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                log::info!("[MC] {}", line);
            }
        });
    }
    
    // Capturar stderr
    if let Some(stderr) = child.stderr.take() {
        use std::io::{BufRead, BufReader};
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                log::error!("[MC] {}", line);
            }
        });
    }

    let app = app_handle.clone();
    let instance_id_owned = instance_id.to_string();
    let processes_state = if let Some(state) = app_handle.try_state::<Arc<Mutex<HashMap<String, u32>>>>() {
        state.inner().clone()
    } else {
        return Err("Failed to get processes state".to_string());
    };
    std::thread::spawn(move || {
        match child.wait() {
            Ok(status) => {
                log::info!("Minecraft exited for instance {} with status: {:?}", instance_id_owned, status.code());
                if let Ok(mut processes) = processes_state.lock() {
                    processes.remove(&instance_id_owned);
                }
                let _ = app.emit("minecraft_exited", serde_json::json!({ 
                    "instance_id": instance_id_owned,
                    "status": "exited",
                    "code": status.code()
                }));
            }
            Err(e) => {
                log::error!("Error waiting for Minecraft process {}: {}", instance_id_owned, e);
                if let Ok(mut processes) = processes_state.lock() {
                    processes.remove(&instance_id_owned);
                }
                let _ = app.emit("minecraft_exited", serde_json::json!({ 
                    "instance_id": instance_id_owned,
                    "status": "error",
                    "error": e.to_string()
                }));
            }
        }
    });

    Ok("Minecraft launched".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();
    
    // Initialize logging system
    if let Err(e) = logging::init_logging() {
        eprintln!("Error initializing logging: {}", e);
    }
    
    log::info!("Starting KindlyKlanKlient...");
    
    // Global state for tracking active downloads
    use std::sync::{Arc, Mutex};
    let is_downloading = Arc::new(Mutex::new(false));
    let minecraft_processes: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
    
    tauri::Builder::default()
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Establecer el título de la ventana con la versión desde Cargo.toml
            if let Some(window) = app.get_webview_window("main") {
                let version = app.package_info().version.to_string();
                let title = format!("Kindly Klan Klient v{}", version);
                let _ = window.set_title(&title);
            }
            Ok(())
        })
        .manage(is_downloading)
        .manage(minecraft_processes.clone())
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<Arc<Mutex<bool>>>() {
                    if let Ok(downloading) = state.lock() {
                        if *downloading {
                            // Emit event to frontend to show dialog
                            let _ = window.emit("close-requested-during-download", ());
                            api.prevent_close();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_versions,
            launch_game,
            start_microsoft_auth,
            load_distribution_manifest,
            get_instance_background_video,
            get_instance_details,
            download_instance,
            create_instance_directory,
            launch_minecraft_with_java,
            get_required_java_version_command,
            check_java_version,
            download_java,
            set_downloading_state,
            get_java_path,
            stop_minecraft_instance,
            restart_application,
            get_system_ram,
            save_ram_config,
            load_ram_config,
            save_advanced_config,
            load_advanced_config,
            check_for_updates,
            install_update,
            get_update_state,
            save_update_state_command,
            download_update_silent,
            check_whitelist_access,
            get_accessible_instances,
            clear_whitelist_cache,
            open_url,
            debug_env_vars,
            save_session,
            get_session,
            get_active_session,
            update_session,
            delete_session,
            clear_all_sessions,
            cleanup_expired_sessions,
            debug_sessions,
            refresh_session,
            get_db_path,
            validate_and_refresh_token,
            ensure_valid_session,
            get_minecraft_profile_safe,
            clear_update_state,
            download_instance_assets,
            test_manifest_url,
            // Admin system
            check_is_admin,
            // Versions
            get_minecraft_versions,
            get_fabric_loader_versions,
            // Local instances
            create_local_instance,
            get_local_instances,
            sync_mods_from_remote,
            open_instance_folder,
            rename_local_instance,
            launch_local_instance,
            delete_local_instance,
            // Forge and NeoForge
            get_forge_versions,
            get_recommended_forge_version,
            get_neoforge_versions,
            get_recommended_neoforge_version,
            // Skin management
            upload_skin_to_mojang,
            set_skin_variant,
            create_temp_file,
            save_skin_file,
            load_skin_file,
            delete_skin_file,
            list_skin_files,
            // Frontend logging
            log_frontend_error,
            get_frontend_logs,
            clear_frontend_logs,
            open_frontend_log_folder,
            open_backend_log_folder,
            toggle_devtools,
            // Modrinth API
            search_modrinth_mods,
            get_modrinth_project_versions,
            get_modrinth_version_dependencies,
            download_modrinth_mod,
            download_modrinth_mod_with_dependencies,
            // Copy folders
            copy_instance_folders,
            list_minecraft_worlds,
            list_installed_mods,
            // Discord RPC
            initialize_discord_rpc,
            update_discord_presence,
            clear_discord_presence,
            shutdown_discord_rpc,
            is_discord_rpc_enabled,
            load_discord_rpc_config,
            save_discord_rpc_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running kindly klan klient");
}