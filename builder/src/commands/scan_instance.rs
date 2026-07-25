use anyhow::Result;
use tokio::fs;
use std::path::Path;
use walkdir::WalkDir;
use crate::models::{InstanceConfig, InstanceFiles, FileEntry, InstanceSettings};
use crate::utils::{calculate_file_hash, calculate_file_md5, get_file_size, get_relative_path};

const INSTANCE_ID: &str = "valthorne";

pub async fn run() -> Result<()> {
    let instances_dir = Path::new("instances");
    let instance_dir = instances_dir.join(INSTANCE_ID);

    if !instance_dir.exists() {
        return Err(anyhow::anyhow!(
            "Instancia '{}' no encontrada en: {}. Ejecuta 'valthorne-builder init' primero.",
            INSTANCE_ID,
            instance_dir.display()
        ));
    }

    println!("Escaneando instancia: {}", INSTANCE_ID);

    // Cargar settings de la instancia
    let settings_path = instance_dir.join("settings.toml");
    if !settings_path.exists() {
        return Err(anyhow::anyhow!("settings.toml no encontrado en el directorio de la instancia"));
    }

    let settings_content = fs::read_to_string(&settings_path).await?;
    let settings: InstanceSettings = toml::from_str(&settings_content)?;

    println!("Settings de la instancia cargados: {}", settings.name);

    let mut instance_files = InstanceFiles {
        mods: Vec::new(),
        configs: Vec::new(),
        resourcepacks: Some(Vec::new()),
        shaderpacks: Some(Vec::new()),
    };

    let empty_vec = Vec::<String>::new();
    let ignored_mods = settings.ignored_files.as_ref().map(|p| &p.mods).unwrap_or(&empty_vec);
    let ignored_configs = settings.ignored_files.as_ref().map(|p| &p.configs).unwrap_or(&empty_vec);
    let ignored_resourcepacks = settings.ignored_files.as_ref().map(|p| &p.resourcepacks).unwrap_or(&empty_vec);
    let ignored_shaderpacks = settings.ignored_files.as_ref().map(|p| &p.shaderpacks).unwrap_or(&empty_vec);

    let mods_dir = instance_dir.join("mods");
    if mods_dir.exists() {
        println!("Escaneando directorio de mods...");
        instance_files.mods = scan_directory(&mods_dir, INSTANCE_ID, "mods", ignored_mods).await?;
        println!("   Encontrados {} archivos de mods", instance_files.mods.len());
    }

    let config_dir = instance_dir.join("config");
    if config_dir.exists() {
        println!("Escaneando directorio de config...");
        instance_files.configs = scan_directory(&config_dir, INSTANCE_ID, "config", ignored_configs).await?;
        println!("   Encontrados {} archivos de config", instance_files.configs.len());
    }

    let resourcepacks_dir = instance_dir.join("resourcepacks");
    if resourcepacks_dir.exists() {
        println!("Escaneando directorio de resourcepacks...");
        let resourcepacks = scan_directory(&resourcepacks_dir, INSTANCE_ID, "resourcepacks", ignored_resourcepacks).await?;
        if !resourcepacks.is_empty() {
            instance_files.resourcepacks = Some(resourcepacks);
            println!("   Encontrados {} resourcepacks", instance_files.resourcepacks.as_ref().unwrap().len());
        }
    }

    let shaderpacks_dir = instance_dir.join("shaderpacks");
    if shaderpacks_dir.exists() {
        println!("Escaneando directorio de shaderpacks...");
        let shaderpacks = scan_directory(&shaderpacks_dir, INSTANCE_ID, "shaderpacks", ignored_shaderpacks).await?;
        if !shaderpacks.is_empty() {
            instance_files.shaderpacks = Some(shaderpacks);
            println!("   Encontrados {} shaderpacks", instance_files.shaderpacks.as_ref().unwrap().len());
        }
    }

    // Detectar assets
    let assets_dir = instance_dir.join("assets");
    let mut icon: Option<String> = None;
    let mut background: Option<String> = None;
    let mut background_video: Option<String> = None;

    if assets_dir.exists() {
        if assets_dir.join("icon.png").exists() {
            icon = Some("assets/icon.png".to_string());
        }
        if assets_dir.join("background.jpg").exists() {
            background = Some("assets/background.jpg".to_string());
        }
        for entry in std::fs::read_dir(&assets_dir).ok().into_iter().flatten() {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext.eq_ignore_ascii_case("mp4") {
                            background_video = Some(format!("assets/{}", path.file_name().unwrap().to_string_lossy()));
                            break;
                        }
                    }
                }
            }
        }
    }

    let instance_config = InstanceConfig {
        instance: crate::models::InstanceInfo {
            id: settings.id.clone(),
            name: settings.name.clone(),
            description: settings.description.clone(),
            version: settings.version.clone(),
            minecraft_version: settings.minecraft_version.clone(),
            mod_loader: settings.mod_loader.clone(),
            icon,
            background,
            background_video,
        },
        files: instance_files,
        launch_settings: settings.launch_settings,
        ignored_files: settings.ignored_files.clone(),
    };

    let instance_json = serde_json::to_string_pretty(&instance_config)?;
    let instance_json_path = instance_dir.join("instance.json");
    fs::write(&instance_json_path, instance_json).await?;

    println!("Generado instance.json");

    let checksums = generate_checksums(&instance_config).await?;
    let checksums_json = serde_json::to_string_pretty(&checksums)?;
    let checksums_path = instance_dir.join("checksums.json");
    fs::write(&checksums_path, checksums_json).await?;

    println!("Generado checksums.json");

    println!("\nInstancia '{}' escaneada correctamente.", instance_config.instance.name);
    println!("Resumen:");
    println!("   Mods: {}", instance_config.files.mods.len());
    println!("   Configs: {}", instance_config.files.configs.len());
    println!("   Resource packs: {}", instance_config.files.resourcepacks.as_ref().map(|r| r.len()).unwrap_or(0));
    println!("   Shader packs: {}", instance_config.files.shaderpacks.as_ref().map(|s| s.len()).unwrap_or(0));

    Ok(())
}

