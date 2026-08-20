//! Microsoft/Xbox Live "SISU" (Sign In and Set Up) authentication flow, the same one used
//! by the official Minecraft Launcher and by Modrinth App. Ported from Modrinth App's
//! `packages/app-lib/src/state/minecraft_auth.rs`.
//!
//! Unlike the plain OAuth "authorization code" flow, the official launcher client ID
//! (`MICROSOFT_CLIENT_ID`) requires every Xbox Live request to be signed with an ECDSA
//! P-256 key tied to a registered "device". That device identity is generated once and
//! persisted (see [`crate::sessions::DeviceTokenRecord`]) so we don't re-register a new
//! device with Xbox Live on every login.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD as BASE64_URL_SAFE_NO_PAD};
use chrono::{DateTime, TimeZone, Utc};
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::Generate;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};
use reqwest::header::HeaderMap;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use sha2::Digest;
use std::collections::HashMap;
use uuid::Uuid;

use crate::sessions::{DeviceTokenRecord, SessionManager};

const MICROSOFT_CLIENT_ID: &str = "00000000402b5328";
pub const AUTH_REPLY_URL: &str = "https://login.live.com/oauth20_desktop.srf";
const REQUESTED_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

pub struct MinecraftLoginFlow {
    pub verifier: String,
    pub session_id: String,
    pub auth_request_uri: String,
}

pub struct MinecraftLoginResult {
    pub access_token: String,
    pub refresh_token: String,
}

/// Starts a login: registers/refreshes the device identity, then asks Xbox Live's SISU
/// endpoint for a Microsoft login URL to send the user to.
pub async fn login_begin(sessions: &SessionManager) -> Result<MinecraftLoginFlow, String> {
    let (key, device_token) = get_or_refresh_device_token(sessions).await?;

    let verifier = generate_oauth_challenge();
    let challenge = BASE64_URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(&verifier));

    let (session_id, redirect) = sisu_authenticate(&device_token.token, &challenge, &key).await?;

    Ok(MinecraftLoginFlow {
        verifier,
        session_id,
        auth_request_uri: redirect.msa_oauth_redirect,
    })
}

/// Finishes a login started with [`login_begin`], given the authorization `code` captured
/// from the embedded login window once it navigates to [`AUTH_REPLY_URL`].
pub async fn login_finish(
    code: &str,
    flow: MinecraftLoginFlow,
    sessions: &SessionManager,
) -> Result<MinecraftLoginResult, String> {
    let (key, device_token) = get_or_refresh_device_token(sessions).await?;

    let oauth_token = oauth_token(code, &flow.verifier).await?;

    let sisu_authorize = sisu_authorize(
        Some(&flow.session_id),
        &oauth_token.access_token,
        &device_token.token,
        &key,
    )
    .await?;

    let xbox_token = xsts_authorize(&sisu_authorize, &device_token.token, &key).await?;
    let minecraft_token = minecraft_token(&xbox_token).await?;

    minecraft_entitlements(&minecraft_token.access_token).await?;

    Ok(MinecraftLoginResult {
        access_token: minecraft_token.access_token,
        refresh_token: oauth_token.refresh_token,
    })
}

/// Refreshes an existing Microsoft refresh token all the way through to a fresh Minecraft
/// access token, redoing the Xbox Live/XSTS chain (there is no way to refresh a Minecraft
/// token directly - it has to be re-derived from a fresh Microsoft OAuth token every time).
pub async fn refresh_full(
    refresh_token: &str,
    sessions: &SessionManager,
) -> Result<MinecraftLoginResult, String> {
    let (key, device_token) = get_or_refresh_device_token(sessions).await?;

    let oauth_token = oauth_refresh(refresh_token).await?;

    let sisu_authorize = sisu_authorize(
        None,
        &oauth_token.access_token,
        &device_token.token,
        &key,
    )
    .await?;

    let xbox_token = xsts_authorize(&sisu_authorize, &device_token.token, &key).await?;
    let minecraft_token = minecraft_token(&xbox_token).await?;

    Ok(MinecraftLoginResult {
        access_token: minecraft_token.access_token,
        refresh_token: oauth_token.refresh_token,
    })
}

