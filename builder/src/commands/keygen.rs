use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use rand::RngCore;
use std::path::Path;

/// Writes a fresh Ed25519 signing key (base64 seed) and prints the public key
/// that must be embedded in the client.
pub async fn run(output: &str) -> Result<()> {
    let path = Path::new(output);
    if path.exists() {
        bail!("{} ya existe; no se sobrescribe para no perder la clave actual", path.display());
    }

    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    let key = SigningKey::from_bytes(&seed);

    tokio::fs::write(path, STANDARD.encode(seed)).await?;

    println!("Clave privada guardada en {} (no la subas a git ni la pierdas)", path.display());
    println!("Clave publica (para el cliente):\n{}", STANDARD.encode(key.verifying_key().to_bytes()));
    Ok(())
}
