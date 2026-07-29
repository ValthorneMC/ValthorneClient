use anyhow::Result;
use tokio::fs;
use std::path::Path;
use crate::models::{InstanceSettings, ModLoader, LaunchSettings, FileTarget};

/// ID fijo de la (única) instancia de Valthorne. El launcher es de un solo
/// servidor/mundo, así que no hace falta gestionar múltiples instancias.
const INSTANCE_ID: &str = "valthorne";

pub async fn run(workspace: &str) -> Result<()> {
    let workspace_path = Path::new(workspace);

    println!("Inicializando workspace de Valthorne en: {}", workspace_path.display());

    // Crear estructura del workspace
    let instances_dir = workspace_path.join("instances");
    let dist_dir = workspace_path.join("dist");

    fs::create_dir_all(&instances_dir).await?;
    fs::create_dir_all(&dist_dir).await?;

    println!("Creado directorio de instancias: {}", instances_dir.display());
    println!("Creado directorio de distribucion: {}", dist_dir.display());

    // Crear ya la (unica) instancia "valthorne", combinando lo que en kk-builder
    // eran los comandos separados `init` + `create-instance`.
    let instance_dir = instances_dir.join(INSTANCE_ID);

    if instance_dir.exists() {
        println!("La instancia '{}' ya existe en: {} (se deja como esta)", INSTANCE_ID, instance_dir.display());
    } else {
        fs::create_dir_all(&instance_dir).await?;
        fs::create_dir_all(instance_dir.join("mods")).await?;
        fs::create_dir_all(instance_dir.join("config")).await?;
        fs::create_dir_all(instance_dir.join("resourcepacks")).await?;
        fs::create_dir_all(instance_dir.join("shaderpacks")).await?;
        fs::create_dir_all(instance_dir.join("assets")).await?;

        println!("Creada estructura de directorios de la instancia 'valthorne'");

        // Valores placeholder sensatos: el mantenedor DEBE revisar y editar
        // settings.toml antes de publicar (minecraft_version, mod_loader, etc.)
        let settings = InstanceSettings {
            id: INSTANCE_ID.to_string(),
            name: "Valthorne".to_string(),
            description: "Pack de mods/recursos del servidor Valthorne".to_string(),
            version: "1.0.0".to_string(),
            // PLACEHOLDER: ajustar a la version real de Minecraft del servidor.
            minecraft_version: "1.21.1".to_string(),
            // PLACEHOLDER: ajustar tipo/version del mod loader (neoforge/fabric/forge/vanilla).
            mod_loader: Some(ModLoader {
                r#type: "neoforge".to_string(),
                version: "21.1.0".to_string(),
            }),
            launch_settings: LaunchSettings::default(),
            ignored_files: None,
            // Minecraft lee estos dos desde la raiz de la instancia, no desde
            // config/. Se declaran aqui para que el builder los coloque bien.
            file_targets: vec![
                FileTarget { pattern: "config/options.txt".to_string(), dest: String::new() },
                FileTarget { pattern: "config/servers.dat".to_string(), dest: String::new() },
            ],
        };

        let settings_toml = toml::to_string_pretty(&settings)?;
        let settings_path = instance_dir.join("settings.toml");
        fs::write(&settings_path, settings_toml).await?;

        println!("Creado settings.toml (con valores PLACEHOLDER, editalo antes de publicar)");

        // Placeholders de assets vacios
        fs::write(instance_dir.join("assets").join("icon.png"), b"").await?;
        fs::write(instance_dir.join("assets").join("background.jpg"), b"").await?;

        println!("Creados assets de ejemplo (vacios, reemplazalos)");

        let mod_info = r#"# Valthorne - Directorio de mods

Coloca aqui los archivos .jar de los mods del servidor.

## Instrucciones:
1. Descarga los mods necesarios para el servidor Valthorne.
2. Coloca los archivos .jar directamente en esta carpeta.
3. Ejecuta: valthorne-builder scan
4. Genera el paquete cuando este listo: valthorne-builder package
"#;
        fs::write(instance_dir.join("mods").join("README.md"), mod_info).await?;

        println!("Creado directorio de mods con instrucciones");
    }

    // README general del workspace
    let readme_content = r#"# Valthorne Builder - Workspace

Este workspace contiene la (unica) instancia y los archivos de distribucion
del cliente de Valthorne.

## Estructura

```
workspace/
├── instances/
│   └── valthorne/          # La unica instancia (id fijo "valthorne")
│       ├── mods/           # Archivos .jar de mods
│       ├── config/         # Archivos de configuracion
│       ├── resourcepacks/  # Resource packs opcionales
│       ├── assets/         # Icono, fondo y video de fondo
│       └── settings.toml   # Configuracion de la instancia (PLACEHOLDERS a editar)
└── dist/                   # Archivos de distribucion generados
    ├── manifest.json        # Manifest de distribucion (DistributionManifest)
    ├── instances/valthorne/ # instance.json + checksums.json + archivos
    └── dist.zip              # Paquete final para subir al servidor de archivos
```

## Comandos

```bash
# Inicializar workspace + crear instancia "valthorne"
valthorne-builder init

# Escanear archivos de la instancia y generar checksums
valthorne-builder scan

# Generar dist/ (manifest.json + instance.json + zip) listo para publicar
valthorne-builder package
```

IMPORTANTE: revisa y edita `instances/valthorne/settings.toml` — los valores
de `minecraft_version` y `mod_loader` que crea `init` son PLACEHOLDERS.
"#;

    let readme_path = workspace_path.join("README.md");
    fs::write(&readme_path, readme_content).await?;
    println!("Creado README.md con instrucciones de uso");

    println!("\nWorkspace inicializado correctamente.");
    println!("Directorio de instancias: {}", instances_dir.display());
    println!("Directorio de distribucion: {}", dist_dir.display());
    println!("\nSiguientes pasos:");
    println!("   1. Revisa/edita: {}", instance_dir.join("settings.toml").display());
    println!("   2. Anade mods a: {}", instance_dir.join("mods").display());
    println!("   3. Escanea: valthorne-builder scan");
    println!("   4. Empaqueta: valthorne-builder package");

    Ok(())
}
