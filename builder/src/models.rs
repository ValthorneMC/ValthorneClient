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
    pub r#type: String, // "fabric", "forge", "neoforge", "vanilla"
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
pub struct DistributionManifest {
    pub distribution: DistributionInfo,
    pub instances: Vec<InstanceSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub base_url: String,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub minecraft_version: String,
    pub icon: Option<String>,
    pub background: Option<String>,
    pub background_video: Option<String>,
    pub last_updated: Option<String>,
    pub instance_url: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
