use futures_util::TryStreamExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

// Fallback for when Mojang metadata does not specify Java.
// Minimum Minecraft release for each Java version, newest first.
const JAVA_BY_MINECRAFT_RELEASE: [((u32, u32, u32), u8); 5] = [
    ((26, 1, 0), 25),
    ((1, 20, 5), 21),
    ((1, 18, 0), 17),
    ((1, 17, 0), 16),
    ((1, 0, 0), 8),
];

pub(crate) fn fallback_java_version(minecraft_version: &str) -> u8 {
    let release = minecraft_version.split('-').next().unwrap_or_default();
    let Some((major, rest)) = release.split_once('.') else {
        return 8;
    };
    let (minor, patch) = rest.split_once('.').unwrap_or((rest, "0"));
    let Ok(major) = major.parse() else {
        return 8;
    };
    let Ok(minor) = minor.parse() else {
        return 8;
    };
    let version = (major, minor, patch.parse().unwrap_or(0));

    JAVA_BY_MINECRAFT_RELEASE
        .iter()
        .find(|(minimum, _)| version >= *minimum)
        .map_or(8, |(_, java)| *java)
}

pub(crate) async fn required_java_version(instance_dir: &Path, minecraft_version: &str) -> u8 {
    let metadata =
        crate::instances::load_minecraft_version_json(instance_dir, minecraft_version).await;
    match metadata {
        Ok(json) => java_version_from_metadata(&json)
            .unwrap_or_else(|| fallback_java_version(minecraft_version)),
        Err(error) => {
            log::warn!("Using fallback Java version for Minecraft {minecraft_version}: {error}");
            fallback_java_version(minecraft_version)
        }
    }
}

fn java_version_from_metadata(json: &str) -> Option<u8> {
    let metadata: serde_json::Value = serde_json::from_str(json).ok()?;
    let major = u8::try_from(metadata.get("javaVersion")?.get("majorVersion")?.as_u64()?).ok()?;
    (major >= 8).then_some(major)
}

