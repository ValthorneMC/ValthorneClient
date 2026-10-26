//! Client side of the distribution pipeline: signed manifest, content-addressed
//! downloads through presigned R2 URLs, and pruning of what the manifest dropped.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::models::{LaunchSettings, ModLoader};

/// Base URL of the distribution Worker (no trailing slash).
const API_URL: &str = "https://valthorne-dist.alonsocuetoj.workers.dev";
const MANIFEST_PUBLIC_KEY: &str = "KuVi6i4G/YXGQWOQcy5SWmOOKl2fLNsmJhCA3ZkEOZU=";

const PARALLEL_DOWNLOADS: usize = 16;
const SIGN_BATCH: usize = 200;
const MAX_ATTEMPTS: u32 = 3;
const STATE_FILE: &str = ".valthorne_state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub version: String,
    pub name: String,
    pub description: String,
    pub minecraft_version: String,
    pub mod_loader: Option<ModLoader>,
    pub launch_settings: LaunchSettings,
    pub published_at: String,
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub target: String,
    pub kind: String,
    pub policy: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Deserialize)]
struct Envelope {
    payload: String,
    signature: String,
}

/// Files this module installed outside the mods store, so removed ones can be deleted later.
#[derive(Default, Serialize, Deserialize)]
struct InstallState {
    managed: Vec<String>,
}

fn api_url() -> Result<&'static str, String> {
    if API_URL.contains("REPLACE_ME") {
        return Err("API_URL en src-tauri/src/dist.rs no esta configurada".to_string());
    }
    Ok(API_URL)
}

fn cache_path() -> PathBuf {
    crate::utils::valthorne_dir().join("manifest-cache.json")
}

/// Directory Fabric reads through `-Dfabric.addMods`; fully owned by the sync.
pub fn mods_store_dir(instance_dir: &Path) -> PathBuf {
    instance_dir.join("libraries").join("valthorne")
}

fn mod_blob_path(instance_dir: &Path, sha256: &str) -> PathBuf {
    mods_store_dir(instance_dir).join(&sha256[..2]).join(format!("{sha256}.jar"))
}

fn verify_envelope(bytes: &[u8]) -> Result<Manifest, String> {
    verify_envelope_with(bytes, MANIFEST_PUBLIC_KEY)
}

fn verify_envelope_with(bytes: &[u8], public_key: &str) -> Result<Manifest, String> {
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|e| format!("Manifest envelope invalid: {e}"))?;

    let key_bytes: [u8; 32] = STANDARD
        .decode(public_key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("Manifest public key is malformed")?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("Manifest public key invalid: {e}"))?;

    let sig_bytes = STANDARD.decode(&envelope.signature).map_err(|e| format!("Manifest signature invalid: {e}"))?;
    let signature = Signature::try_from(sig_bytes.as_slice()).map_err(|e| format!("Manifest signature invalid: {e}"))?;
    key.verify(envelope.payload.as_bytes(), &signature)
        .map_err(|_| "Manifest signature does not match; refusing to use it".to_string())?;

    let manifest: Manifest = serde_json::from_str(&envelope.payload).map_err(|e| format!("Manifest invalid: {e}"))?;
    if manifest.schema != 2 {
        return Err(format!("Unsupported manifest schema {}", manifest.schema));
    }
    for file in &manifest.files {
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(format!("Manifest entry {} has a malformed hash", file.path));
        }
    }
    Ok(manifest)
}

/// Fetches the signed manifest; falls back to the last verified copy only when offline.
pub async fn fetch_manifest() -> Result<Manifest, String> {
    let url = format!("{}/v1/manifest", api_url()?);
    let response = crate::http_client::HTTP_CLIENT.get(&url).send().await.and_then(|r| r.error_for_status());

    match response {
        Ok(response) => {
            let bytes = response.bytes().await.map_err(|e| format!("Failed to read manifest: {e}"))?;
            let manifest = verify_envelope(&bytes)?;
            let _ = tokio::fs::write(cache_path(), &bytes).await;
            Ok(manifest)
        }
        Err(network_error) => {
            log::warn!("Manifest fetch failed ({network_error}); trying cached copy");
            let bytes = tokio::fs::read(cache_path())
                .await
                .map_err(|_| format!("Failed to fetch manifest: {network_error}"))?;
            verify_envelope(&bytes)
        }
    }
}

