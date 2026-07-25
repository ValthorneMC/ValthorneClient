use anyhow::Result;
use sha2::{Digest, Sha256};
use md5;
use std::path::Path;
use tokio::fs;
use glob::Pattern;

pub async fn calculate_file_hash(path: &Path) -> Result<String> {
    let contents = fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&contents);
    let hash = hasher.finalize();
    Ok(format!("{:x}", hash))
}

pub async fn calculate_file_md5(path: &Path) -> Result<String> {
    let contents = fs::read(path).await?;
    let digest = md5::compute(contents);
    Ok(format!("{:x}", digest))
}

pub async fn get_file_size(path: &Path) -> Result<u64> {
    let metadata = fs::metadata(path).await?;
    Ok(metadata.len())
}

pub fn get_relative_path(full_path: &Path, base_path: &Path) -> Result<String> {
    let relative = full_path.strip_prefix(base_path)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

/// Verifica si un archivo coincide con alguno de los patrones glob proporcionados
pub fn matches_glob_patterns(file_path: &str, patterns: &[String]) -> bool {
    for pattern_str in patterns {
        // Los patrones pueden ser como "*.txt", "config/*.cfg", "**/*.log", etc.
        if let Ok(pattern) = Pattern::new(pattern_str) {
            if pattern.matches(file_path) {
                return true;
            }
        }
    }
    false
}