static INSTALL_LOCK: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));
type Progress = Arc<dyn Fn(u32, &'static str) + Send + Sync>;

struct ProgressGate {
    last: u32,
    at: Instant,
}
impl ProgressGate {
    fn new(initial: u32) -> Self {
        Self {
            last: initial,
            at: Instant::now(),
        }
    }
    fn update(&mut self, value: u32) -> bool {
        if value <= self.last || self.at.elapsed() < Duration::from_millis(200) {
            return false;
        }
        self.last = value;
        self.at = Instant::now();
        true
    }
}

pub async fn install(version: &str, progress: Progress) -> Result<(), String> {
    let version = version
        .parse::<u8>()
        .ok()
        .filter(|v| *v >= 8)
        .ok_or("Invalid Java version")?
        .to_string();
    let guard = INSTALL_LOCK.clone().lock_owned().await;
    if crate::utils::java_executable_for_version(&version).is_file() {
        progress(100, "Completed");
        return Ok(());
    }
    let runtime = crate::utils::runtime_dir();
    tokio::fs::create_dir_all(&runtime)
        .await
        .map_err(|e| e.to_string())?;
    let archive = runtime.join(format!(
        "java-{}.{}",
        version,
        crate::utils::adoptium_archive_extension()
    ));
    let staging = crate::utils::java_staging_dir(&runtime, &version);
    let target = crate::utils::java_runtime_dir(&version);
    progress(0, "Downloading Java");
    let url = java_download_url(&version).await?;
    if let Err(error) = download_archive(&url, &archive, &progress).await {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(error);
    }

    progress(85, "Extracting Java");
    finish_install(archive, staging, target, progress.clone(), guard).await?;
    progress(100, "Completed");
    Ok(())
}

async fn java_download_url(version: &str) -> Result<String, String> {
    let (os, arch) = crate::utils::adoptium_os_and_arch();

    // Adoptium does not publish these two JDKs for Apple Silicon.
    if (os, arch) == ("mac", "aarch64") && matches!(version, "8" | "16") {
        #[derive(serde::Deserialize)]
        struct ZuluPackage {
            download_url: String,
        }

        let url = format!(
            "https://api.azul.com/metadata/v1/zulu/packages/?java_version={version}&os=macos&arch=aarch64&archive_type=tar.gz&java_package_type=jdk&release_status=ga&availability_types=CA&javafx_bundled=false&latest=true"
        );
        let packages = async {
            crate::http_client::HTTP_CLIENT_LONG
                .get(url)
                .send()
                .await?
                .error_for_status()?
                .json::<Vec<ZuluPackage>>()
                .await
        }
        .await
        .map_err(|error| format!("Failed to find Azul Zulu Java {version}: {error}"))?;

        return packages
            .into_iter()
            .next()
            .map(|package| package.download_url)
            .ok_or_else(|| format!("Azul Zulu Java {version} is unavailable for Apple Silicon"));
    }

    Ok(format!(
        "https://api.adoptium.net/v3/binary/latest/{version}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse"
    ))
}

async fn download_archive(url: &str, archive: &Path, progress: &Progress) -> Result<(), String> {
    let response = crate::http_client::HTTP_CLIENT_LONG
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Failed to download Java: {error}"))?;

    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(archive)
        .await
        .map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0u64;
    let mut gate = ProgressGate::new(10);
    progress(10, "Downloading Java");

    while let Some(chunk) = stream
        .try_next()
        .await
        .map_err(|error| format!("Failed to read Java download: {error}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Failed to write Java download: {error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if total > 0 {
            let percent = 10 + ((downloaded as u128 * 70 / total as u128).min(70) as u32);
            if gate.update(percent) {
                progress(percent, "Downloading Java");
            }
        }
    }

    file.flush().await.map_err(|error| error.to_string())
}

async fn finish_install(
    archive: PathBuf,
    staging: PathBuf,
    target: PathBuf,
    progress: Progress,
    guard: tokio::sync::OwnedMutexGuard<()>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Cancellation of the caller must not release the installation lock before its worker finishes.
        let _guard = guard;
        unpack_and_finalize(archive, staging, target, progress)
    })
    .await
    .map_err(|e| format!("Java installation worker failed: {}", e))?
}

