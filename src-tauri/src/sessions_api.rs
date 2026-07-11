use chrono::Utc;

#[tauri::command]
pub async fn save_session(
    app_handle: tauri::AppHandle,
    username: String,
    uuid: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64
) -> Result<String, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;

    let session = crate::sessions::Session::new(username.clone(), uuid, access_token, refresh_token.clone(), expires_at);
    log::info!("Attempting to save session for user: {}", username);
    log::info!("Expires at: {} (timestamp: {})", 
        chrono::DateTime::<Utc>::from_timestamp(expires_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "invalid".to_string()), 
        expires_at
    );
    session_manager.save_session(&session)
        .map_err(|e| {
            log::error!("Failed to save session: {}", e);
            format!("Failed to save session: {}", e)
        })?;
    log::info!("Session saved successfully for user: {}", username);
    Ok("Session saved successfully".to_string())
}

#[tauri::command]
pub async fn get_session(app_handle: tauri::AppHandle, username: String) -> Result<Option<crate::sessions::Session>, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    let session = session_manager.get_session(&username)
        .map_err(|e| format!("Failed to get session: {}", e))?;
    Ok(session)
}

#[tauri::command]
pub async fn get_active_session(app_handle: tauri::AppHandle) -> Result<Option<crate::sessions::Session>, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    if let Some(s) = session_manager.get_active_session()
        .map_err(|e| format!("Failed to get active session: {}", e))? { return Ok(Some(s)); }
    let all = session_manager.get_all_sessions().map_err(|e| e.to_string())?;
    if let Some(cand) = all.into_iter().find(|s| s.refresh_token.is_some()) {
        if let Ok(crate::EnsureSessionResponse::Ok { session, .. }) = super::validate_and_refresh_token(app_handle.clone(), cand.username.clone()).await {
            return Ok(Some(session));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn update_session(
    app_handle: tauri::AppHandle,
    session: crate::sessions::Session
) -> Result<String, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    session_manager.update_session(&session)
        .map_err(|e| format!("Failed to update session: {}", e))?;
    log::info!("Session updated for user: {}", session.username);
    Ok("Session updated successfully".to_string())
}

#[tauri::command]
pub async fn delete_session(app_handle: tauri::AppHandle, username: String) -> Result<String, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    session_manager.delete_session(&username)
        .map_err(|e| format!("Failed to delete session: {}", e))?;
    log::info!("Session deleted for user: {}", username);
    Ok("Session deleted successfully".to_string())
}

#[tauri::command]
pub async fn clear_all_sessions(app_handle: tauri::AppHandle) -> Result<String, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    session_manager.clear_all_sessions()
        .map_err(|e| format!("Failed to clear sessions: {}", e))?;
    log::info!("All sessions cleared");
    Ok("All sessions cleared successfully".to_string())
}

#[tauri::command]
pub async fn cleanup_expired_sessions(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    let cleaned = session_manager.cleanup_expired_sessions()
        .map_err(|e| format!("Failed to cleanup sessions: {}", e))?;
    log::info!("Cleaned up {} expired sessions", cleaned);
    Ok(cleaned)
}

#[tauri::command]
pub async fn debug_sessions(app_handle: tauri::AppHandle) -> Result<String, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    let db_path = session_manager.db_path.clone();
    let sessions = session_manager.get_all_sessions()
        .map_err(|e| format!("Failed to get sessions: {}", e))?;
    let result = format!(
        "Session Database Debug:\n\
        Database path: {:?}\n\
        Total sessions: {}\n\
        Sessions:\n{}",
        db_path,
        sessions.len(),
        sessions.iter().map(|s| format!(
            "  - {}: expires_at={}, is_expired={}",
            s.username,
            s.expires_at,
            s.is_expired()
        )).collect::<Vec<_>>().join("\n")
    );
    log::info!("Session debug info:\n{}", result);
    Ok(result)
}

#[tauri::command]
pub async fn get_db_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    Ok(manager.db_path.to_string_lossy().to_string())
}


