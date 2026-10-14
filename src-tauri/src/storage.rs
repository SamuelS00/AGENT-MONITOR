use crate::domain::MonitorSnapshot;
use rusqlite::{params, Connection};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

pub struct Storage {
    connection: Connection,
}

impl Storage {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let connection =
            Connection::open(directory.join("agent-monitor.sqlite3")).map_err(|error| error.to_string())?;
        migrate(&connection)?;
        Ok(Self { connection })
    }

    pub fn save_snapshot(&self, snapshot: &MonitorSnapshot) -> Result<(), String> {
        let data = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
        self.connection
            .execute(
                "INSERT INTO collector_snapshots (observed_at, payload_json) VALUES (?1, ?2)",
                params![snapshot.observed_at, data],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

impl Storage {
    /// Stored snapshots observed at or after `since` (an RFC 3339 timestamp), oldest first. A payload that does not
    /// parse is skipped rather than failing the whole read.
    pub fn snapshots_since(&self, since: &str) -> Result<Vec<(String, serde_json::Value)>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT observed_at, payload_json FROM collector_snapshots WHERE observed_at >= ?1 ORDER BY observed_at")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([since], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| error.to_string())?;
        Ok(rows
            .filter_map(Result::ok)
            .filter_map(|(at, json)| Some((at, serde_json::from_str(&json).ok()?)))
            .collect())
    }

    /// Drop snapshots older than `before` so the database does not grow without bound.
    pub fn prune_before(&self, before: &str) -> Result<usize, String> {
        self.connection
            .execute("DELETE FROM collector_snapshots WHERE observed_at < ?1", [before])
            .map_err(|error| error.to_string())
    }
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(include_str!("../migrations/0001_initial.sql"))
        .map_err(|error| error.to_string())
}

#[allow(dead_code)]
fn database_path(directory: &Path) -> std::path::PathBuf {
    directory.join("agent-monitor.sqlite3")
}