// ---------------------------------------------------------------------------------------
// Device identity (ECDSA key pair + Xbox Live device token)
// ---------------------------------------------------------------------------------------

struct DeviceTokenKey {
    id: Uuid,
    key: SigningKey,
    x: String,
    y: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct DeviceToken {
    issue_instant: DateTime<Utc>,
    not_after: DateTime<Utc>,
    token: String,
    display_claims: HashMap<String, serde_json::Value>,
}

async fn get_or_refresh_device_token(
    sessions: &SessionManager,
) -> Result<(DeviceTokenKey, DeviceToken), String> {
    let existing = sessions
        .get_device_token()
        .map_err(|e| format!("Failed to read device identity: {}", e))?;

    if let Some(record) = existing {
        if let (Ok(id), Ok(private_key)) = (
            Uuid::parse_str(&record.device_uuid),
            SigningKey::from_pkcs8_pem(&record.private_key_pem),
        ) {
            let key = DeviceTokenKey { id, key: private_key, x: record.x, y: record.y };
            let not_after = Utc.timestamp_opt(record.not_after, 0).single().unwrap_or_else(Utc::now);

            if not_after > Utc::now() {
                let display_claims: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&record.display_claims).unwrap_or_default();
                let token = DeviceToken {
                    issue_instant: Utc.timestamp_opt(record.issue_instant, 0).single().unwrap_or_else(Utc::now),
                    not_after,
                    token: record.token,
                    display_claims,
                };
                return Ok((key, token));
            }

            // Expired: re-register the same key, keeping the same device identity.
            let token = device_token(&key).await?;
            persist_device_token(sessions, &key, &token)?;
            return Ok((key, token));
        }
    }

    let key = generate_key()?;
    let token = device_token(&key).await?;
    persist_device_token(sessions, &key, &token)?;
    Ok((key, token))
}

fn persist_device_token(
    sessions: &SessionManager,
    key: &DeviceTokenKey,
    token: &DeviceToken,
) -> Result<(), String> {
    let private_key_pem = key
        .key
        .to_pkcs8_pem(LineEnding::default())
        .map_err(|e| format!("Failed to serialize device key: {}", e))?
        .to_string();

    let record = DeviceTokenRecord {
        device_uuid: key.id.to_string(),
        private_key_pem,
        x: key.x.clone(),
        y: key.y.clone(),
        issue_instant: token.issue_instant.timestamp(),
        not_after: token.not_after.timestamp(),
        token: token.token.clone(),
        display_claims: serde_json::to_string(&token.display_claims).unwrap_or_else(|_| "{}".to_string()),
    };

    sessions
        .save_device_token(&record)
        .map_err(|e| format!("Failed to persist device identity: {}", e))
}

fn generate_key() -> Result<DeviceTokenKey, String> {
    let signing_key = SigningKey::generate();
    let public_key = VerifyingKey::from(&signing_key);
    let encoded_point = public_key.to_sec1_point(false);

    Ok(DeviceTokenKey {
        id: Uuid::new_v4(),
        key: signing_key,
        x: BASE64_URL_SAFE_NO_PAD.encode(encoded_point.x().ok_or("Failed to read device public key")?),
        y: BASE64_URL_SAFE_NO_PAD.encode(encoded_point.y().ok_or("Failed to read device public key")?),
    })
}

async fn device_token(key: &DeviceTokenKey) -> Result<DeviceToken, String> {
    send_signed_request(
        None,
        "https://device.auth.xboxlive.com/device/authenticate",
        "/device/authenticate",
        json!({
            "Properties": {
                "AuthMethod": "ProofOfPossession",
                "Id": format!("{{{}}}", key.id.to_string().to_uppercase()),
                "DeviceType": "Win32",
                "Version": "10.16.0",
                "ProofKey": {
                    "kty": "EC", "x": key.x, "y": key.y, "crv": "P-256", "alg": "ES256", "use": "sig"
                }
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }),
        key,
    )
    .await
    .map(|r| r.body)
}

// ---------------------------------------------------------------------------------------
// SISU authenticate / authorize
// ---------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RedirectUri {
    msa_oauth_redirect: String,
}

