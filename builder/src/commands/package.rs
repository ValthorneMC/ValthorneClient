use anyhow::Result;
use tokio::fs;
use std::path::Path;
use walkdir::WalkDir;
use serde_json;
use crate::models::{DistributionManifest, DistributionInfo, InstanceSummary, InstanceConfig, InstanceSettings, InstanceFiles, FileEntry};
use crate::utils::{calculate_file_hash, calculate_file_md5, get_file_size};

const INSTANCE_ID: &str = "valthorne";

pub async fn run(output: &str, base_url: &str, version: Option<&str>) -> Result<()> {
    let instances_dir = Path::new("instances");
    let output_dir = Path::new(output);
    let instance_dir = instances_dir.join(INSTANCE_ID);

    if !instance_dir.exists() {
        return Err(anyhow::anyhow!(
            "Instancia '{}' no encontrada en: {}. Ejecuta 'valthorne-builder init' primero.",
            INSTANCE_ID,
            instance_dir.display()
        ));
    }

    println!("Empaquetando distribucion de Valthorne");
    println!("Directorio de salida: {}", output_dir.display());

    // Determinar version de la distribucion: parametro > manifest existente > default
    let distribution_version = if let Some(ver) = version {
        ver.to_string()
    } else {
        let existing_manifest_path = output_dir.join("manifest.json");
        if existing_manifest_path.exists() {
            match fs::read_to_string(&existing_manifest_path).await {
                Ok(content) => {
                    if let Ok(existing_manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(version) = existing_manifest.get("distribution")
                            .and_then(|d| d.get("version"))
                            .and_then(|v| v.as_str()) {
                            println!("Usando version del manifest existente: {}", version);
                            version.to_string()
                        } else {
                            "1.0.0".to_string()
                        }
                    } else {
                        "1.0.0".to_string()
                    }
                }
                Err(_) => "1.0.0".to_string()
            }
        } else {
            "1.0.0".to_string()
        }
    };

    fs::create_dir_all(output_dir).await?;
    let output_instances_dir = output_dir.join("instances");
    fs::create_dir_all(&output_instances_dir).await?;

    println!("Procesando instancia: {}", INSTANCE_ID);

    let settings_path = instance_dir.join("settings.toml");
    if !settings_path.exists() {
        return Err(anyhow::anyhow!("settings.toml no encontrado en la instancia '{}'", INSTANCE_ID));
    }
    let settings_content = fs::read_to_string(&settings_path).await?;
    let settings: InstanceSettings = toml::from_str(&settings_content)?;

    // Sincronizar instances/valthorne -> dist/instances/valthorne (reflejando borrados)
    let instance_output_dir = output_instances_dir.join(INSTANCE_ID);
    copy_instance_to_distribution(&instance_dir, &instance_output_dir).await?;

    // Re-hashear desde el destino ya copiado
    let instance_files = scan_destination_instance(&instance_output_dir, INSTANCE_ID).await?;

    // Detectar assets desde el destino
    let assets_dir = instance_output_dir.join("assets");
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

    let instance_json_path = instance_output_dir.join("instance.json");
    let instance_json = serde_json::to_string_pretty(&instance_config)?;
    fs::write(&instance_json_path, instance_json).await?;

    let checksums = generate_checksums_from_files(&instance_config).await?;
    let checksums_json = serde_json::to_string_pretty(&checksums)?;
    let checksums_path = instance_output_dir.join("checksums.json");
    fs::write(&checksums_path, checksums_json).await?;

    let instance_summary = InstanceSummary {
        id: settings.id.clone(),
        name: settings.name.clone(),
        description: settings.description.clone(),
        version: settings.version.clone(),
        minecraft_version: settings.minecraft_version.clone(),
        icon: instance_config.instance.icon.as_ref().map(|icon| format!("instances/{}/{}", INSTANCE_ID, icon)),
        background: instance_config.instance.background.as_ref().map(|bg| format!("instances/{}/{}", INSTANCE_ID, bg)),
        background_video: instance_config.instance.background_video.as_ref().map(|vid| format!("instances/{}/{}", INSTANCE_ID, vid)),
        last_updated: Some(chrono::Utc::now().to_rfc3339()),
        instance_url: format!("instances/{}/instance.json", INSTANCE_ID),
    };

    println!("Procesada instancia: {} (v{})", instance_config.instance.name, instance_config.instance.version);

    // Manifest de distribucion con UNA sola entrada en `instances` (formato
    // requerido por el launcher actual, aunque solo haya una instancia posible).
    let distribution_info = DistributionInfo {
        name: "Valthorne".to_string(),
        version: distribution_version,
        description: "Pack de mods/recursos del cliente de Valthorne".to_string(),
        base_url: base_url.to_string(),
        last_updated: chrono::Utc::now().to_rfc3339(),
    };

    let distribution_manifest = DistributionManifest {
        distribution: distribution_info,
        instances: vec![instance_summary],
    };

    let manifest_json = serde_json::to_string_pretty(&distribution_manifest)?;
    let manifest_path = output_dir.join("manifest.json");
    fs::write(&manifest_path, manifest_json).await?;

    println!("Generado manifest.json de distribucion");

    // Crear el ZIP con todo el contenido de dist/
    let zip_path = output_dir.join(format!("{}.zip", output_dir.file_name().unwrap_or_default().to_string_lossy()));

    println!("Creando archivo ZIP: {}", zip_path.display());
    create_distribution_zip_async(output_dir, &zip_path).await?;
    println!("Creado archivo ZIP: {}", zip_path.display());

    println!("\nDistribucion generada correctamente.");
    println!("Resumen:");
    println!("   Nombre: {}", distribution_manifest.distribution.name);
    println!("   Version: {}", distribution_manifest.distribution.version);
    println!("   Instancias: {}", distribution_manifest.instances.len());
    println!("   Base URL: {}", distribution_manifest.distribution.base_url);
    println!("\nArchivos de distribucion:");
    println!("   {}", manifest_path.display());
    println!("   {}", output_instances_dir.display());
    println!("   {}", zip_path.display());
    println!("\nDespliegue:");
    println!("   1. Sube {} a tu servidor de archivos", zip_path.display());
    println!("   2. Extrae el ZIP en el servidor");
    println!("   3. Asegurate de que los archivos son accesibles en: {}", base_url);
    println!("   4. Apunta el launcher a: {}/manifest.json", base_url);

    Ok(())
}

