use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use std::thread;
use std::time::Duration;

pub const DISCORD_CLIENT_ID: &str = "1167540128986697850";

pub static DISCORD_CLIENT: Lazy<Arc<Mutex<Option<DiscordIpcClient>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

pub static IS_CONNECTED: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::new(false)));

pub fn initialize_discord_rpc() -> Result<(), String> {
    log::info!("Initializing Discord RPC...");

    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    let mut connected_guard = IS_CONNECTED.lock().map_err(|e| e.to_string())?;

    if client_guard.is_some() && *connected_guard {
        log::warn!("Discord RPC client already initialized and connected");
        return Ok(());
    }

    if client_guard.is_some() {
        log::info!("Cleaning up previous Discord RPC client...");
        *client_guard = None;
        *connected_guard = false;
    }

    match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
        Ok(mut client) => {
            log::info!("Discord RPC client created successfully");

            match client.connect() {
                Ok(_) => {
                    log::info!("Discord RPC client connected, waiting for ready event...");

                    log::info!("Discord RPC client connected, assuming ready state");
                    *connected_guard = true;
                    *client_guard = Some(client);
                    Ok(())
                }
                Err(e) => {
                    let error_msg = format!("Failed to connect Discord RPC client: {}", e);
                    log::error!("{}", error_msg);
                    Err(error_msg)
                }
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to create Discord RPC client: {}", e);
            log::error!("{}", error_msg);
            Err(error_msg)
        }
    }
}

pub fn update_discord_presence(state: &str, details: &str) -> Result<(), String> {
    log::info!("Updating Discord presence - State: {}, Details: {}", state, details);

    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;

    if let Some(client) = client_guard.as_mut() {
        {
            let connected_guard = IS_CONNECTED.lock().map_err(|e| e.to_string())?;
            if !*connected_guard {
                log::warn!("Discord RPC not connected, attempting to reconnect...");
                match client.connect() {
                    Ok(_) => {
                        log::info!("Discord RPC reconnected successfully");
                        drop(connected_guard);
                        let mut connected_guard = IS_CONNECTED.lock().map_err(|e| e.to_string())?;
                        *connected_guard = true;
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to reconnect Discord RPC: {}", e);
                        log::error!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            }
        }

        let activity_builder = activity::Activity::new()
            .state(state)
            .assets(
                activity::Assets::new()
                    .large_image("launcher") 
                    .large_text("Kindly Klan Klient")
            )
            .timestamps(
                activity::Timestamps::new()
                    .start(chrono::Utc::now().timestamp() as i64)
            );

        let mut activity = if !details.is_empty() {
            activity_builder.details(details)
        } else {
            activity_builder
        };

        activity = activity.buttons(vec![
            activity::Button::new("Únete al Discord", "https://discord.kindlyklan.com")
        ]);

        match client.set_activity(activity) {
            Ok(_) => {
                log::info!("Discord presence updated successfully");
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to update Discord presence: {}", e);
                log::error!("{}", error_msg);

                let mut connected_guard = IS_CONNECTED.lock().map_err(|e| e.to_string())?;
                *connected_guard = false;

                Err(error_msg)
            }
        }
    } else {
        let error_msg = "Discord RPC client not initialized".to_string();
        log::warn!("{}", error_msg);
        Err(error_msg)
    }
}

pub fn clear_discord_presence() -> Result<(), String> {
    log::info!("Clearing Discord presence...");

    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;

    if let Some(client) = client_guard.as_mut() {
        match client.clear_activity() {
            Ok(_) => {
                log::info!("Discord presence cleared successfully");
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to clear Discord presence: {}", e);
                log::error!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = "Discord RPC client not initialized".to_string();
        log::warn!("{}", error_msg);
        Err(error_msg)
    }
}

pub fn shutdown_discord_rpc() -> Result<(), String> {
    log::info!("Shutting down Discord RPC...");

    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    let mut connected_guard = IS_CONNECTED.lock().map_err(|e| e.to_string())?;

    *client_guard = None;
    *connected_guard = false;

    log::info!("Discord RPC client shut down successfully");
    Ok(())
}

pub fn is_discord_rpc_enabled() -> bool {
    let client_exists = DISCORD_CLIENT.lock().map(|guard| guard.is_some()).unwrap_or(false);
    let is_connected = IS_CONNECTED.lock().map(|guard| *guard).unwrap_or(false);
    client_exists && is_connected
}
