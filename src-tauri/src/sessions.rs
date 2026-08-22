use chrono::Utc;
use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Session {
    pub id: String,
    pub username: String,
    pub uuid: String, // UUID de Minecraft para la skin
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64, // Unix timestamp
    pub created_at: i64,
    pub updated_at: i64,
}

impl Session {
    pub fn new(username: String, uuid: String, access_token: String, refresh_token: Option<String>, expires_at: i64) -> Self {
        let now = Utc::now().timestamp();
        Self {
            id: format!("session_{}", now),
            username,
            uuid,
            access_token,
            refresh_token,
            expires_at,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn is_expired(&self) -> bool {
        let now = Utc::now().timestamp();
        now >= self.expires_at
    }
}

/// Persisted Xbox Live device identity: an ECDSA P-256 key pair and the device token
/// issued for it, used to sign every SISU authentication request.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DeviceTokenRecord {
    pub device_uuid: String,
    pub private_key_pem: String,
    pub x: String,
    pub y: String,
    pub issue_instant: i64,
    pub not_after: i64,
    pub token: String,
    /// JSON-serialized `HashMap<String, serde_json::Value>`.
    pub display_claims: String,
}

// A `SessionManager` is constructed fresh on every Tauri command invocation, but the
// underlying connection pool is process-wide: `db_path` never changes at runtime, so all
// instances share the same pool instead of each command opening (and migrating) its own
// SQLite connection.
static POOL: OnceCell<SqlitePool> = OnceCell::const_new();

pub struct SessionManager {
    pub db_path: PathBuf,
}

impl SessionManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

        let db_path = app_dir.join("sessions.db");

