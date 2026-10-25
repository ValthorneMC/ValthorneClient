use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub instance: InstanceInfo,
    pub files: InstanceFiles,
    pub launch_settings: LaunchSettings,
    #[serde(default)]
    pub ignored_files: Option<IgnoredFilesConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub minecraft_version: String,
    pub mod_loader: Option<ModLoader>,
    pub icon: Option<String>,
    pub background: Option<String>,
    pub background_video: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoader {
    pub r#type: String, // "fabric" or "vanilla"
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceFiles {
    pub mods: Vec<FileEntry>,
    pub configs: Vec<FileEntry>,
    pub resourcepacks: Option<Vec<FileEntry>>,
    pub shaderpacks: Option<Vec<FileEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub url: String,
    pub sha256: String,
    pub md5: Option<String>,
    pub size: Option<u64>,
    pub required: Option<bool>,
    pub target: Option<String>, // For configs, where to place the file
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchSettings {
    pub min_ram: u32,
    pub recommended_ram: u32,
    pub jvm_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceSettings {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub minecraft_version: String,
    pub mod_loader: Option<ModLoader>,
    pub launch_settings: LaunchSettings,
    #[serde(default)]
    pub ignored_files: Option<IgnoredFilesConfig>,
    /// Reglas de colocacion: donde se instala cada archivo dentro de la instancia.
    /// Sin regla, la instancia replica la estructura del workspace.
    #[serde(default)]
    pub file_targets: Vec<FileTarget>,
}

/// Los archivos cuya ruta de manifest (`config/options.txt`, `mods/x.jar`, ...)
/// coincide con `pattern` se instalan en `dest`, relativo a la raiz de la
/// instancia. `dest = ""` es la propia raiz. Gana la primera regla que coincida.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTarget {
    pub pattern: String,
    pub dest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IgnoredFilesConfig {
    /// Patrones glob para archivos a ignorar en mods
    #[serde(default)]
    pub mods: Vec<String>,
    /// Patrones glob para archivos a ignorar en configs
    #[serde(default)]
    pub configs: Vec<String>,
    /// Patrones glob para archivos a ignorar en resourcepacks
    #[serde(default)]
    pub resourcepacks: Vec<String>,
    /// Patrones glob para archivos a ignorar en shaderpacks
    #[serde(default)]
    pub shaderpacks: Vec<String>,
}

impl Default for LaunchSettings {
    fn default() -> Self {
        Self {
            min_ram: 4096,
            recommended_ram: 8192,
            jvm_args: None,
        }
    }
}

/// Signed publication format (schema 2): files are content-addressed by SHA-256
/// and fetched through the distribution Worker.
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
    /// Path inside the workspace instance (`mods/x.jar`).
    pub path: String,
    /// Install path relative to the game dir; empty for UI assets.
    pub target: String,
    /// `mod`, `config`, `resourcepack`, `shaderpack` or `asset`.
    pub kind: String,
    /// `managed` is kept in sync; `once` is only written when missing.
    pub policy: String,
    pub sha256: String,
    pub size: u64,
}
