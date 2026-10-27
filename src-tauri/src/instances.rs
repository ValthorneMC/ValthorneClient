use crate::models::ModLoader;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
 
use tauri::Emitter;

/// Normalizes a manifest-declared install path into an instance-relative path.
///
/// Placement is decided by the builder (`target` in the manifest); this only
/// strips legacy prefixes and rejects traversal, since the manifest is remote.
pub fn normalize_install_path(manifest_target: &str) -> String {
    let mut parts: Vec<&str> = manifest_target
        .split('/')
        .filter(|part| !matches!(*part, "" | "." | ".."))
        .collect();

    if parts.first() == Some(&"files") {
        parts.remove(0);
    }
    while parts.len() >= 2 && parts[0] == "config" && parts[1] == "config" {
        parts.remove(1);
    }

    parts.join("/")
}

pub async fn download_file(url: &str, file_path: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("ValthorneClient/1.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(300))
        .pool_max_idle_per_host(20)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .tcp_nodelay(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    download_file_with_client(&client, url, file_path).await
}

pub async fn download_file_with_client(client: &reqwest::Client, url: &str, file_path: &Path) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download from {}: {}", url, e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("HTTP error {} for {}: {}", status, url, error_text));
    }

    let parent_dir = file_path.parent().ok_or_else(|| format!("Invalid path: {}", file_path.display()))?;
    tokio::fs::create_dir_all(parent_dir).await
        .map_err(|e| format!("Failed to create parent directory {}: {}", parent_dir.display(), e))?;

    let tmp_path = file_path.with_extension("vc.tmp");
    let mut tmp_file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create temp file {}: {}", tmp_path.display(), e))?;

    // Stream chunk-by-chunk instead of buffering the whole body: with 50-100 downloads
    // running in parallel, buffering full files (mods/assets can be 100+ MB) caused
    // multi-GB memory spikes.
    while let Some(chunk) = response.chunk().await
        .map_err(|e| format!("Failed to read response bytes from {}: {}", url, e))?
    {
        tmp_file.write_all(&chunk).await
            .map_err(|e| format!("Failed to write bytes to {}: {}", tmp_path.display(), e))?;
    }

    tmp_file
        .flush()
        .await
        .map_err(|e| format!("Failed to flush temp file {}: {}", tmp_path.display(), e))?;
    tmp_file
        .sync_all()
        .await
        .map_err(|e| format!("Failed to sync temp file {}: {}", tmp_path.display(), e))?;
    drop(tmp_file);

    tokio::fs::rename(&tmp_path, file_path)
        .await
        .map_err(|e| format!("Failed to move temp file to {}: {}", file_path.display(), e))?;

    Ok(())
}

/// Delay before retry `attempt` (1-based): exponential backoff (1s, 2s, 4s, ...) capped at
/// 10s, with up to 250ms of random jitter so dozens of parallel downloads retrying after
/// the same failure don't all hammer the server again in lockstep.
fn retry_backoff(attempt: u32) -> std::time::Duration {
    use rand::RngExt;
    let base_ms = 1000u64.saturating_mul(1u64 << (attempt - 1).min(4)).min(10_000);
    let jitter_ms = rand::rng().random::<u64>() % 250;
    std::time::Duration::from_millis(base_ms + jitter_ms)
}

pub async fn download_file_with_retry(url: &str, file_path: &Path) -> Result<(), String> {
    const MAX_RETRIES: u32 = 3;

    for attempt in 1..=MAX_RETRIES {
        match download_file(url, file_path).await {
            Ok(_) => return Ok(()),
            Err(_e) => {
                if attempt < MAX_RETRIES {
                    tokio::time::sleep(retry_backoff(attempt)).await;
                }
            }
        }
    }

    Err(format!("Failed to download {} after {} attempts", url, MAX_RETRIES))
}

pub async fn download_file_with_retry_and_client(client: &reqwest::Client, url: &str, file_path: &Path) -> Result<(), String> {
    const MAX_RETRIES: u32 = 3;

    for attempt in 1..=MAX_RETRIES {
        match download_file_with_client(client, url, file_path).await {
            Ok(_) => return Ok(()),
            Err(_e) => {
                if attempt < MAX_RETRIES {
                    tokio::time::sleep(retry_backoff(attempt)).await;
                }
            }
        }
    }

    Err(format!("Failed to download {} after {} attempts", url, MAX_RETRIES))
}

