use glob::Pattern;
use std::path::PathBuf;

/// Root directory where the launcher stores everything (instances, runtime, logs, skins).
///
/// Resolved from the user's home directory. On Windows that's `USERPROFILE`, on
/// macOS/Linux `HOME`; `dirs::home_dir` handles both plus the fallbacks. Never
/// falls back to the current working directory: on macOS the app runs from a
/// read-only bundle (or straight from the DMG), which made every write fail with
/// "Read-only file system (os error 30)".
pub fn valthorne_dir() -> PathBuf {
    let home = dirs::home_dir()
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);

    home.join(".valthorneclient")
}

/// Directory holding the downloaded Java runtimes
pub fn runtime_dir() -> PathBuf {
    valthorne_dir().join("runtime")
}

/// Directory of a specific installed Java runtime
pub fn java_runtime_dir(version: &str) -> PathBuf {
    runtime_dir().join(format!("java-{}", version))
}

/// Path to the `java` binary inside an installed runtime.
///
/// macOS JDKs ship as a bundle (`Contents/Home/bin/java`), so the plain
/// `bin/java` layout used on Windows/Linux isn't enough.
pub fn java_executable(java_dir: &PathBuf) -> PathBuf {
    let exe = if cfg!(target_os = "windows") { "java.exe" } else { "java" };

    let bundled = java_dir.join("Contents").join("Home").join("bin").join(exe);
    if bundled.exists() {
        return bundled;
    }

    java_dir.join("bin").join(exe)
}

/// Path to the `java` binary of an installed runtime version
pub fn java_executable_for_version(version: &str) -> PathBuf {
    java_executable(&java_runtime_dir(version))
}

/// OS name as used by the Minecraft version manifest rules
pub fn minecraft_os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// CPU architecture as used by the Minecraft version manifest rules
pub fn minecraft_os_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x86_64"
    }
}

/// (os, architecture) pair for the Adoptium API used to download Java
pub fn adoptium_os_and_arch() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };

    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };

    (os, arch)
}

/// Archive extension Adoptium serves for the current platform
pub fn adoptium_archive_extension() -> &'static str {
    if cfg!(target_os = "windows") { "zip" } else { "tar.gz" }
}

/// Extracts a downloaded Java archive into `dest_dir`.
///
/// Supports the `.zip` Adoptium serves on Windows and the `.tar.gz` it serves on
/// macOS/Linux. `on_progress` receives (entry index, total entries) — on tar.gz the
/// total is unknown up front, so it's reported as 0.
pub fn extract_java_archive(
    archive: &std::path::Path,
    dest_dir: &std::path::Path,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<(), String> {
    let is_zip = archive
        .extension()
        .map_or(false, |e| e.eq_ignore_ascii_case("zip"));

    if is_zip {
        let reader = std::fs::File::open(archive).map_err(|e| format!("Open zip failed: {}", e))?;
        let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Read zip failed: {}", e))?;
        let total = zip.len();

        for i in 0..total {
            let mut file = zip.by_index(i).map_err(|e| format!("Zip index failed: {}", e))?;
            let outpath = dest_dir.join(file.mangled_name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).map_err(|e| format!("Create dir failed: {}", e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p).map_err(|e| format!("Create parent failed: {}", e))?;
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Create file failed: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Write file failed: {}", e))?;
            }

            on_progress(i + 1, total);
        }

        return Ok(());
    }

    // tar.gz (macOS/Linux). `unpack` preserves the executable bit, which the JDK
    // binaries need to be runnable at all.
    let file = std::fs::File::open(archive).map_err(|e| format!("Open tar.gz failed: {}", e))?;
    let decoder = flate2::read::GzDecoder::new(std::io::BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    tar.set_preserve_permissions(true);
    tar.set_overwrite(true);

    let mut extracted = 0usize;
    for entry in tar.entries().map_err(|e| format!("Read tar failed: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Read tar entry failed: {}", e))?;
        entry
            .unpack_in(dest_dir)
            .map_err(|e| format!("Extract tar entry failed: {}", e))?;

        extracted += 1;
        on_progress(extracted, 0);
    }

    Ok(())
}

/// Makes every binary under a Java runtime executable.
///
/// A safety net for archives whose permission bits didn't survive extraction —
/// without it macOS/Linux reject the launch with "Permission denied".
pub fn ensure_java_binaries_executable(java_dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        for bin_dir in [
            java_dir.join("bin"),
            java_dir.join("Contents").join("Home").join("bin"),
            java_dir.join("jre").join("bin"),
        ] {
            let Ok(entries) = std::fs::read_dir(&bin_dir) else { continue };

            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if let Ok(metadata) = std::fs::metadata(&path) {
                    let mut perms = metadata.permissions();
                    perms.set_mode(perms.mode() | 0o755);
                    let _ = std::fs::set_permissions(&path, perms);
                }
            }
        }
    }

    #[cfg(not(unix))]
    let _ = java_dir;
}

/// Finds the JDK directory produced by extracting an archive into `runtime_dir`
/// and moves it to `java_dir`.
///
/// Archives unpack to a versioned folder name (`jdk-21.0.5+11`), so the exact name
/// isn't known before extraction.
pub fn finalize_extracted_java(
    runtime_dir: &std::path::Path,
    java_dir: &std::path::Path,
) -> Result<(), String> {
    let entries = std::fs::read_dir(runtime_dir)
        .map_err(|e| format!("Failed to read runtime directory: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read directory entries: {}", e))?;

    let extracted_dirs: Vec<_> = entries
        .into_iter()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path != java_dir)
        .collect();

    let Some(extracted_dir) = extracted_dirs.first() else {
        return Err("No Java directory found after extraction".to_string());
    };

    if java_dir.exists() {
        let _ = std::fs::remove_dir_all(java_dir);
    }
    std::fs::rename(extracted_dir, java_dir)
        .map_err(|e| format!("Failed to move Java directory: {}", e))?;

    for dir in extracted_dirs.iter().skip(1) {
        let _ = std::fs::remove_dir_all(dir);
    }

    ensure_java_binaries_executable(java_dir);

    Ok(())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<String, String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok("URL opened successfully".to_string())
}

/// Checks whether a file matches any of the given glob patterns
pub fn matches_glob_patterns(file_path: &str, patterns: &[String]) -> bool {
    for pattern_str in patterns {
        if let Ok(pattern) = Pattern::new(pattern_str) {
            if pattern.matches(file_path) {
                return true;
            }
        }
    }
    false
}

