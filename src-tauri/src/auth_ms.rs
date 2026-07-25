pub fn extract_auth_code_from_url(url_str: &str) -> Option<String> {
    if let Ok(url) = tauri::Url::parse(url_str) {
        for (key, value) in url.query_pairs() {
            if key == "code" {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub async fn get_minecraft_profile_from_token(access_token: &str) -> anyhow::Result<serde_json::Value> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(access_token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to get profile: HTTP {}", response.status()));
    }
    Ok(response.json::<serde_json::Value>().await?)
}

const LOGIN_WINDOW_LABEL: &str = "ms-login";

/// Opens an embedded webview window pointed at the Microsoft login URL Xbox Live's SISU
/// endpoint gave us, and waits for it to navigate to [`crate::msa_sisu::AUTH_REPLY_URL`],
/// extracting the authorization code from that URL instead of letting the (mostly blank)
/// reply page actually load. Closing the window manually cancels the login.
///
/// Window creation itself has to happen on a separate OS thread: doing it directly inside an
/// async command deadlocks on Windows (see the `tauri::WebviewWindowBuilder::new` docs).
async fn open_login_window(app: tauri::AppHandle, auth_request_uri: &str) -> Result<String, String> {
    use tauri::Manager;

    let auth_url: tauri::Url = auth_request_uri
        .parse()
        .map_err(|e| format!("Invalid login URL: {}", e))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    let nav_tx = tx.clone();
    let close_tx = tx.clone();
    let app_for_window = app.clone();

    std::thread::spawn(move || {
        let window = tauri::WebviewWindowBuilder::new(&app_for_window, LOGIN_WINDOW_LABEL, tauri::WebviewUrl::External(auth_url))
            .title("Iniciar sesión con Microsoft")
            .inner_size(500.0, 650.0)
            .resizable(true)
            .center()
            .on_navigation(move |url| {
                let url_str = url.as_str();
                if url_str.starts_with(crate::msa_sisu::AUTH_REPLY_URL) {
                    if let Some(sender) = nav_tx.lock().unwrap().take() {
                        let result = extract_auth_code_from_url(url_str)
                            .ok_or_else(|| "No se encontró el código de autorización en la respuesta de Microsoft".to_string());
                        let _ = sender.send(result);
                    }
                    // Don't actually navigate the embedded window to the (blank) reply page.
                    return false;
                }
                true
            })
            .build();

        match window {
            Ok(win) => {
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        if let Some(sender) = close_tx.lock().unwrap().take() {
                            let _ = sender.send(Err("Inicio de sesión cancelado".to_string()));
                        }
                    }
                });
            }
            Err(e) => {
                if let Some(sender) = close_tx.lock().unwrap().take() {
                    let _ = sender.send(Err(format!("No se pudo abrir la ventana de inicio de sesión: {}", e)));
                }
            }
        }
    });

    let result = match tokio::time::timeout(std::time::Duration::from_secs(180), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Error interno esperando el inicio de sesión".to_string()),
        Err(_) => Err("Tiempo de espera agotado para iniciar sesión".to_string()),
    };

    if let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = window.close();
    }

    result
}

#[tauri::command]
pub async fn start_microsoft_auth(app: tauri::AppHandle) -> Result<crate::AuthSession, String> {
    let sessions = crate::sessions::SessionManager::new(&app)
        .map_err(|e| format!("Failed to initialize session storage: {}", e))?;

    let flow = crate::msa_sisu::login_begin(&sessions).await?;
    let code = open_login_window(app, &flow.auth_request_uri).await?;
    let result = crate::msa_sisu::login_finish(&code, flow, &sessions).await?;

    let profile = get_minecraft_profile_from_token(&result.access_token)
        .await
        .map_err(|e| format!("Failed to get profile: {}", e))?;

    let username = profile["name"].as_str().unwrap_or("Unknown");
    let uuid = profile["id"].as_str().unwrap_or("unknown");
    // Mirrors the previous flow: the stored `expires_at` is a generous session validity
    // window, not the short-lived Minecraft access token's actual expiry (~24h). Real
    // validity is checked against Mojang directly and refreshed on demand via `refresh_token`.
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(90)).timestamp();

    Ok(crate::AuthSession {
        access_token: result.access_token,
        username: username.to_string(),
        uuid: uuid.to_string(),
        user_type: "microsoft".to_string(),
        expires_at: Some(expires_at),
        refresh_token: Some(result.refresh_token),
    })
}
