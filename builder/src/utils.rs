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

/// Resuelve donde se instala un archivo dentro de la instancia.
///
/// Aplica la primera regla de `rules` que coincida con la ruta de manifest; si
/// no coincide ninguna, la instancia replica la estructura del workspace.
pub fn resolve_target(manifest_path: &str, rules: &[crate::models::FileTarget]) -> String {
    for rule in rules {
        let matches = Pattern::new(&rule.pattern)
            .map(|pattern| pattern.matches(manifest_path))
            .unwrap_or(false);

        if matches {
            let dest = rule.dest.trim_matches('/');
            let file_name = manifest_path.rsplit('/').next().unwrap_or(manifest_path);
            return if dest.is_empty() {
                file_name.to_string()
            } else {
                format!("{}/{}", dest, file_name)
            };
        }
    }

    manifest_path.to_string()
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