async fn sisu_authenticate(
    device_token: &str,
    challenge: &str,
    key: &DeviceTokenKey,
) -> Result<(String, RedirectUri), String> {
    let res = send_signed_request::<RedirectUri>(
        None,
        "https://sisu.xboxlive.com/authenticate",
        "/authenticate",
        json!({
            "AppId": MICROSOFT_CLIENT_ID,
            "DeviceToken": device_token,
            "Offers": [REQUESTED_SCOPE],
            "Query": {
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": generate_oauth_challenge(),
                "prompt": "select_account"
            },
            "RedirectUri": AUTH_REPLY_URL,
            "Sandbox": "RETAIL",
            "TokenType": "code",
            "TitleId": "1794566092",
        }),
        key,
    )
    .await?;

    let session_id = res
        .headers
        .get("X-SessionId")
        .and_then(|x| x.to_str().ok())
        .ok_or("Missing X-SessionId header from Xbox Live")?
        .to_string();

    Ok((session_id, res.body))
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SisuAuthorize {
    title_token: DeviceToken,
    user_token: DeviceToken,
}

async fn sisu_authorize(
    session_id: Option<&str>,
    access_token: &str,
    device_token: &str,
    key: &DeviceTokenKey,
) -> Result<SisuAuthorize, String> {
    send_signed_request(
        None,
        "https://sisu.xboxlive.com/authorize",
        "/authorize",
        json!({
            "AccessToken": format!("t={access_token}"),
            "AppId": MICROSOFT_CLIENT_ID,
            "DeviceToken": device_token,
            "ProofKey": {
                "kty": "EC", "x": key.x, "y": key.y, "crv": "P-256", "alg": "ES256", "use": "sig"
            },
            "Sandbox": "RETAIL",
            "SessionId": session_id,
            "SiteName": "user.auth.xboxlive.com",
            "RelyingParty": "http://xboxlive.com",
            "UseModernGamertag": true
        }),
        key,
    )
    .await
    .map(|r| r.body)
}

async fn xsts_authorize(
    authorize: &SisuAuthorize,
    device_token: &str,
    key: &DeviceTokenKey,
) -> Result<DeviceToken, String> {
    send_signed_request(
        None,
        "https://xsts.auth.xboxlive.com/xsts/authorize",
        "/xsts/authorize",
        json!({
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [authorize.user_token.token],
                "DeviceToken": device_token,
                "TitleToken": authorize.title_token.token,
            },
        }),
        key,
    )
    .await
    .map(|r| r.body)
}

// ---------------------------------------------------------------------------------------
// Microsoft OAuth (login.live.com)
// ---------------------------------------------------------------------------------------

struct OAuthToken {
    #[allow(dead_code)] // part of Microsoft's actual response shape; we use a fixed session validity window instead
    expires_in: u64,
    access_token: String,
    refresh_token: String,
}

impl<'de> Deserialize<'de> for OAuthToken {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            expires_in: u64,
            access_token: String,
            refresh_token: String,
        }
        let raw = Raw::deserialize(deserializer)?;
        Ok(OAuthToken { expires_in: raw.expires_in, access_token: raw.access_token, refresh_token: raw.refresh_token })
    }
}

async fn oauth_token(code: &str, verifier: &str) -> Result<OAuthToken, String> {
    let mut query = HashMap::new();
    query.insert("client_id", MICROSOFT_CLIENT_ID);
    query.insert("code", code);
    query.insert("code_verifier", verifier);
    query.insert("grant_type", "authorization_code");
    query.insert("redirect_uri", AUTH_REPLY_URL);
    query.insert("scope", REQUESTED_SCOPE);
    post_oauth_form(&query).await
}

async fn oauth_refresh(refresh_token: &str) -> Result<OAuthToken, String> {
    let mut query = HashMap::new();
    query.insert("client_id", MICROSOFT_CLIENT_ID);
    query.insert("refresh_token", refresh_token);
    query.insert("grant_type", "refresh_token");
    query.insert("redirect_uri", AUTH_REPLY_URL);
    query.insert("scope", REQUESTED_SCOPE);
    post_oauth_form(&query).await
}

async fn post_oauth_form(query: &HashMap<&str, &str>) -> Result<OAuthToken, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://login.live.com/oauth20_token.srf")
        .header("Accept", "application/json")
        .form(query)
        .send()
        .await
        .map_err(|e| format!("Microsoft token request failed: {}", e))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Microsoft token request failed ({}): {}", status, text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse Microsoft token response: {} (body: {})", e, text))
}