#[tauri::command]
pub async fn refresh_session(app_handle: tauri::AppHandle, username: String) -> Result<crate::sessions::Session, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    let existing = session_manager.get_session(&username)
        .map_err(|e| format!("Failed to get session: {}", e))?;
    let Some(existing_session) = existing else { return Err("No existing session".to_string()); };
    let Some(refresh_token) = existing_session.refresh_token.clone() else { return Err("No refresh token stored".to_string()); };
    let ms_token = crate::auth_ms::refresh_ms_token(refresh_token)
        .await.map_err(|e| format!("Failed to refresh MS token: {}", e))?;
    let xbox_token = crate::auth_ms::authenticate_xbox_live(&ms_token.access_token).await
        .map_err(|e| format!("Failed Xbox Live auth: {}", e))?;
    let xsts_token = crate::auth_ms::authenticate_xsts(&xbox_token.token).await
        .map_err(|e| format!("Failed XSTS auth: {}", e))?;
    let mc_token = crate::auth_ms::authenticate_minecraft(&xsts_token).await
        .map_err(|e| format!("Failed Minecraft auth: {}", e))?;
    let profile = crate::auth_ms::get_minecraft_profile_from_token(&mc_token.access_token).await
        .map_err(|e| format!("Failed to get Minecraft profile: {}", e))?;
    let mc_uuid = profile["id"].as_str().unwrap_or("").to_string();
    let new_expires_at = (chrono::Utc::now() + chrono::Duration::days(90)).timestamp();
    let mut updated = existing_session.clone();
    updated.uuid = mc_uuid;
    updated.access_token = mc_token.access_token.clone();
    updated.refresh_token = ms_token.refresh_token.clone();
    updated.expires_at = new_expires_at;
    updated.updated_at = chrono::Utc::now().timestamp();
    session_manager.update_session(&updated)
        .map_err(|e| format!("Failed to update session: {}", e))?;
    Ok(updated)
}

#[tauri::command]
pub async fn validate_and_refresh_token(app_handle: tauri::AppHandle, username: String) -> Result<crate::EnsureSessionResponse, String> {
    let session_manager = crate::sessions::SessionManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize session manager: {}", e))?;
    let existing = session_manager.get_session(&username)
        .map_err(|e| format!("Failed to get session: {}", e))?;
    let Some(mut session) = existing else {
        return Ok(crate::EnsureSessionResponse::Err { code: "NO_SESSION".into(), message: "No existing session".into() });
    };
    match validate_access_token_local(&session.access_token).await {
        Ok(true) => {
            session.updated_at = Utc::now().timestamp();
            session_manager.update_session(&session)
                .map_err(|e| format!("Failed to update session: {}", e))?;
            return Ok(crate::EnsureSessionResponse::Ok { session, refreshed: false });
        },
        Ok(false) => {},
        Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "VALIDATION".into(), message: e })
    }
    if let Some(refresh_token) = session.refresh_token.clone() {
        match crate::refresh_ms_token(refresh_token).await {
            Ok(ms) => {
                match crate::authenticate_xbox_live(&ms.access_token).await {
                    Ok(xbl) => match crate::authenticate_xsts(&xbl.token).await {
                        Ok(xsts) => match crate::authenticate_minecraft(&xsts).await {
                            Ok(mc) => match fetch_profile_json(&mc.access_token).await {
                                Ok(profile) => {
                                    let mc_uuid = profile["id"].as_str().unwrap_or("").to_string();
                                    session.uuid = mc_uuid;
                                    session.access_token = mc.access_token;
                                    session.refresh_token = ms.refresh_token;
                                    session.expires_at = (Utc::now() + chrono::Duration::days(90)).timestamp();
                                    session.updated_at = Utc::now().timestamp();
                                    session_manager.update_session(&session)
                                        .map_err(|e| format!("Failed to update session: {}", e))?;
                                    return Ok(crate::EnsureSessionResponse::Ok { session, refreshed: true });
                                },
                                Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "MC_PROFILE_FETCH".into(), message: e.to_string() })
                            },
                            Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "MC_PROFILE".into(), message: e.to_string() })
                        },
                        Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "XSTS".into(), message: e.to_string() })
                    },
                    Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "XBL".into(), message: e.to_string() })
                }
            },
            Err(e) => return Ok(crate::EnsureSessionResponse::Err { code: "REFRESH_FAILED".into(), message: e.to_string() })
        }
    } else {
        return Ok(crate::EnsureSessionResponse::Err { code: "NO_REFRESH".into(), message: "No refresh token available".into() })
    }
}

#[tauri::command]
pub async fn ensure_valid_session(app_handle: tauri::AppHandle, username: String) -> Result<crate::EnsureSessionResponse, String> {
    validate_and_refresh_token(app_handle, username).await
}

async fn validate_access_token_local(access_token: &str) -> Result<bool, String> {
    match fetch_profile_json(access_token).await {
        Ok(_) => Ok(true),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("401") || err_str.contains("Unauthorized") { Ok(false) } else { Err(err_str) }
        }
    }
}

async fn fetch_profile_json(access_token: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Failed to get profile: HTTP {}", response.status())); }
    response.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

