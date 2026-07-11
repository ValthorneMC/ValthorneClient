use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MicrosoftAuthResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
    pub scope: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct XboxLiveAuthResponse {
    #[serde(rename = "IssueInstant")]
    pub issue_instant: String,
    #[serde(rename = "NotAfter")]
    pub not_after: String,
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: HashMap<String, Vec<HashMap<String, String>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct XstsAuthResponse {
    #[serde(rename = "IssueInstant")]
    pub issue_instant: String,
    #[serde(rename = "NotAfter")]
    pub not_after: String,
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: HashMap<String, Vec<HashMap<String, String>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MinecraftAuthResponse {
    pub username: String,
    pub roles: Vec<String>,
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
}


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

pub async fn exchange_auth_code_for_token(auth_code: String, port: u16) -> anyhow::Result<MicrosoftAuthResponse> {
    let client = reqwest::Client::new();
    let redirect_uri = format!("http://localhost:{}", port);
    let params = [
        ("client_id", crate::AZURE_CLIENT_ID),
        ("scope", "XboxLive.signin offline_access"),
        ("code", auth_code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await?;
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Token exchange failed: {}", error_text));
    }
    Ok(response.json::<MicrosoftAuthResponse>().await?)
}

pub async fn authenticate_xbox_live(access_token: &str) -> anyhow::Result<XboxLiveAuthResponse> {
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", access_token)},
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let response = client.post("https://user.auth.xboxlive.com/user/authenticate").header("Content-Type", "application/json").header("Accept", "application/json").json(&payload).send().await?;
    if !response.status().is_success() { let error_text = response.text().await.unwrap_or_default(); return Err(anyhow::anyhow!("Xbox Live auth failed: {}", error_text)); }
    Ok(response.json::<XboxLiveAuthResponse>().await?)
}

pub async fn authenticate_xsts(xbox_token: &str) -> anyhow::Result<XstsAuthResponse> {
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "Properties": {"SandboxId": "RETAIL", "UserTokens": [xbox_token]},
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    let response = client.post("https://xsts.auth.xboxlive.com/xsts/authorize").header("Content-Type", "application/json").header("Accept", "application/json").json(&payload).send().await?;
    if !response.status().is_success() { let error_text = response.text().await.unwrap_or_default(); return Err(anyhow::anyhow!("XSTS auth failed: {}", error_text)); }
    Ok(response.json::<XstsAuthResponse>().await?)
}

pub async fn authenticate_minecraft(xsts_response: &XstsAuthResponse) -> anyhow::Result<MinecraftAuthResponse> {
    let client = reqwest::Client::new();
    let user_hash = xsts_response.display_claims.get("xui").and_then(|claims| claims.first()).and_then(|claim| claim.get("uhs")).ok_or_else(|| anyhow::anyhow!("Failed to extract user hash from XSTS response"))?;
    let identity_token = format!("XBL3.0 x={};{}", user_hash, xsts_response.token);
    let payload = serde_json::json!({ "identityToken": identity_token });
    let response = client.post("https://api.minecraftservices.com/authentication/login_with_xbox").header("Content-Type", "application/json").header("Accept", "application/json").json(&payload).send().await?;
    if !response.status().is_success() { let error_text = response.text().await.unwrap_or_default(); return Err(anyhow::anyhow!("Minecraft auth failed: {}", error_text)); }
    Ok(response.json::<MinecraftAuthResponse>().await?)
}

pub async fn get_minecraft_profile_from_token(access_token: &str) -> anyhow::Result<serde_json::Value> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to get profile: HTTP {}", response.status()));
    }
    Ok(response.json::<serde_json::Value>().await?)
}

pub async fn refresh_ms_token(refresh_token: String) -> anyhow::Result<MicrosoftAuthResponse> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", crate::AZURE_CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("scope", "XboxLive.signin offline_access"),
    ];
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await?;
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Token refresh failed: {}", error_text));
    }
    Ok(response.json::<MicrosoftAuthResponse>().await?)
}

#[tauri::command]
pub async fn start_microsoft_auth() -> Result<crate::AuthSession, String> {
    use std::sync::{Arc, Mutex};
    use tauri_plugin_oauth::start_with_config;
    let captured_url = Arc::new(Mutex::new(None::<String>));
    let captured_url_clone = captured_url.clone();
    let config = tauri_plugin_oauth::OauthConfig { ports: None, response: Some("
    <!DOCTYPE html>
    <html>
    
    <meta charset=\"UTF-8\">
    <head>
    <title>Kindly Klan Klient</title>

    </head>
    <body>
    
    <h1>Kindly Klan Klient</h1>
    <p>Has iniciado sesión con Microsoft correctamente.</p>
    <p>Puedes cerrar esta pestaña y volver al Kliente.</p>

    </html>".into()) };
    let port = start_with_config(config, move |url| {
        let mut captured = captured_url_clone.lock().unwrap();
        *captured = Some(url);
    }).map_err(|e| format!("Failed to start OAuth server: {}", e))?;
    let auth_url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri=http://localhost:{}&scope=XboxLive.signin%20offline_access&prompt=select_account",
        crate::AZURE_CLIENT_ID, port
    );
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {}", e))?;
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(180);
    loop {
        if let Some(url) = { captured_url.lock().unwrap().clone() } {
            if let Some(code) = extract_auth_code_from_url(&url) {
                return complete_microsoft_auth_internal(code, port).await;
            } else { return Err("No authorization code found in callback URL".into()); }
        }
        if start_time.elapsed() > timeout { return Err("Authentication timeout".into()); }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

pub async fn complete_microsoft_auth_internal(auth_code: String, port: u16) -> Result<crate::AuthSession, String> {
    let ms_token = exchange_auth_code_for_token(auth_code, port)
        .await
        .map_err(|e| format!("Failed to exchange auth code: {}", e))?;

    let xbox_token = authenticate_xbox_live(&ms_token.access_token)
        .await
        .map_err(|e| format!("Failed Xbox Live auth: {}", e))?;

    let xsts_token = authenticate_xsts(&xbox_token.token)
        .await
        .map_err(|e| format!("Failed XSTS auth: {}", e))?;

    let mc_token = authenticate_minecraft(&xsts_token)
        .await
        .map_err(|e| format!("Failed Minecraft auth: {}", e))?;

    let access_token = mc_token.access_token.clone();
    let profile = crate::get_minecraft_profile_from_token(&access_token)
        .await
        .map_err(|e| format!("Failed to get profile: {}", e))?;

    let username = profile["name"].as_str().unwrap_or("Unknown");
    let uuid = profile["id"].as_str().unwrap_or("unknown");
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(90)).timestamp();

    Ok(crate::AuthSession {
        access_token,
        username: username.to_string(),
        uuid: uuid.to_string(),
        user_type: "microsoft".to_string(),
        expires_at: Some(expires_at),
        refresh_token: ms_token.refresh_token.clone(),
    })
}