async fn sign_urls(client: &reqwest::Client, hashes: &[String]) -> Result<HashMap<String, String>, String> {
    #[derive(Deserialize)]
    struct Reply {
        urls: HashMap<String, String>,
    }
    let mut urls = HashMap::new();
    for batch in hashes.chunks(SIGN_BATCH) {
        let response = client
            .post(format!("{}/v1/sign", api_url()?))
            .json(&serde_json::json!({ "hashes": batch }))
            .send()
            .await
            .map_err(|e| format!("Failed to request download URLs: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("Download URLs refused (HTTP {})", response.status()));
        }
        urls.extend(response.json::<Reply>().await.map_err(|e| e.to_string())?.urls);
    }
    Ok(urls)
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("ValthorneClient/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

struct Job {
    sha256: String,
    size: u64,
    dest: PathBuf,
}

async fn download_job(client: &reqwest::Client, url: &str, job: &Job, progress: &AtomicU64) -> Result<(), String> {
    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let mut counted = 0u64;
        match try_download(client, url, job, progress, &mut counted).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                progress.fetch_sub(counted, Ordering::Relaxed);
                last_error = e;
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * (1 << attempt))).await;
                }
            }
        }
    }
    Err(format!("{}: {}", job.dest.display(), last_error))
}

async fn try_download(client: &reqwest::Client, url: &str, job: &Job, progress: &AtomicU64, counted: &mut u64) -> Result<(), String> {
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let parent = job.dest.parent().ok_or("invalid destination")?;
    tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;

    let mut part_name = job.dest.file_name().ok_or("invalid destination")?.to_os_string();
    part_name.push(".vpart");
    let part = parent.join(part_name);

    let result = write_verified(response, &part, job, progress, counted).await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
        return result;
    }
    tokio::fs::rename(&part, &job.dest).await.map_err(|e| e.to_string())
}

async fn write_verified(
    response: reqwest::Response,
    part: &Path,
    job: &Job,
    progress: &AtomicU64,
    counted: &mut u64,
) -> Result<(), String> {
    let mut file = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut written = 0u64;

    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        written += chunk.len() as u64;
        *counted += chunk.len() as u64;
        progress.fetch_add(chunk.len() as u64, Ordering::Relaxed);
    }
    file.flush().await.map_err(|e| e.to_string())?;

    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if written != job.size || actual != job.sha256 {
        return Err(format!("checksum mismatch (expected {}, got {})", job.sha256, actual));
    }
    Ok(())
}