// ---------------------------------------------------------------------------------------
// Minecraft services
// ---------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct MinecraftTokenResponse {
    access_token: String,
}

async fn minecraft_token(token: &DeviceToken) -> Result<MinecraftTokenResponse, String> {
    let uhs = token
        .display_claims
        .get("xui")
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("uhs"))
        .and_then(|x| x.as_str())
        .ok_or("Failed to read Xbox Live user hash")?;

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.minecraftservices.com/launcher/login")
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .json(&json!({
            "platform": "PC_LAUNCHER",
            "xtoken": format!("XBL3.0 x={uhs};{}", token.token),
        }))
        .send()
        .await
        .map_err(|e| format!("Minecraft login request failed: {}", e))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Minecraft login failed ({}): {}", status, text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse Minecraft login response: {} (body: {})", e, text))
}

async fn minecraft_entitlements(access_token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("https://api.minecraftservices.com/entitlements/license?requestId={}", Uuid::new_v4()))
        .header("Accept", "application/json")
        .header("User-Agent", crate::MINECRAFT_SERVICES_USER_AGENT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to check Minecraft entitlements: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("This account does not own Minecraft ({}): {}", status, text));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Signed request plumbing
// ---------------------------------------------------------------------------------------

struct SignedRequestResponse<T> {
    headers: HeaderMap,
    body: T,
}

/// Sends a POST request to an Xbox Live endpoint, signed the way Xbox Live's SISU system
/// requires: a `Signature` header computed as `ES256(timestamp || "POST" || path || body)`
/// over the raw request body, using the device's private key.
async fn send_signed_request<T: DeserializeOwned>(
    authorization: Option<&str>,
    url: &str,
    url_path: &str,
    raw_body: serde_json::Value,
    key: &DeviceTokenKey,
) -> Result<SignedRequestResponse<T>, String> {
    let auth_bytes = authorization.map_or(Vec::new(), |v| v.as_bytes().to_vec());
    let body = serde_json::to_vec(&raw_body).map_err(|e| format!("Failed to serialize request body: {}", e))?;

    // Windows FILETIME-style timestamp (100ns intervals since 1601-01-01), as Xbox Live expects.
    let time: u128 = ((Utc::now().timestamp() as u128) + 11644473600) * 10000000;

    let mut buffer = Vec::new();
    buffer.extend_from_slice(&1_u32.to_be_bytes());
    buffer.push(0);
    buffer.extend_from_slice(&(time as u64).to_be_bytes());
    buffer.push(0);
    buffer.extend_from_slice(b"POST");
    buffer.push(0);
    buffer.extend_from_slice(url_path.as_bytes());
    buffer.push(0);
    buffer.extend_from_slice(&auth_bytes);
    buffer.push(0);
    buffer.extend_from_slice(&body);
    buffer.push(0);

    let signature: Signature = key.key.sign(&buffer);

    let mut sig_buffer = Vec::new();
    sig_buffer.extend_from_slice(&1_i32.to_be_bytes());
    sig_buffer.extend_from_slice(&(time as u64).to_be_bytes());
    sig_buffer.extend_from_slice(&signature.r().to_bytes());
    sig_buffer.extend_from_slice(&signature.s().to_bytes());
    let signature_header = BASE64_STANDARD.encode(&sig_buffer);

    let client = reqwest::Client::new();
    let mut request = client
        .post(url)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "application/json")
        .header("Signature", &signature_header);

    if url != "https://sisu.xboxlive.com/authorize" {
        request = request.header("x-xbl-contract-version", "1");
    }
    if let Some(auth) = authorization {
        request = request.header("Authorization", auth);
    }

    let response = request
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Xbox Live request to {} failed: {}", url, e))?;

    let status = response.status();
    let headers = response.headers().clone();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Xbox Live request to {} failed ({}): {}", url, status, text));
    }

    let parsed_body = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse response from {}: {} (body: {})", url, e, text))?;

    Ok(SignedRequestResponse { headers, body: parsed_body })
}

fn generate_oauth_challenge() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.r#gen::<u8>()).collect();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