fn unpack_and_finalize(
    archive: PathBuf,
    staging: PathBuf,
    target: PathBuf,
    progress: Progress,
) -> Result<(), String> {
    let backup = target.with_file_name(format!(".java-backup-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        if staging.exists() {
            std::fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
        }
        let mut gate = ProgressGate::new(85);
        crate::utils::extract_java_archive(&archive, &staging, |done, total| {
            let percent = if total > 0 {
                85 + (done * 10 / total).min(9) as u32
            } else {
                85 + (done / 200).min(9) as u32
            };
            if gate.update(percent) {
                progress(percent, "Extracting Java");
            }
        })?;
        let valid = std::fs::read_dir(&staging)
            .map_err(|e| e.to_string())?
            .flatten()
            .any(|e| crate::utils::java_executable(&e.path()).is_file());
        if !valid {
            return Err("Java executable not found after extraction".to_string());
        }
        progress(95, "Finalizing installation");
        let had_previous = target.exists();
        if had_previous {
            std::fs::rename(&target, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(error) = crate::utils::finalize_extracted_java(&staging, &target) {
            if had_previous {
                let _ = std::fs::remove_dir_all(&target);
                std::fs::rename(&backup, &target).map_err(|restore| {
                    format!(
                        "{}; previous Java remains at {}: {}",
                        error,
                        backup.display(),
                        restore
                    )
                })?;
            }
            return Err(error);
        }
        if had_previous {
            let _ = std::fs::remove_dir_all(&backup);
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_file(&archive);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("valthorne-java-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn archive(root: &std::path::Path, zip: bool) -> PathBuf {
        let path = root.join(if zip { "java.zip" } else { "java.tar.gz" });
        let exe = if cfg!(windows) {
            "jdk/bin/java.exe"
        } else {
            "jdk/bin/java"
        };
        if zip {
            let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            writer
                .start_file(exe, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"java").unwrap();
            writer.finish().unwrap();
        } else {
            let encoder = flate2::write::GzEncoder::new(
                std::fs::File::create(&path).unwrap(),
                flate2::Compression::fast(),
            );
            let mut writer = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_size(4);
            header.set_mode(0o755);
            header.set_cksum();
            writer.append_data(&mut header, exe, &b"java"[..]).unwrap();
            writer.into_inner().unwrap().finish().unwrap();
        }
        path
    }
    #[tokio::test]
    async fn cached_mojang_metadata_takes_priority_over_release_table() {
        let root = scratch();
        let version = "24w14a";
        let version_dir = root.join("versions").join(version);
        std::fs::create_dir_all(&version_dir).unwrap();
        let json = version_dir.join("24w14a.json");

        std::fs::write(
            &json,
            r#"{"id":"24w14a","javaVersion":{"majorVersion":21}}"#,
        )
        .unwrap();
        assert_eq!(required_java_version(&root, version).await, 21);

        std::fs::write(&json, r#"{"id":"24w14a"}"#).unwrap();
        assert_eq!(required_java_version(&root, version).await, 8);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installs_zip_and_tar_and_keeps_other_versions() {
        for zip in [true, false] {
            let root = scratch();
            let target = root.join("java-21");
            let staging = root.join("staging");
            std::fs::create_dir_all(root.join("java-17")).unwrap();
            unpack_and_finalize(
                archive(&root, zip),
                staging.clone(),
                target.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
            assert!(crate::utils::java_executable(&target).is_file());
            assert!(!staging.exists());
            assert!(root.join("java-17").exists());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_ne!(
                    std::fs::metadata(crate::utils::java_executable(&target))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o111,
                    0
                );
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn corrupt_archive_cleans_staging_and_preserves_installed_runtime() {
        let root = scratch();
        let target = root.join("java-21");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("old"), "keep").unwrap();
        let archive = root.join("bad.zip");
        std::fs::write(&archive, "bad").unwrap();
        let staging = root.join("staging");
        assert!(
            unpack_and_finalize(
                archive.clone(),
                staging.clone(),
                target.clone(),
                Arc::new(|_, _| {})
            )
            .is_err()
        );
        assert!(target.join("old").exists());
        assert!(!staging.exists());
        assert!(!archive.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn progress_is_monotonic_and_throttled() {
        let mut gate = ProgressGate::new(10);
        for n in 11..80 {
            assert!(!gate.update(n));
        }
        gate.at -= Duration::from_millis(201);
        assert!(gate.update(70));
        assert!(!gate.update(70));
        gate.at -= Duration::from_millis(201);
        assert!(!gate.update(60));
        assert!(gate.update(80));
    }
    #[tokio::test(flavor = "current_thread")]
    async fn blocking_extraction_leaves_executor_available() {
        let root = scratch();
        let archive = archive(&root, true);
        let worker_root = root.clone();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let channels = std::sync::Mutex::new(Some((started_tx, release_rx)));
        let progress: Progress = Arc::new(move |percent, _| {
            if percent == 95 {
                if let Some((started, release)) = channels.lock().unwrap().take() {
                    started.send(()).unwrap();
                    release.recv_timeout(Duration::from_secs(2)).unwrap();
                }
            }
        });
        let guard = Arc::new(tokio::sync::Mutex::new(())).lock_owned().await;
        let worker = tokio::spawn(finish_install(
            archive,
            worker_root.join("stage"),
            worker_root.join("java"),
            progress,
            guard,
        ));

        started_rx.await.unwrap();
        tokio::task::yield_now().await;
        release_tx.send(()).unwrap();
        worker.await.unwrap().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