fn sha256_of_file(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

async fn file_matches(path: PathBuf, file: &ManifestFile) -> bool {
    let (sha, size) = (file.sha256.clone(), file.size);
    tokio::task::spawn_blocking(move || {
        std::fs::metadata(&path).map(|m| m.len() == size).unwrap_or(false) && sha256_of_file(&path).as_deref() == Some(sha.as_str())
    })
    .await
    .unwrap_or(false)
}

/// Install path relative to the instance dir; rejects anything that could escape it.
fn safe_target(target: &str) -> Result<String, String> {
    if target.contains('\\') || target.contains(':') || target.starts_with('/') {
        return Err(format!("Unsafe install path in manifest: {target}"));
    }
    let rel = crate::instances::normalize_install_path(target);
    if rel.is_empty() || rel.split('/').any(|p| p == "..") {
        return Err(format!("Unsafe install path in manifest: {target}"));
    }
    Ok(rel)
}

fn emit_progress(app: &AppHandle, done: u64, total: u64) {
    let fraction = if total == 0 { 1.0 } else { (done as f64 / total as f64).min(1.0) };
    let _ = app.emit(
        "asset-download-progress",
        serde_json::json!({
            "current": done,
            "total": total,
            "percentage": 90.0 + 10.0 * fraction,
            "current_file": "",
            "status": "Instance",
        }),
    );
}

/// Brings the instance in line with the manifest: downloads what is missing or changed,
/// and removes what the manifest no longer lists. Fails if anything cannot be installed.
pub async fn sync_instance(app: &AppHandle, instance_dir: &Path, manifest: &Manifest) -> Result<(), String> {
    remove_legacy_mods(instance_dir).await;

    let mut jobs: Vec<Job> = Vec::new();
    let mut expected_mods: HashSet<PathBuf> = HashSet::new();
    let mut managed: Vec<String> = Vec::new();
    let mut once: HashSet<String> = HashSet::new();

    for file in &manifest.files {
        match file.kind.as_str() {
            "asset" => {}
            "mod" => {
                let dest = mod_blob_path(instance_dir, &file.sha256);
                expected_mods.insert(dest.clone());
                // The file name is its hash, so a size match is enough once it was verified on download.
                let present = std::fs::metadata(&dest).map(|m| m.len() == file.size).unwrap_or(false);
                if !present {
                    jobs.push(Job { sha256: file.sha256.clone(), size: file.size, dest });
                }
            }
            _ => {
                let rel = safe_target(&file.target)?;
                let dest = instance_dir.join(&rel);
                if file.policy == "once" {
                    once.insert(rel);
                    if !dest.exists() {
                        jobs.push(Job { sha256: file.sha256.clone(), size: file.size, dest });
                    }
                } else {
                    managed.push(rel);
                    if !file_matches(dest.clone(), file).await {
                        jobs.push(Job { sha256: file.sha256.clone(), size: file.size, dest });
                    }
                }
            }
        }
    }

    if !jobs.is_empty() {
        download_jobs(app, jobs, true).await?;
    }

    prune_mods(&mods_store_dir(instance_dir), &expected_mods);
    prune_managed(instance_dir, &managed, &once).await;
    Ok(())
}

async fn download_jobs(app: &AppHandle, jobs: Vec<Job>, report: bool) -> Result<(), String> {
    let client = download_client()?;

    let mut hashes: Vec<String> = jobs.iter().map(|j| j.sha256.clone()).collect();
    hashes.sort();
    hashes.dedup();
    let urls = sign_urls(&client, &hashes).await?;

    let total: u64 = jobs.iter().map(|j| j.size).sum();
    let progress = Arc::new(AtomicU64::new(0));

    let ticker = {
        let (app, progress) = (app.clone(), progress.clone());
        tokio::spawn(async move {
            loop {
                if report {
                    emit_progress(&app, progress.load(Ordering::Relaxed), total);
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        })
    };

    let results: Vec<Result<(), String>> = stream::iter(jobs)
        .map(|job| {
            let (client, progress) = (client.clone(), progress.clone());
            let url = urls.get(&job.sha256).cloned();
            async move {
                let url = url.ok_or_else(|| format!("No download URL for {}", job.sha256))?;
                download_job(&client, &url, &job, &progress).await
            }
        })
        .buffer_unordered(PARALLEL_DOWNLOADS)
        .collect()
        .await;

    ticker.abort();
    if report {
        emit_progress(app, total, total);
    }

    let errors: Vec<String> = results.into_iter().filter_map(|r| r.err()).collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("{} archivos fallaron; primero: {}", errors.len(), errors[0]))
    }
}

fn prune_mods(store: &Path, expected: &HashSet<PathBuf>) {
    for entry in walkdir::WalkDir::new(store).contents_first(true).into_iter().flatten() {
        let path = entry.path();
        if entry.file_type().is_file() {
            if !expected.contains(path) {
                let _ = std::fs::remove_file(path);
            }
        } else if entry.depth() > 0 {
            let _ = std::fs::remove_dir(path); // only succeeds when empty
        }
    }
}

async fn prune_managed(instance_dir: &Path, managed: &[String], once: &HashSet<String>) {
    let state_path = instance_dir.join(STATE_FILE);
    let previous: InstallState = tokio::fs::read_to_string(&state_path)
        .await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let current: HashSet<&String> = managed.iter().collect();
    for rel in previous.managed.iter().filter(|r| !current.contains(r) && !once.contains(*r)) {
        if let Ok(rel) = safe_target(rel) {
            let _ = tokio::fs::remove_file(instance_dir.join(rel)).await;
        }
    }

    let state = InstallState { managed: managed.to_vec() };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = tokio::fs::write(&state_path, json).await;
    }
}