pub async fn ensure_minecraft_client_present(instance_dir: &Path, mc_version: &str) -> Result<(), String> {
    let version_dir = instance_dir.join("versions").join(mc_version);
    let jar_path = version_dir.join(format!("{}.jar", mc_version));
    let json_path = version_dir.join(format!("{}.json", mc_version));

    tokio::fs::create_dir_all(&version_dir).await
        .map_err(|e| format!("Failed to create version dir {}: {}", version_dir.display(), e))?;

    if !json_path.exists() {
        let manifest_url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
        let manifest_text = crate::http_client::HTTP_CLIENT.get(manifest_url).send().await
            .map_err(|e| format!("Failed to fetch Mojang manifest: {}", e))?
            .text().await
            .map_err(|e| format!("Failed to read Mojang manifest: {}", e))?;

        #[derive(serde::Deserialize)]
        struct VmEntry { id: String, url: String }
        #[derive(serde::Deserialize)]
        struct VmRoot { versions: Vec<VmEntry> }

        let vm: VmRoot = serde_json::from_str(&manifest_text)
            .map_err(|e| format!("Failed to parse Mojang manifest: {}", e))?;
        let Some(ver) = vm.versions.into_iter().find(|v| v.id == mc_version) else {
            return Err(format!("Minecraft version {} not found in Mojang manifest", mc_version));
        };

        let vjson_text = crate::http_client::HTTP_CLIENT.get(&ver.url).send().await
            .map_err(|e| format!("Failed to fetch version json: {}", e))?
            .text().await
            .map_err(|e| format!("Failed to read version json: {}", e))?;
        tokio::fs::write(&json_path, &vjson_text).await
            .map_err(|e| format!("Failed to write version json: {}", e))?;
    }

    if !jar_path.exists() {
        let vjson_text = tokio::fs::read_to_string(&json_path).await
            .map_err(|e| format!("Failed to read version json: {}", e))?;
        #[derive(serde::Deserialize)]
        struct Dls { client: Option<Info> }
        #[derive(serde::Deserialize)]
        struct Info { url: String }
        #[derive(serde::Deserialize)]
        struct Vj { downloads: Option<Dls> }
        let vj: Vj = serde_json::from_str(&vjson_text)
            .map_err(|e| format!("Failed to parse version json: {}", e))?;
        if let Some(url) = vj.downloads.and_then(|d| d.client).map(|c| c.url) {
            download_file_with_retry(&url, &jar_path).await?;
        } else {
            return Err("Client download URL not found in version json".to_string());
        }
    }
    Ok(())
}

/// Concurrent connections for batches of small downloads. Capped because macOS gives GUI
/// apps only 256 file descriptors by default, and a hundred sockets plus open files blows past it.
fn download_parallelism(items: usize) -> usize {
    (num_cpus::get() * 4).clamp(16, 32).min(items.max(1))
}

