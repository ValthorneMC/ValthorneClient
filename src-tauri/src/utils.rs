use glob::Pattern;

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

