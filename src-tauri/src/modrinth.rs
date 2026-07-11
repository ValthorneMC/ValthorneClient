use serde::{Deserialize, Serialize};
use reqwest;
use anyhow::Result;

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthProject {
    pub project_id: String,
    pub project_type: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub categories: Vec<String>,
    pub client_side: String,
    pub server_side: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchResult {
    pub hits: Vec<ModrinthProject>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    pub name: String,
    pub changelog: Option<String>,
    pub date_published: String,
    pub downloads: u64,
    pub version_type: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModrinthFile>,
    pub dependencies: Vec<ModrinthDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFile {
    pub hashes: ModrinthHashes,
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthHashes {
    pub sha512: Option<String>,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String, // "required", "optional", "incompatible", "embedded"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthDependencyResponse {
    pub projects: Vec<ModrinthProject>,
    pub versions: Vec<ModrinthVersion>,
}

/// Buscar proyectos en Modrinth
pub async fn search_projects(
    query: &str,
    minecraft_version: Option<&str>,
    loader: Option<&str>,
    limit: Option<u32>,
) -> Result<ModrinthSearchResult> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    // Construir facetas: cada array interno es OR, arrays externos son AND
    // Formato: [["versions:1.21.1"], ["categories:fabric"], ["project_type:mod"]]
    let mut facets_array: Vec<Vec<String>> = Vec::new();
    
    // Siempre filtrar por tipo de proyecto: mod
    facets_array.push(vec!["project_type:mod".to_string()]);
    
    // Agregar filtros de facetas (cada uno en su propio array para AND)
    if let Some(mc_version) = minecraft_version {
        facets_array.push(vec![format!("versions:{}", mc_version)]);
    }
    
    if let Some(loader_type) = loader {
        facets_array.push(vec![format!("categories:{}", loader_type)]);
    }
    
    let facets_json = serde_json::to_string(&facets_array)?;
    
    let mut url = format!("{}/search", MODRINTH_API_BASE);
    url.push_str(&format!("?query={}", urlencoding::encode(query)));
    url.push_str(&format!("&facets={}", urlencoding::encode(&facets_json)));
    url.push_str(&format!("&limit={}", limit.unwrap_or(20)));
    url.push_str("&index=downloads");


    let response = client
        .get(&url)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    let result: ModrinthSearchResult = response.json().await?;
    
    Ok(result)
}

/// Obtener una versión por ID
pub async fn get_version_by_id(version_id: &str) -> Result<ModrinthVersion> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    let url = format!("{}/version/{}", MODRINTH_API_BASE, version_id);


    let response = client
        .get(&url)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    let version: ModrinthVersion = response.json().await?;
    
    Ok(version)
}

/// Obtener versiones desde múltiples hashes (batch)
pub async fn get_versions_from_hashes(hashes: &[String], algorithm: &str) -> Result<Vec<ModrinthVersion>> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    let url = format!("{}/version_files", MODRINTH_API_BASE);
    
    let body = serde_json::json!({
        "hashes": hashes,
        "algorithm": algorithm
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    // La respuesta es un mapa de hash -> Version, necesitamos extraer solo los valores
    let hash_to_version: std::collections::HashMap<String, ModrinthVersion> = response.json().await?;
    let versions: Vec<ModrinthVersion> = hash_to_version.into_values().collect();
    Ok(versions)
}

/// Obtener información de una versión desde el hash SHA512 del archivo
pub async fn get_version_from_hash(sha512: &str) -> Result<Option<ModrinthVersion>> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    let url = format!("{}/version_file/{}?algorithm=sha512", MODRINTH_API_BASE, sha512);

    let response = client
        .get(&url)
        .send()
        .await?;

    if response.status() == 404 {
        // No se encontró el archivo en Modrinth
        return Ok(None);
    }

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    let version: ModrinthVersion = response.json().await?;
    
    Ok(Some(version))
}

/// Obtener todas las versiones de un proyecto
pub async fn get_project_versions(
    project_id: &str,
    minecraft_version: Option<&str>,
    loader: Option<&str>,
) -> Result<Vec<ModrinthVersion>> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    let mut url = format!("{}/project/{}/version", MODRINTH_API_BASE, project_id);
    
    let mut query_params = Vec::new();
    if let Some(mc_version) = minecraft_version {
        let game_versions_json = serde_json::to_string(&vec![mc_version])?;
        query_params.push(format!("game_versions={}", urlencoding::encode(&game_versions_json)));
    }
    if let Some(loader_type) = loader {
        let loaders_json = serde_json::to_string(&vec![loader_type])?;
        query_params.push(format!("loaders={}", urlencoding::encode(&loaders_json)));
    }
    
    if !query_params.is_empty() {
        url.push('?');
        url.push_str(&query_params.join("&"));
    }

    log::info!("📦 Fetching versions for project {}: {}", project_id, url);

    let response = client
        .get(&url)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    let versions: Vec<ModrinthVersion> = response.json().await?;
    
    Ok(versions)
}

/// Obtener dependencias de una versión
pub async fn get_version_dependencies(version_id: &str) -> Result<ModrinthDependencyResponse> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    let url = format!("{}/version/{}/dependencies", MODRINTH_API_BASE, version_id);

    log::info!("🔗 Fetching dependencies for version {}: {}", version_id, url);

    let response = client
        .get(&url)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        log::error!("Modrinth API error: {} - {}", status, text);
        return Err(anyhow::anyhow!("Modrinth API error: {} - {}", status, text));
    }

    let deps: ModrinthDependencyResponse = response.json().await?;
    log::info!("✅ Found {} dependencies", deps.projects.len());
    
    Ok(deps)
}

/// Descargar un archivo de Modrinth
pub async fn download_mod_file(
    file_url: &str,
    file_path: &std::path::Path,
) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("KindlyKlanKlient/1.0.0 (github.com/kindlyklan/klient)")
        .build()?;

    log::info!("⬇️  Downloading mod from: {}", file_url);
    
    let response = client
        .get(file_url)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to download file: {}", response.status()));
    }

    let bytes = response.bytes().await?;
    
    // Crear directorio si no existe
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    
    tokio::fs::write(file_path, &bytes).await?;
    
    
    Ok(())
}

