mod adapters;
mod collector;
mod domain;
mod storage;

use collector::Collector;
use domain::MonitorSnapshot;
use std::sync::Mutex;
use storage::Storage;
use tauri::{Manager, State};

struct AppState {
    collector: Collector,
    storage: Mutex<Storage>,
    latest: Mutex<Option<MonitorSnapshot>>,
}

fn collect(state: &AppState) -> Result<MonitorSnapshot, String> {
    let snapshot = state.collector.collect();
    state
        .storage
        .lock()
        .map_err(|_| "storage lock unavailable".to_string())?
        .save_snapshot(&snapshot)?;
    *state
        .latest
        .lock()
        .map_err(|_| "snapshot lock unavailable".to_string())? = Some(snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn monitor_snapshot(state: State<'_, AppState>) -> Result<MonitorSnapshot, String> {
    if let Some(snapshot) = state
        .latest
        .lock()
        .map_err(|_| "snapshot lock unavailable".to_string())?
        .clone()
    {
        return Ok(snapshot);
    }
    collect(&state)
}

#[tauri::command]
fn refresh_collector(state: State<'_, AppState>) -> Result<MonitorSnapshot, String> {
    collect(&state)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let storage = Storage::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                collector: Collector::default(),
                storage: Mutex::new(storage),
                latest: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![monitor_snapshot, refresh_collector])
        .run(tauri::generate_context!())
        .expect("failed to run Agent Monitor");
}