fn bulk_download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("ValthorneClient/1.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .pool_max_idle_per_host(32)
        .pool_idle_timeout(std::time::Duration::from_secs(60))
        .tcp_nodelay(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Downloads `(url, destination)` pairs in parallel. Individual failures are logged, not fatal.
async fn download_all(downloads: Vec<(String, PathBuf)>, label: &str) -> Result<(), String> {
    use futures_util::stream::{self, StreamExt};

    if downloads.is_empty() {
        return Ok(());
    }
    let parallel = download_parallelism(downloads.len());
    let client = bulk_download_client()?;

    let results: Vec<Result<(), String>> = stream::iter(downloads)
        .map(|(url, path)| {
            let client = client.clone();
            async move { download_file_with_retry_and_client(&client, &url, &path).await }
        })
        .buffer_unordered(parallel)
        .collect()
        .await;

    for error in results.into_iter().filter_map(Result::err) {
        log::warn!("Error downloading {}: {}", label, error);
    }
    Ok(())
}

/// Libraries of a version JSON that apply to this platform and are not on disk yet.
async fn missing_libraries(instance_dir: &Path, json_path: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    #[derive(serde::Deserialize)]
    struct VersionJson { libraries: Vec<crate::versions::Library> }

    let version_data = tokio::fs::read_to_string(json_path).await.map_err(|e| e.to_string())?;
    let vj: VersionJson = serde_json::from_str(&version_data).map_err(|e| e.to_string())?;
    let os_name = crate::utils::minecraft_os_name();
    let os_arch = crate::utils::minecraft_os_arch();

    let mut missing = Vec::new();
    for lib in &vj.libraries {
        if !crate::versions::is_library_allowed(lib, os_name, os_arch) { continue; }
        let Some(artifact) = lib.downloads.as_ref().and_then(|d| d.artifact.as_ref()) else { continue };
        let lib_path = instance_dir.join("libraries").join(&artifact.path);
        if !lib_path.exists() {
            missing.push((artifact.url.clone(), lib_path));
        }
    }
    Ok(missing)
}

pub async fn ensure_version_libraries(instance_dir: &Path, mc_version: &str) -> Result<(), String> {
    let json_path = instance_dir.join("versions").join(mc_version).join(format!("{}.json", mc_version));
    if !json_path.exists() { return Err(format!("Version json not found: {}", json_path.display())); }
    download_all(missing_libraries(instance_dir, &json_path).await?, "library").await
}

/// Downloads the libraries from the mod loader JSON (Fabric)
/// This is CRITICAL because mod loaders like Fabric adds their own library versions
/// Example: Fabric uses asm-9.9 instead of vanilla MC's asm-9.6
pub async fn ensure_mod_loader_libraries(instance_dir: &Path, version_id: &str) -> Result<(), String> {
    let json_path = instance_dir.join("versions").join(version_id).join(format!("{}.json", version_id));
    if !json_path.exists() {
        // No mod loader JSON, do nothing (vanilla)
        return Ok(());
    }
    download_all(missing_libraries(instance_dir, &json_path).await?, "mod loader library").await
}

pub async fn install_mod_loader(minecraft_version: &str, mod_loader: &ModLoader, instance_dir: &Path) -> Result<Option<String>, String> {
    match mod_loader.r#type.as_str() {
        "fabric" => install_fabric(minecraft_version, &mod_loader.version, instance_dir).await,
        "vanilla" => Ok(None),
        _ => Err(format!("Unsupported mod loader type: {}", mod_loader.r#type))
    }
}

async fn install_fabric(minecraft_version: &str, fabric_version: &str, instance_dir: &Path) -> Result<Option<String>, String> {
    let loader_jar = instance_dir
        .join("libraries")
        .join("net")
        .join("fabricmc")
        .join("fabric-loader")
        .join(fabric_version)
        .join(format!("fabric-loader-{}.jar", fabric_version));
    if loader_jar.exists() {
        // If already installed, find the existing version_id
        return Ok(find_version_id_in_versions_dir(instance_dir, "fabric"));
    }

    let libraries_dir = instance_dir.join("libraries");
    tokio::fs::create_dir_all(&libraries_dir).await
        .map_err(|e| format!("Failed to create libraries directory: {}", e))?;

    let installer_info = get_fabric_installer_info().await?;
    let installer_path = download_fabric_installer(&installer_info, &libraries_dir).await?;
    let profile_json = get_fabric_profile_json(minecraft_version, fabric_version).await?;
    download_fabric_libraries(&profile_json, &libraries_dir).await?;
    run_fabric_installer(&installer_path, instance_dir, minecraft_version, fabric_version).await?;
    ensure_minecraft_client_present(instance_dir, minecraft_version).await?;
    
    // Find the version_id created by the installer
    Ok(find_version_id_in_versions_dir(instance_dir, "fabric"))
}

pub fn find_version_id_in_versions_dir(instance_dir: &Path, _loader_type: &str) -> Option<String> {
    let json_path = crate::launcher::find_fabric_version_json(instance_dir)?;
    json_path.file_stem().map(|n| n.to_string_lossy().to_string())
}

// Stubs expected to be defined elsewhere in codebase (existing functions)
async fn get_fabric_installer_info() -> Result<crate::models::FabricInstallerMeta, String> {
    use crate::http_client::HTTP_CLIENT;
    let response = HTTP_CLIENT
        .get("https://meta.fabricmc.net/v2/versions/installer")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Fabric installer info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let installers: Vec<crate::models::FabricInstallerMeta> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse installer info: {}", e))?;

    let stable_installer = installers
        .into_iter()
        .find(|i| i.stable)
        .ok_or("No stable Fabric installer found")?;

    Ok(stable_installer)
}

async fn get_fabric_profile_json(minecraft_version: &str, fabric_version: &str) -> Result<crate::models::FabricProfileJson, String> {
    use crate::http_client::HTTP_CLIENT;
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        minecraft_version, fabric_version
    );

    let response = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Fabric profile: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let profile: crate::models::FabricProfileJson = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Fabric profile: {}", e))?;

    Ok(profile)
}
async fn download_fabric_installer(info: &crate::models::FabricInstallerMeta, libs: &Path) -> Result<PathBuf, String> {
    let installer_path = libs.join(format!("fabric-installer-{}.jar", info.version));
    download_file_with_retry(&info.url, &installer_path).await?;
    Ok(installer_path)
}

async fn download_fabric_libraries(profile: &crate::models::FabricProfileJson, libs: &Path) -> Result<(), String> {
    for library in profile.libraries.iter() {
        let library_path = resolve_maven_path(&library.name, libs)?;
        if let Some(parent) = library_path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| format!("Failed to create library directory: {}", e))?;
        }
        let library_url = build_library_url(library)?;
        download_file_with_retry(&library_url, &library_path).await?;
    }
    Ok(())
}

