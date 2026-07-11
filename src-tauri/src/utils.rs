use crate::whitelist::get_supabase_config;
use glob::Pattern;

#[tauri::command]
pub async fn open_url(url: String) -> Result<String, String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok("URL opened successfully".to_string())
}

#[tauri::command]
pub async fn debug_env_vars() -> Result<String, String> {
    let (url, key) = get_supabase_config();
    let runtime_url = std::env::var("SUPABASE_URL").unwrap_or_else(|_| "NOT SET".to_string());
    let runtime_key = std::env::var("SUPABASE_ANON_KEY").unwrap_or_else(|_| "NOT SET".to_string());
    
    let result = format!(
        "Environment Variables Debug:\n\
        Runtime SUPABASE_URL: {}\n\
        Runtime SUPABASE_ANON_KEY: {}\n\
        Compile-time SUPABASE_URL: {}\n\
        Compile-time SUPABASE_ANON_KEY: {}\n\
        Final URL: {}\n\
        Final Key: {}\n\
        URL contains supabase.co: {}\n\
        Key length: {}\n\
        Is production build: {}\n\
        Current working directory: {:?}",
        runtime_url,
        if runtime_key.len() > 20 { "SET (length > 20)" } else { "NOT SET or too short" },
        env!("SUPABASE_URL"),
        if env!("SUPABASE_ANON_KEY").len() > 20 { "SET (length > 20)" } else { "NOT SET or too short" },
        url,
        if key.len() > 20 { "SET (length > 20)" } else { "NOT SET or too short" },
        url.contains("supabase.co"),
        key.len(),
        !cfg!(debug_assertions),
        std::env::current_dir().unwrap_or_default()
    );
    
    Ok(result)
}

/// Verifica si un archivo coincide con alguno de los patrones glob proporcionados
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

