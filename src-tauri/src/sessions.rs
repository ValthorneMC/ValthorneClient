use chrono::Utc;
use log::{info, warn, error};
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

    #[allow(dead_code)]
    pub fn is_expiring_soon(&self, minutes_threshold: i64) -> bool {
        let now = Utc::now().timestamp();
        let threshold = now + (minutes_threshold * 60);
        self.expires_at <= threshold
    }
}

pub struct SessionManager {
    pub db_path: PathBuf,
}

impl SessionManager {
    pub fn new(app_handle: &AppHandle) -> SqlResult<Self> {
        let app_dir = app_handle.path().app_data_dir()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        std::fs::create_dir_all(&app_dir)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let db_path = app_dir.join("sessions.db");

        let manager = Self { db_path };
        manager.init_db()?;

        Ok(manager)
    }

    fn init_db(&self) -> SqlResult<()> {
        let conn = Connection::open(&self.db_path)?;

        conn.execute(
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
            [],
        )?;

        // Create index for faster lookups by username
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)",
            [],
        )?;

        // Ensure unique username to avoid duplicates
        let _ = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uniq_sessions_username ON sessions(username)",
            [],
        );

        // Try to add is_active column in case of older schema (ignore error if exists)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
            [],
        );
        
        // Try to add uuid column in case of older schema (ignore error if exists)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN uuid TEXT NOT NULL DEFAULT ''",
            [],
        );

        // Create index for expiration checks
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
            [],
        )?;

        info!("Sessions database initialized at: {:?}", self.db_path);
        Ok(())
    }

    pub fn save_session(&self, session: &Session) -> SqlResult<()> {
        let conn = Connection::open(&self.db_path)?;

        conn.execute(
            "INSERT INTO sessions (id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
             ON CONFLICT(username) DO UPDATE SET
               uuid=excluded.uuid,
               access_token=excluded.access_token,
               refresh_token=excluded.refresh_token,
               expires_at=excluded.expires_at,
               updated_at=excluded.updated_at",
            params![
                session.id,
                session.username,
                session.uuid,
                session.access_token,
                session.refresh_token,
                session.expires_at,
                session.created_at,
                session.updated_at
            ],
        )?;

        info!("Session saved for user: {}", session.username);
        Ok(())
    }

    pub fn get_session(&self, username: &str) -> SqlResult<Option<Session>> {
        let conn = Connection::open(&self.db_path)?;

        let mut stmt = conn.prepare(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions WHERE username = ?1"
        )?;

        let result = stmt.query_row(params![username], |row| {
            Ok(Session {
                id: row.get(0)?,
                username: row.get(1)?,
                uuid: row.get(2)?,
                access_token: row.get(3)?,
                refresh_token: row.get(4)?,
                expires_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        });

        match result {
            Ok(session) => {
                info!("Session retrieved for user: {}", username);
                Ok(Some(session))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                warn!("No session found for user: {}", username);
                Ok(None)
            }
            Err(e) => {
                error!("Error retrieving session for user {}: {}", username, e);
                Err(e)
            }
        }
    }

    pub fn get_all_sessions(&self) -> SqlResult<Vec<Session>> {
        let conn = Connection::open(&self.db_path)?;

        let mut stmt = conn.prepare(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions ORDER BY updated_at DESC"
        )?;

        let sessions = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                username: row.get(1)?,
                uuid: row.get(2)?,
                access_token: row.get(3)?,
                refresh_token: row.get(4)?,
                expires_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut result = Vec::new();
        for session in sessions {
            result.push(session?);
        }

        info!("Retrieved {} sessions", result.len());
        Ok(result)
    }

    pub fn update_session(&self, session: &Session) -> SqlResult<()> {
        let conn = Connection::open(&self.db_path)?;

        conn.execute(
            "UPDATE sessions SET access_token = ?1, refresh_token = ?2, expires_at = ?3, updated_at = ?4
             WHERE username = ?5",
            params![
                session.access_token,
                session.refresh_token,
                session.expires_at,
                session.updated_at,
                session.username
            ],
        )?;

        info!("Session updated for user: {}", session.username);
        Ok(())
    }

    pub fn delete_session(&self, username: &str) -> SqlResult<()> {
        let conn = Connection::open(&self.db_path)?;

        let deleted = conn.execute(
            "DELETE FROM sessions WHERE username = ?1",
            params![username],
        )?;

        if deleted > 0 {
            info!("Session deleted for user: {}", username);
        } else {
            warn!("No session found to delete for user: {}", username);
        }

        Ok(())
    }

    pub fn clear_all_sessions(&self) -> SqlResult<()> {
        let conn = Connection::open(&self.db_path)?;

        let deleted = conn.execute("DELETE FROM sessions", [])?;

        info!("Cleared {} sessions", deleted);
        Ok(())
    }

    pub fn cleanup_expired_sessions(&self) -> SqlResult<usize> {
        let conn = Connection::open(&self.db_path)?;

        let now = Utc::now().timestamp();
        let deleted = conn.execute(
            "DELETE FROM sessions WHERE expires_at < ?1",
            params![now],
        )?;

        if deleted > 0 {
            info!("Cleaned up {} expired sessions", deleted);
        }

        Ok(deleted)
    }

    pub fn get_active_session(&self) -> SqlResult<Option<Session>> {
        let conn = Connection::open(&self.db_path)?;

        let now = Utc::now().timestamp();

        let mut stmt = conn.prepare(
            "SELECT id, username, uuid, access_token, refresh_token, expires_at, created_at, updated_at
             FROM sessions WHERE expires_at > ?1 AND is_active = 1 ORDER BY updated_at DESC LIMIT 1"
        )?;

        let result = stmt.query_row(params![now], |row| {
            Ok(Session {
                id: row.get(0)?,
                username: row.get(1)?,
                uuid: row.get(2)?,
                access_token: row.get(3)?,
                refresh_token: row.get(4)?,
                expires_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        });

        match result {
            Ok(session) => {
                info!("Active session found for user: {}", session.username);
                Ok(Some(session))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
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