async fn copy_instance_to_distribution(source: &Path, destination: &Path) -> Result<()> {
    let mut source_files = std::collections::HashSet::new();

    for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
        let source_path = entry.path();
        if source_path.is_file() {
            let relative_path = source_path.strip_prefix(source)?;
            source_files.insert(relative_path.to_string_lossy().replace('\\', "/").to_string());
        }
    }

    let mut removed_dirs = std::collections::HashSet::new();
    if destination.exists() {
        let mut files_to_remove = Vec::new();

        for entry in WalkDir::new(destination).max_depth(100).into_iter().filter_map(|e| e.ok()) {
            let dest_path = entry.path();
            if dest_path.is_file() {
                let relative_path = dest_path.strip_prefix(destination)?;
                let relative_str = relative_path.to_string_lossy().replace('\\', "/").to_string();

                if !source_files.contains(&relative_str) {
                    files_to_remove.push(dest_path.to_path_buf());
                }
            }
        }

        for file_path in &files_to_remove {
            let relative_path = file_path.strip_prefix(destination)?;
            println!("   Eliminando archivo obsoleto: {}", relative_path.display());
            fs::remove_file(file_path).await?;

            if let Some(parent) = file_path.parent() {
                removed_dirs.insert(parent.to_path_buf());
            }
        }

        let mut dirs_to_check: Vec<_> = removed_dirs.into_iter().collect();
        dirs_to_check.sort_by(|a, b| {
            b.components().count().cmp(&a.components().count())
        });

        for dir_path in dirs_to_check {
            if dir_path != destination {
                match std::fs::read_dir(&dir_path) {
                    Ok(mut entries) => {
                        if entries.next().is_none() {
                            if let Ok(relative) = dir_path.strip_prefix(destination) {
                                println!("   Eliminando directorio vacio: {}", relative.display());
                                let _ = fs::remove_dir(&dir_path).await;
                            }
                        }
                    }
                    Err(_) => {}
                }
            }
        }
    }

    fs::create_dir_all(destination).await?;

    for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
        let source_path = entry.path();
        let relative_path = source_path.strip_prefix(source)?;
        let dest_path = destination.join(relative_path);

        if source_path.is_dir() {
            fs::create_dir_all(&dest_path).await?;
        } else {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(source_path, &dest_path).await?;
        }
    }

    Ok(())
}

