use serde::{Serialize, Deserialize};
use std::collections::HashMap;

// Minecraft version structures from Mojang API
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MinecraftVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionManifest {
    pub versions: Vec<MinecraftVersion>,
}

// Library and rule structures for Minecraft version parsing
#[derive(Deserialize, Debug, Clone)]
pub struct Extract {
    #[allow(dead_code)]
    pub exclude: Vec<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct OsRule {
    pub name: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Library {
    #[allow(dead_code)]
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    #[allow(dead_code)]
    pub natives: Option<HashMap<String, String>>,
    pub rules: Option<Vec<Rule>>,
    #[serde(default)]
    #[allow(dead_code)]
    pub extract: Option<Extract>,
}

impl Library {
    #[allow(dead_code)]
    pub fn get_extract(&self) -> Option<&Extract> {
        self.extract.as_ref()
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<LibraryArtifact>,
    #[allow(dead_code)]
    pub classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct LibraryArtifact {
    pub url: String,
    pub path: String,
}

// Check if a library is allowed for the current operating system based on rules
pub fn is_library_allowed(lib: &Library, os_name: &str) -> bool {
    let rules = match &lib.rules {
        Some(r) => r,
        None => return true,
    };
    let mut allowed = false;
    for rule in rules {
        let matches = if let Some(os) = &rule.os {
            if let Some(name) = &os.name {
                name == os_name
            } else {
                true
            }
        } else {
            true
        };
        if matches {
            allowed = rule.action == "allow";
        }
    }
    allowed
}