        Ok(Self { db_path })
    }

    async fn pool(&self) -> Result<&'static SqlitePool, String> {
        POOL.get_or_try_init(|| async {
            let options = SqliteConnectOptions::from_str(&self.db_path.to_string_lossy())
                .map_err(|e| e.to_string())?
                .create_if_missing(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(4)
                .connect_with(options)
                .await
                .map_err(|e| e.to_string())?;
            Self::ensure_schema(&pool).await?;
            info!("Sessions database initialized at: {:?}", self.db_path);
            Ok::<SqlitePool, String>(pool)
        })
        .await
    }

    async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                uuid TEXT NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        // Create index for faster lookups by username
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        // Ensure unique username to avoid duplicates
        let _ = sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS uniq_sessions_username ON sessions(username)")
            .execute(pool)
            .await;

        // Try to add is_active column in case of older schema (ignore error if exists)
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
            .execute(pool)
            .await;

        // Try to add uuid column in case of older schema (ignore error if exists)
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN uuid TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await;

        // Create index for expiration checks
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        // Single-row table holding the Xbox Live device identity (ECDSA key pair + device
        // token) used to sign SISU authentication requests. Kept stable across logins so we
        // don't re-register a new device with Xbox Live every time the user signs in.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msa_device_tokens (
                id INTEGER PRIMARY KEY CHECK (id = 0),
                device_uuid TEXT NOT NULL,
                private_key_pem TEXT NOT NULL,
                x TEXT NOT NULL,
                y TEXT NOT NULL,
                issue_instant INTEGER NOT NULL,
                not_after INTEGER NOT NULL,
                token TEXT NOT NULL,
                display_claims TEXT NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn get_device_token(&self) -> Result<Option<DeviceTokenRecord>, String> {
        let pool = self.pool().await?;

        sqlx::query_as::<_, DeviceTokenRecord>(
            "SELECT device_uuid, private_key_pem, x, y, issue_instant, not_after, token, display_claims
             FROM msa_device_tokens WHERE id = 0",
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn save_device_token(&self, record: &DeviceTokenRecord) -> Result<(), String> {
        let pool = self.pool().await?;

        sqlx::query(
            "INSERT INTO msa_device_tokens (id, device_uuid, private_key_pem, x, y, issue_instant, not_after, token, display_claims)
             VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               device_uuid=excluded.device_uuid,
               private_key_pem=excluded.private_key_pem,
               x=excluded.x,
               y=excluded.y,
               issue_instant=excluded.issue_instant,
               not_after=excluded.not_after,
               token=excluded.token,
               display_claims=excluded.display_claims",
        )
        .bind(&record.device_uuid)
        .bind(&record.private_key_pem)
        .bind(&record.x)
        .bind(&record.y)
        .bind(record.issue_instant)
        .bind(record.not_after)
        .bind(&record.token)
        .bind(&record.display_claims)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn save_session(&self, session: &Session) -> Result<(), String> {
        let pool = self.pool().await?;

        sqlx::query(
            "INSERT INTO sessions (id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(username) DO UPDATE SET
               uuid=excluded.uuid,
               access_token=excluded.access_token,
               refresh_token=excluded.refresh_token,
               expires_at=excluded.expires_at,
               updated_at=excluded.updated_at",
        )
        .bind(&session.id)
        .bind(&session.username)
        .bind(&session.uuid)
        .bind(&session.access_token)
        .bind(&session.refresh_token)
        .bind(session.expires_at)
        .bind(session.created_at)
        .bind(session.updated_at)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        info!("Session saved for user: {}", session.username);
        Ok(())
    }

    pub async fn get_session(&self, username: &str) -> Result<Option<Session>, String> {
        let pool = self.pool().await?;

        let result = sqlx::query_as::<_, Session>(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions WHERE username = ?",
        )
        .bind(username)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string());

        match result {
            Ok(Some(session)) => {
                info!("Session retrieved for user: {}", username);
                Ok(Some(session))
            }
            Ok(None) => {
                warn!("No session found for user: {}", username);
                Ok(None)
            }
            Err(e) => {
                error!("Error retrieving session for user {}: {}", username, e);
                Err(e)
            }
        }
    }

    pub async fn get_all_sessions(&self) -> Result<Vec<Session>, String> {
        let pool = self.pool().await?;

        let sessions = sqlx::query_as::<_, Session>(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        info!("Retrieved {} sessions", sessions.len());
        Ok(sessions)
    }

    pub async fn update_session(&self, session: &Session) -> Result<(), String> {
        let pool = self.pool().await?;

        sqlx::query(
            "UPDATE sessions SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
             WHERE username = ?",
        )
        .bind(&session.access_token)
        .bind(&session.refresh_token)
        .bind(session.expires_at)
        .bind(session.updated_at)
        .bind(&session.username)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        info!("Session updated for user: {}", session.username);
        Ok(())
    }

    pub async fn delete_session(&self, username: &str) -> Result<(), String> {
        let pool = self.pool().await?;

        let result = sqlx::query("DELETE FROM sessions WHERE username = ?")
            .bind(username)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        if result.rows_affected() > 0 {
            info!("Session deleted for user: {}", username);
        } else {
            warn!("No session found to delete for user: {}", username);
        }

        Ok(())
    }

    pub async fn clear_all_sessions(&self) -> Result<(), String> {
        let pool = self.pool().await?;

        let result = sqlx::query("DELETE FROM sessions")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        info!("Cleared {} sessions", result.rows_affected());
        Ok(())
    }

    pub async fn cleanup_expired_sessions(&self) -> Result<usize, String> {
        let pool = self.pool().await?;

        let now = Utc::now().timestamp();
        let result = sqlx::query("DELETE FROM sessions WHERE expires_at < ?")
            .bind(now)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        let deleted = result.rows_affected() as usize;
        if deleted > 0 {
            info!("Cleaned up {} expired sessions", deleted);
        }

        Ok(deleted)
    }

    pub async fn get_active_session(&self) -> Result<Option<Session>, String> {
        let pool = self.pool().await?;

        let now = Utc::now().timestamp();

        let result = sqlx::query_as::<_, Session>(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions WHERE expires_at > ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(now)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string());

        match result {
            Ok(Some(session)) => {
                info!("Active session found for user: {}", session.username);
                Ok(Some(session))
            }
            Ok(None) => {
                info!("No active session found");
                Ok(None)
            }
            Err(e) => {
                error!("Error retrieving active session: {}", e);
                Err(e)
            }
        }
    }
}
