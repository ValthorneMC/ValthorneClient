use clap::{Parser, Subcommand};
use anyhow::Result;

mod commands;
mod models;
mod utils;

use commands::*;

#[derive(Parser)]
#[command(name = "valthorne-builder")]
#[command(about = "CLI para preparar y publicar el pack de mods/recursos de Valthorne")]
#[command(version = env!("CARGO_PKG_VERSION"))]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Inicializa el workspace (instances/, dist/) y crea la instancia "valthorne"
    Init {
        /// Directorio del workspace
        #[arg(short, long, default_value = ".")]
        workspace: String,
    },
    /// Escanea instances/valthorne y genera instance.json + checksums.json
    Scan,
    /// Genera una clave de firma Ed25519 para el manifiesto
    Keygen {
        #[arg(short, long, default_value = "signing.key")]
        output: String,
    },
    /// Hashea la instancia, sube los blobs nuevos a R2 y publica el manifiesto firmado
    Publish {
        #[arg(long, default_value = "signing.key")]
        key: String,
        #[arg(long, default_value = "valthorne-client")]
        bucket: String,
        /// Calcula y firma el manifiesto sin subir nada
        #[arg(long)]
        dry_run: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Init { workspace } => {
            init_workspace::run(workspace).await?;
        },
        Commands::Scan => {
            scan_instance::run().await?;
        },
        Commands::Keygen { output } => {
            keygen::run(output).await?;
        },
        Commands::Publish { key, bucket, dry_run } => {
            publish::run(publish::PublishOptions { key_path: key, bucket, dry_run: *dry_run }).await?;
        },
    }

    Ok(())
}