async fn scan_directory(dir: &Path, instance_id: &str, category: &str, ignored_patterns: &[String]) -> Result<Vec<FileEntry>> {
    let mut files = Vec::new();

    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();

        if path.is_dir() || path.file_name().unwrap().to_str().unwrap().starts_with('.') {
            continue;
        }

        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            if filename.to_lowercase().starts_with("readme") {
                continue;
            }
        }

        let relative_path = get_relative_path(path, dir)?;
        let filename = path.file_name().unwrap().to_str().unwrap().to_string();

        // NOTA: los archivos ignorados SI se escanean e incluyen en el manifest
        // para que se descarguen la primera vez, pero el launcher no los borrara
        // si los quitas del servidor despues.
        let is_ignored = crate::utils::matches_glob_patterns(&relative_path, ignored_patterns);
        if is_ignored {
            println!("   Procesando (ignorado, protegido): {}", filename);
        } else {
            println!("   Procesando: {}", filename);
        }

        let hash = calculate_file_hash(path).await?;
        let md5 = calculate_file_md5(path).await?;
        let size = get_file_size(path).await?;
        let url = format!("instances/{}/{}/{}", instance_id, category, relative_path);

        let file_entry = FileEntry {
            name: filename,
            path: format!("{}/{}", category, relative_path),
            url,
            sha256: hash,
            md5: Some(md5),
            size: Some(size),
            required: Some(true),
            target: if category == "config" {
                Some(format!("config/{}", relative_path))
            } else {
                None
            },
        };

        files.push(file_entry);
    }

    Ok(files)
}

async fn generate_checksums(instance_config: &InstanceConfig) -> Result<serde_json::Value> {
    use std::collections::HashMap;

    let mut checksums = HashMap::new();

    for file in &instance_config.files.mods {
        checksums.insert(&file.path, &file.sha256);
    }

    for file in &instance_config.files.configs {
        checksums.insert(&file.path, &file.sha256);
    }

    if let Some(resourcepacks) = &instance_config.files.resourcepacks {
        for file in resourcepacks {
            checksums.insert(&file.path, &file.sha256);
        }
    }

    if let Some(shaderpacks) = &instance_config.files.shaderpacks {
        for file in shaderpacks {
            checksums.insert(&file.path, &file.sha256);
        }
    }

    Ok(serde_json::to_value(checksums)?)
}