/// Earlier builds put the pack's jars straight into `mods/`; they would load twice next to the store.
async fn remove_legacy_mods(instance_dir: &Path) {
    let history_path = instance_dir.join(".manifest_history.json");
    let Ok(text) = tokio::fs::read_to_string(&history_path).await else { return };
    if let Ok(history) = serde_json::from_str::<crate::models::ManifestHistory>(&text) {
        for name in history.files.mods {
            if crate::utils::sanitize_filename_component(&name).is_ok() {
                let _ = tokio::fs::remove_file(instance_dir.join("mods").join(name)).await;
            }
        }
    }
    let _ = tokio::fs::remove_file(history_path).await;
}

/// Downloads one UI asset (e.g. the background video) next to the instance and returns its path.
pub async fn ensure_asset(app: &AppHandle, instance_dir: &Path, manifest: &Manifest, asset_path: &str) -> Result<PathBuf, String> {
    let file = manifest
        .files
        .iter()
        .find(|f| f.kind == "asset" && f.path == asset_path)
        .ok_or_else(|| format!("Asset {asset_path} is not in the manifest"))?;
    let name = Path::new(&file.path).file_name().ok_or("invalid asset path")?;
    let dest = instance_dir.join("assets").join(name);

    if file_matches(dest.clone(), file).await {
        return Ok(dest);
    }

    download_jobs(app, vec![Job { sha256: file.sha256.clone(), size: file.size, dest: dest.clone() }], false).await?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn envelope(key: &SigningKey, payload: &str) -> Vec<u8> {
        let signature = STANDARD.encode(key.sign(payload.as_bytes()).to_bytes());
        serde_json::to_vec(&serde_json::json!({ "payload": payload, "signature": signature })).unwrap()
    }

    fn payload(sha: &str) -> String {
        serde_json::json!({
            "schema": 2, "version": "1.0.0", "name": "n", "description": "d", "minecraft_version": "1.21.1",
            "mod_loader": null, "launch_settings": { "min_ram": 1, "recommended_ram": 2, "jvm_args": null },
            "published_at": "now",
            "files": [{ "path": "mods/a.jar", "target": "mods/a.jar", "kind": "mod", "policy": "managed", "sha256": sha, "size": 1 }]
        })
        .to_string()
    }

    #[test]
    fn accepts_a_correctly_signed_manifest() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let bytes = envelope(&key, &payload(&"a".repeat(64)));
        assert!(verify_envelope_with(&bytes, &public).is_ok());
    }

    #[test]
    fn rejects_a_manifest_signed_by_another_key() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let bytes = envelope(&other, &payload(&"a".repeat(64)));
        assert!(verify_envelope_with(&bytes, &public).is_err());
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let signed = envelope(&key, &payload(&"a".repeat(64)));
        let mut value: serde_json::Value = serde_json::from_slice(&signed).unwrap();
        value["payload"] = serde_json::Value::String(payload(&"b".repeat(64)));
        assert!(verify_envelope_with(&serde_json::to_vec(&value).unwrap(), &public).is_err());
    }

    #[test]
    fn rejects_malformed_hashes_before_they_become_paths() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let bytes = envelope(&key, &payload("../../evil"));
        assert!(verify_envelope_with(&bytes, &public).is_err());
    }

    #[test]
    fn target_paths_cannot_escape_the_instance() {
        assert_eq!(safe_target("../x").unwrap(), "x");
        assert!(safe_target("C:/x").is_err());
        assert!(safe_target("config\\x").is_err());
        assert_eq!(safe_target("config/a.json").unwrap(), "config/a.json");
    }
}