async fn run_fabric_installer(installer: &Path, instance_dir: &Path, mc: &str, fabric: &str) -> Result<(), String> {
    let java_path = crate::launcher::find_or_install_java_for_minecraft(mc).await?;
    let mut cmd = Command::new(&java_path);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .args(&[
            "-jar",
            &installer.to_string_lossy(),
            "client",
            "-noprofile",
            "-dir",
            &instance_dir.to_string_lossy(),
            "-mcversion",
            mc,
            "-loader",
            fabric
        ])
        .output()
        .map_err(|e| format!("Failed to run Fabric installer: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Fabric installer failed: {}", stderr));
    }
    Ok(())
}
fn resolve_maven_path(maven_id: &str, libraries_dir: &Path) -> Result<PathBuf, String> {
    let parts: Vec<&str> = maven_id.split(':').collect();
    if parts.len() < 3 { return Err(format!("Invalid Maven ID: {}", maven_id)); }
    let group_id = parts[0].replace('.', "/");
    let artifact_id = parts[1];
    let version = parts[2];
    let filename = format!("{}-{}.jar", artifact_id, version);
    Ok(libraries_dir.join(&group_id).join(artifact_id).join(version).join(filename))
}

fn build_library_url(library: &crate::models::FabricLibrary) -> Result<String, String> {
    let parts: Vec<&str> = library.name.split(':').collect();
    if parts.len() < 3 { return Err(format!("Invalid Maven ID: {}", library.name)); }
    let group_id_path = parts[0].replace('.', "/");
    let artifact_id = parts[1];
    let version = parts[2];
    let filename = format!("{}-{}.jar", artifact_id, version);
    let base = library.url.as_ref().map(|u| u.trim_end_matches('/').to_string()).unwrap_or_else(|| "https://repo1.maven.org/maven2".to_string());
    Ok(format!("{}/{}/{}/{}/{}", base, group_id_path, artifact_id, version, filename))
}

/// Valid asset hashes with duplicates removed, in index order.
///
/// The index maps several names to the same content, and downloading one hash twice at the
/// same time makes both writers fight over a single temp file. Hashes become path components,
/// so anything that is not plain hex is dropped instead of trusted.
fn unique_asset_hashes<'a>(hashes: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    hashes
        .filter(|hash| hash.len() >= 2 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        .filter(|hash| seen.insert(*hash))
        .map(str::to_string)
        .collect()
}

fn asset_object_path(objects_dir: &Path, hash: &str) -> PathBuf {
    objects_dir.join(&hash[..2]).join(hash)
}

