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
    /// Sincroniza a dist/, re-hashea y genera manifest.json + zip de distribucion
    Package {
        /// Directorio de salida de la distribucion
        #[arg(short, long, default_value = "./dist")]
        output: String,
        /// URL base donde se publicaran los archivos
        #[arg(short, long, default_value = "https://files.playvalthorne.com")]
        base_url: String,
        /// Version de la distribucion (si no se indica, se intenta leer del manifest.json existente)
        #[arg(long)]
        version: Option<String>,
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
        Commands::Package { output, base_url, version } => {
            package::run(output, base_url, version.as_deref()).await?;
        },
    }

    Ok(())
}
