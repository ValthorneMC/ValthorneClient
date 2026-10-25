use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use s3::{creds::Credentials, Bucket, Region};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

use crate::models::{InstanceSettings, Manifest, ManifestFile};
use crate::utils::{matches_glob_patterns, resolve_target};

const INSTANCE_ID: &str = "valthorne";
const CATEGORIES: [(&str, &str); 4] = [
    ("mods", "mod"),
    ("config", "config"),
    ("resourcepacks", "resourcepack"),
    ("shaderpacks", "shaderpack"),
];

pub struct PublishOptions<'a> {
    pub key_path: &'a str,
    pub bucket: &'a str,
    pub dry_run: bool,
}

pub async fn run(opts: PublishOptions<'_>) -> Result<()> {
    let instance_dir = Path::new("instances").join(INSTANCE_ID);
    if !instance_dir.exists() {
        bail!("Instancia '{}' no encontrada en {}", INSTANCE_ID, instance_dir.display());
    }

    let settings: InstanceSettings = toml::from_str(
        &tokio::fs::read_to_string(instance_dir.join("settings.toml")).await.context("settings.toml")?,
    )?;
    let signing_key = load_signing_key(opts.key_path).await?;

    let mut files = collect_files(&instance_dir, &settings)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let total: u64 = files.iter().map(|f| f.size).sum();
    println!("{} archivos, {:.1} MB", files.len(), total as f64 / 1_048_576.0);

    let manifest = Manifest {
        schema: 2,
        version: settings.version.clone(),
        name: settings.name.clone(),
        description: settings.description.clone(),
        minecraft_version: settings.minecraft_version.clone(),
        mod_loader: settings.mod_loader.clone(),
        launch_settings: settings.launch_settings.clone(),
        published_at: chrono::Utc::now().to_rfc3339(),
        files,
    };
    let payload = serde_json::to_string(&manifest)?;
    let signature = STANDARD.encode(signing_key.sign(payload.as_bytes()).to_bytes());
    let envelope = serde_json::to_vec(&json!({ "payload": payload, "signature": signature }))?;

    if opts.dry_run {
        tokio::fs::write("manifest.preview.json", &envelope).await?;
        println!("--dry-run: manifiesto v{} firmado ({} bytes) en manifest.preview.json, no se sube nada", manifest.version, envelope.len());
        return Ok(());
    }

    let bucket = open_bucket(opts.bucket)?;
    upload_blobs(&bucket, &instance_dir, &manifest.files).await?;

    put(&bucket, &format!("manifests/{}.json", manifest.version), &envelope, "application/json").await?;
    put(&bucket, "manifests/latest.json", &envelope, "application/json").await?;

    println!("Publicado {} v{}", manifest.name, manifest.version);
    Ok(())
}

async fn load_signing_key(path: &str) -> Result<SigningKey> {
    let text = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("no se pudo leer la clave {path}; genera una con `keygen`"))?;
    let seed: [u8; 32] = STANDARD
        .decode(text.trim())?
        .try_into()
        .map_err(|_| anyhow!("la clave debe tener 32 bytes"))?;
    Ok(SigningKey::from_bytes(&seed))
}

fn open_bucket(name: &str) -> Result<Box<Bucket>> {
    let account = std::env::var("R2_ACCOUNT_ID").context("falta R2_ACCOUNT_ID")?;
    let key_id = std::env::var("R2_PUBLISH_KEY_ID").context("falta R2_PUBLISH_KEY_ID")?;
    let secret = std::env::var("R2_PUBLISH_SECRET").context("falta R2_PUBLISH_SECRET")?;

    let region = Region::Custom {
        region: "auto".into(),
        endpoint: format!("https://{account}.r2.cloudflarestorage.com"),
    };
    let credentials = Credentials::new(Some(&key_id), Some(&secret), None, None, None)?;
    Ok(Bucket::new(name, region, credentials)?.with_path_style())
}

fn collect_files(instance_dir: &Path, settings: &InstanceSettings) -> Result<Vec<ManifestFile>> {
    let ignored = settings.ignored_files.clone().unwrap_or_default();
    let mut files = Vec::new();

    for (dir, kind) in CATEGORIES {
        let root = instance_dir.join(dir);
        if !root.exists() {
            continue;
        }
        let once_patterns = match dir {
            "mods" => &ignored.mods,
            "config" => &ignored.configs,
            "resourcepacks" => &ignored.resourcepacks,
            _ => &ignored.shaderpacks,
        };

        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let relative = path.strip_prefix(&root)?.to_string_lossy().replace('\\', "/");
            let manifest_path = format!("{dir}/{relative}");
            let name = entry.file_name().to_string_lossy().to_string();
            let (sha256, size) = hash_file(path)?;

            files.push(ManifestFile {
                target: resolve_target(&manifest_path, &settings.file_targets),
                policy: if matches_glob_patterns(&name, once_patterns) { "once" } else { "managed" }.to_string(),
                path: manifest_path,
                kind: kind.to_string(),
                sha256,
                size,
            });
        }
    }

    // Icon, background and video feed the launcher UI; they are not placed in the game dir.
    let assets = instance_dir.join("assets");
    if assets.exists() {
        for entry in std::fs::read_dir(&assets)?.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let (sha256, size) = hash_file(&path)?;
            files.push(ManifestFile {
                path: format!("assets/{}", entry.file_name().to_string_lossy()),
                target: String::new(),
                kind: "asset".to_string(),
                policy: "managed".to_string(),
                sha256,
                size,
            });
        }
    }

    Ok(files)
}

fn hash_file(path: &Path) -> Result<(String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((hasher.finalize().iter().map(|b| format!("{b:02x}")).collect(), size))
}

async fn upload_blobs(bucket: &Bucket, instance_dir: &Path, files: &[ManifestFile]) -> Result<()> {
    // Identical content under several paths is uploaded once.
    let mut unique: BTreeMap<&str, &ManifestFile> = BTreeMap::new();
    for f in files {
        unique.entry(f.sha256.as_str()).or_insert(f);
    }

    let (mut uploaded, mut skipped) = (0, 0);
    for (sha, file) in unique {
        let key = format!("blobs/{}/{}", &sha[..2], sha);
        if matches!(bucket.head_object(&key).await, Ok((_, 200))) {
            skipped += 1;
            continue;
        }
        let source = instance_dir.join(&file.path);
        let bytes = tokio::fs::read(&source).await.with_context(|| source.display().to_string())?;
        println!("subiendo {} ({:.1} MB)", file.path, bytes.len() as f64 / 1_048_576.0);
        put(bucket, &key, &bytes, "application/octet-stream").await?;
        uploaded += 1;
    }
    println!("blobs: {uploaded} subidos, {skipped} ya existian");
    Ok(())
}

async fn put(bucket: &Bucket, key: &str, bytes: &[u8], content_type: &str) -> Result<()> {
    let response = bucket.put_object_with_content_type(key, bytes, content_type).await?;
    if response.status_code() != 200 {
        bail!("R2 respondio {} al subir {}", response.status_code(), key);
    }
    Ok(())
}
