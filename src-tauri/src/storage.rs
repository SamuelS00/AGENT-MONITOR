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

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(include_str!("../migrations/0001_initial.sql"))
        .map_err(|error| error.to_string())
}

#[allow(dead_code)]
fn database_path(directory: &Path) -> std::path::PathBuf {
    directory.join("agent-monitor.sqlite3")
}