async fn scan_destination_instance(destination: &Path, instance_id: &str) -> Result<InstanceFiles> {
    let settings_path = destination.join("settings.toml");
    let settings = if settings_path.exists() {
        match tokio::fs::read_to_string(&settings_path).await {
            Ok(content) => toml::from_str::<crate::models::InstanceSettings>(&content).ok(),
            Err(_) => None,
        }
    } else {
        None
    };

    let ignored_files_config = settings.as_ref().and_then(|s| s.ignored_files.clone());
    let file_targets = settings.map(|s| s.file_targets).unwrap_or_default();

    let empty_vec = Vec::<String>::new();
    let ignored_mods = ignored_files_config.as_ref().map(|p| &p.mods).unwrap_or(&empty_vec);
    let ignored_configs = ignored_files_config.as_ref().map(|p| &p.configs).unwrap_or(&empty_vec);
    let ignored_resourcepacks = ignored_files_config.as_ref().map(|p| &p.resourcepacks).unwrap_or(&empty_vec);
    let ignored_shaderpacks = ignored_files_config.as_ref().map(|p| &p.shaderpacks).unwrap_or(&empty_vec);

    let mut instance_files = InstanceFiles { mods: Vec::new(), configs: Vec::new(), resourcepacks: Some(Vec::new()), shaderpacks: Some(Vec::new()) };

    let mods_dir = destination.join("mods");
    if mods_dir.exists() {
        instance_files.mods = scan_category(&mods_dir, instance_id, "mods", ignored_mods, &file_targets).await?;
    }

    let config_dir = destination.join("config");
    if config_dir.exists() {
        instance_files.configs = scan_category(&config_dir, instance_id, "config", ignored_configs, &file_targets).await?;
    }

    let rp_dir = destination.join("resourcepacks");
    if rp_dir.exists() {
        let rps = scan_category(&rp_dir, instance_id, "resourcepacks", ignored_resourcepacks, &file_targets).await?;
        if !rps.is_empty() { instance_files.resourcepacks = Some(rps); }
    }

    let sp_dir = destination.join("shaderpacks");
    if sp_dir.exists() {
        let sps = scan_category(&sp_dir, instance_id, "shaderpacks", ignored_shaderpacks, &file_targets).await?;
        if !sps.is_empty() { instance_files.shaderpacks = Some(sps); }
    }

    Ok(instance_files)
}

async fn scan_category(
    dir: &Path,
    instance_id: &str,
    category: &str,
    _ignored_patterns: &[String],
    file_targets: &[crate::models::FileTarget],
) -> Result<Vec<FileEntry>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() { continue; }
        if path.file_name().unwrap().to_string_lossy().starts_with('.') { continue; }

        let relative = path.strip_prefix(dir)?;
        let relative_str = relative.to_string_lossy().replace('\\', "/");

        let sha256 = calculate_file_hash(path).await?;
        let md5 = calculate_file_md5(path).await?;
        let size = get_file_size(path).await?;
        let url = format!("instances/{}/{}/{}", instance_id, category, relative_str);
        let manifest_path = format!("{}/{}", category, relative_str);
        let target = crate::utils::resolve_target(&manifest_path, file_targets);

        files.push(FileEntry {
            name: path.file_name().unwrap().to_string_lossy().to_string(),
            path: manifest_path,
            url,
            sha256,
            md5: Some(md5),
            size: Some(size),
            required: Some(true),
            target: Some(target),
        });
    }
    Ok(files)
}

async fn generate_checksums_from_files(instance_config: &InstanceConfig) -> Result<serde_json::Value> {
    use std::collections::HashMap;
    let mut checksums = HashMap::new();
    for file in &instance_config.files.mods { checksums.insert(&file.path, &file.sha256); }
    for file in &instance_config.files.configs { checksums.insert(&file.path, &file.sha256); }
    if let Some(rp) = &instance_config.files.resourcepacks { for f in rp { checksums.insert(&f.path, &f.sha256); } }
    if let Some(sp) = &instance_config.files.shaderpacks { for f in sp { checksums.insert(&f.path, &f.sha256); } }
    Ok(serde_json::to_value(checksums)?)
}

async fn create_distribution_zip_async(source_dir: &Path, zip_path: &Path) -> Result<()> {
    use std::fs::File;
    use zip::ZipWriter;
    use zip::write::FileOptions;
    use std::io::Write;

    let zip_file_name = zip_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dist.zip");

    if zip_path.exists() {
        std::fs::remove_file(zip_path)?;
    }

    let file = File::create(zip_path)?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    for entry in WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.strip_prefix(source_dir)
            .unwrap()
            .to_string_lossy();

        if path.is_file() {
            if path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == zip_file_name)
                .unwrap_or(false) {
                continue;
            }

            let file_name = name.replace('\\', "/");

            let file_contents = tokio::fs::read(path).await?;

            zip.start_file(&file_name, options)?;
            zip.write_all(&file_contents)?;
        }
    }

    zip.finish()?;
    Ok(())
}