/// Downloads the Mojang asset objects the version needs and returns the asset index id.
///
/// `progress_range` maps the download onto a slice of the overall progress bar, because the
/// install flow spends the rest of the bar on other stages.
pub async fn ensure_assets_present(
    app_handle: &tauri::AppHandle,
    instance_dir: &Path,
    mc_version: &str,
    progress_range: (f64, f64),
) -> Result<String, String> {
    use futures_util::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicU64, Ordering};

    let json_path = instance_dir.join("versions").join(mc_version).join(format!("{}.json", mc_version));
    if !json_path.exists() { return Err(format!("Version json not found: {}", json_path.display())); }

    #[derive(serde::Deserialize)]
    struct AssetIndexRef { id: String, url: String }
    #[derive(serde::Deserialize)]
    struct VJson { #[serde(rename="assetIndex")] asset_index: Option<AssetIndexRef> }
    let vtext = tokio::fs::read_to_string(&json_path).await.map_err(|e| e.to_string())?;
    let vj: VJson = serde_json::from_str(&vtext).map_err(|e| e.to_string())?;
    let Some(ai) = vj.asset_index else { return Err("assetIndex missing in version json".to_string()); };

    let assets_dir = instance_dir.join("assets");
    let indexes_dir = assets_dir.join("indexes");
    tokio::fs::create_dir_all(&indexes_dir).await.map_err(|e| e.to_string())?;
    let index_path = indexes_dir.join(format!("{}.json", ai.id));
    if !index_path.exists() { download_file_with_retry(&ai.url, &index_path).await?; }

    #[derive(serde::Deserialize)]
    struct AssetObject { hash: String }
    #[derive(serde::Deserialize)]
    struct AssetIndex { objects: std::collections::HashMap<String, AssetObject> }
    let index_text = tokio::fs::read_to_string(&index_path).await.map_err(|e| e.to_string())?;
    let aidx: AssetIndex = serde_json::from_str(&index_text).map_err(|e| e.to_string())?;

    // Checking thousands of files one async call at a time is slow; do it in one blocking pass.
    let objects_dir = assets_dir.join("objects");
    let pending: Vec<String> = {
        let objects_dir = objects_dir.clone();
        tokio::task::spawn_blocking(move || {
            unique_asset_hashes(aidx.objects.values().map(|o| o.hash.as_str()))
                .into_iter()
                .filter(|hash| !asset_object_path(&objects_dir, hash).exists())
                .collect()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    if pending.is_empty() { return Ok(ai.id); }

    let total = pending.len() as u64;
    let done = std::sync::Arc::new(AtomicU64::new(0));
    let last_percent = std::sync::Arc::new(AtomicU64::new(u64::MAX));
    let client = bulk_download_client()?;

    let results: Vec<Result<(), String>> = stream::iter(pending.into_iter().map(|hash| {
        let (client, objects_dir, app_handle) = (client.clone(), objects_dir.clone(), app_handle.clone());
        let (done, last_percent) = (done.clone(), last_percent.clone());
        async move {
            let url = format!("https://resources.download.minecraft.net/{}/{}", &hash[..2], hash);
            download_file_with_retry_and_client(&client, &url, &asset_object_path(&objects_dir, &hash)).await?;

            let current = done.fetch_add(1, Ordering::Relaxed) + 1;
            let fraction = current as f64 / total as f64;
            let percentage = progress_range.0 + (progress_range.1 - progress_range.0) * fraction;
            // One event per whole percent instead of one per file.
            if last_percent.swap(percentage as u64, Ordering::Relaxed) != percentage as u64 {
                let _ = app_handle.emit("asset-download-progress", serde_json::json!({
                    "current": current,
                    "total": total,
                    "percentage": percentage,
                    "current_file": "",
                    "status": "Mojang"
                }));
            }
            Ok(())
        }
    })).buffer_unordered(download_parallelism(total as usize)).collect().await;

    for error in results.into_iter().filter_map(Result::err) {
        log::warn!("Mojang asset download error: {}", error);
    }
    let _ = app_handle.emit("asset-download-completed", serde_json::json!({ "phase": "mojang" }));
    Ok(ai.id)
}

#[cfg(test)]
mod tests {
    use super::{asset_object_path, download_parallelism, normalize_install_path, unique_asset_hashes};

    #[test]
    fn keeps_manifest_declared_placement() {
        assert_eq!(normalize_install_path("options.txt"), "options.txt");
        assert_eq!(normalize_install_path("config/xaero/settings.txt"), "config/xaero/settings.txt");
    }

    #[test]
    fn strips_legacy_prefixes() {
        assert_eq!(normalize_install_path("/files/config/a.json"), "config/a.json");
        assert_eq!(normalize_install_path("config/config/a.json"), "config/a.json");
    }

    #[test]
    fn rejects_traversal() {
        assert_eq!(normalize_install_path("../../evil.txt"), "evil.txt");
        assert_eq!(normalize_install_path("config/../../evil.txt"), "config/evil.txt");
    }

    #[test]
    fn duplicate_asset_hashes_are_downloaded_once() {
        let hashes = ["aabb", "ccdd", "aabb", "ccdd", "eeff"];
        assert_eq!(unique_asset_hashes(hashes.into_iter()), vec!["aabb", "ccdd", "eeff"]);
    }

    #[test]
    fn hashes_that_could_escape_the_objects_dir_are_dropped() {
        let hashes = ["../../etc/passwd", "a", "", "zz12", "ab/cd", "abcd"];
        assert_eq!(unique_asset_hashes(hashes.into_iter()), vec!["abcd"]);
    }

    #[test]
    fn asset_objects_live_under_their_two_letter_prefix() {
        let path = asset_object_path(std::path::Path::new("objects"), "abcdef");
        assert_eq!(path, std::path::Path::new("objects").join("ab").join("abcdef"));
    }

    #[test]
    fn parallelism_stays_within_the_descriptor_budget() {
        assert!(download_parallelism(10_000) <= 32);
        assert!(download_parallelism(10_000) >= 16);
        assert_eq!(download_parallelism(3), 3);
        assert_eq!(download_parallelism(0), 1);
    }
}
