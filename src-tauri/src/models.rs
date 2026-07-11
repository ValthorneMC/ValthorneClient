use serde::{Deserialize, Serialize};

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
    pub mod_loader: Option<ModLoader>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceManifest {
    pub instance: InstanceInfo,
    pub files: InstanceFiles,
    pub launch_settings: LaunchSettings,
    #[serde(default)]
    pub ignored_files: Option<IgnoredFilesConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoredFilesConfig {
    #[serde(default)]
    pub mods: Vec<String>,
    #[serde(default)]
    pub configs: Vec<String>,
    #[serde(default)]
    pub resourcepacks: Vec<String>,
    #[serde(default)]
    pub shaderpacks: Vec<String>,
}

/// Historial de archivos que estuvieron en el manifest anterior
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestHistory {
    pub last_updated: String,
    pub files: ManifestHistoryFiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestHistoryFiles {
    #[serde(default)]
    pub mods: Vec<String>,
    #[serde(default)]
    pub configs: Vec<String>,
    #[serde(default)]
    pub resourcepacks: Vec<String>,
    #[serde(default)]
    pub shaderpacks: Vec<String>,
    /// Archivos en la raíz de la instancia que estaban en el manifest
    #[serde(default)]
    pub root_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceAsset {
    pub name: String,
    pub path: String,
    pub url: String,
    pub sha256: String,
    pub md5: Option<String>,
    pub size: Option<u64>,
    pub required: Option<bool>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateState {
    #[serde(default)]
    pub last_check: String,
    #[serde(default)]
    pub available_version: Option<String>,
    #[serde(default = "default_current_version")]
    pub current_version: String,
    #[serde(default)]
    pub downloaded: bool,
    #[serde(default)]
    pub download_ready: bool,
    #[serde(default)]
    pub manual_download: bool,
}

fn default_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

impl UpdateState {
    pub fn with_current_version(mut self) -> Self {
        self.current_version = env!("CARGO_PKG_VERSION").to_string();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhitelistEntry {
    pub minecraft_username: String,
    pub global_access: bool,
    pub allowed_instances: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessCheck {
    pub has_access: bool,
    pub allowed_instances: Vec<String>,
    pub global_access: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetDownloadProgress {
    pub current: u64,
    pub total: u64,
    pub percentage: f32,
    pub current_file: String,
    pub status: String,
}

// Fabric Meta API structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricInstallerMeta {
    pub version: String,
    pub stable: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderMeta {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricVersionMeta {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLibrary {
    pub name: String,
    pub url: Option<String>,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricProfileJson {
    pub id: String,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
    pub time: String,
    pub r#type: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub arguments: FabricArguments,
    pub libraries: Vec<FabricLibrary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricArguments {
    #[serde(default)]
    pub game: Vec<String>,
    #[serde(default)]
    pub jvm: Vec<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoader {
    pub r#type: String,
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
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchSettings {
    pub min_ram: u32,
    pub recommended_ram: u32,
    pub jvm_args: Option<Vec<String>>,
}

// Admin system structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminEntry {
    pub minecraft_username: String,
}

// Local instances structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalInstance {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    #[serde(default)]
    pub fabric_version: String, // Mantener para compatibilidad retroactiva
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mod_loader: Option<ModLoader>,
    pub created_at: String,
    pub is_local: bool,
    pub background: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalInstanceMetadata {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    #[serde(default)]
    pub fabric_version: String, // Mantener para compatibilidad retroactiva
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mod_loader: Option<ModLoader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>, // ID exacto del JSON generado por el instalador (ej. "neoforge-21.8.51")
    pub created_at: String,
}

// Minecraft version structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftVersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<MinecraftVersionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftVersionInfo {
    pub id: String,
    pub r#type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

// Fabric Loader version structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderVersion {
    pub loader: FabricLoaderInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderInfo {
    pub version: String,
    pub stable: bool,
}

// Forge version structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeVersion {
    pub version: String,
    pub minecraft_version: String,
    #[serde(default)]
    pub recommended: bool,
}

// NeoForge version structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeoForgeVersion {
    pub version: String,
    pub minecraft_version: String,
}

// Configuración unificada del launcher
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    #[serde(default)]
    pub update_state: UpdateState,
    #[serde(default)]
    pub ram_config: RamConfig,
    #[serde(default)]
    pub advanced_config: AdvancedConfig,
    #[serde(default)]
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RamConfig {
    #[serde(default = "default_min_ram")]
    pub min_ram: f64,
    #[serde(default = "default_max_ram")]
    pub max_ram: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedConfig {
    #[serde(default)]
    pub jvm_args: String,
    #[serde(default = "default_gc")]
    pub garbage_collector: String,
    #[serde(default = "default_width")]
    pub window_width: u32,
    #[serde(default = "default_height")]
    pub window_height: u32,
}

fn default_min_ram() -> f64 { 2.0 }
fn default_max_ram() -> f64 { 4.0 }
fn default_gc() -> String { "G1".to_string() }
fn default_width() -> u32 { 1280 }
fn default_height() -> u32 { 720 }

impl Default for LauncherConfig {
    fn default() -> Self {
        let real_version = env!("CARGO_PKG_VERSION").to_string();
        Self {
            update_state: UpdateState {
                last_check: String::new(),
                available_version: None,
                current_version: real_version,
                downloaded: false,
                download_ready: false,
                manual_download: false,
            },
            ram_config: RamConfig::default(),
            advanced_config: AdvancedConfig::default(),
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }
}

impl Default for RamConfig {
    fn default() -> Self {
        Self {
            min_ram: 2.0,
            max_ram: 4.0,
        }
    }
}

impl Default for AdvancedConfig {
    fn default() -> Self {
        Self {
            jvm_args: String::new(),
            garbage_collector: "G1".to_string(),
            window_width: 1280,
            window_height: 720,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordRpcConfig {
    #[serde(default)]
    pub enabled: bool,
}

impl Default for DiscordRpcConfig {
    fn default() -> Self {
        Self {
            enabled: true,
        }
    }
}


