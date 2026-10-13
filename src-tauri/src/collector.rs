use crate::domain::{ExecutionNode, ExecutionStatus, MonitorSnapshot, ObservedProcess, Reliability};
use chrono::{DateTime, Utc};
use std::{fs, path::PathBuf};
use sysinfo::{ProcessesToUpdate, System};

const RECOGNIZED_TOOLS: &[(&str, &str)] = &[
    ("codex", "Codex"),
    ("claude", "Claude Code"),
    ("opencode", "OpenCode"),
    ("gemini", "Gemini CLI"),
];

#[derive(Default)]
pub struct Collector;

impl Collector {
    pub fn collect(&self) -> MonitorSnapshot {
        let observed_at = Utc::now().to_rfc3339();
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let mut processes = Vec::new();
        let mut executions = Vec::new();
        for (pid, process) in system.processes() {
            let executable = process.name().to_string_lossy().to_lowercase();
            let command = process.cmd().iter().map(|part| part.to_string_lossy()).collect::<Vec<_>>().join(" ");
            let Some((_, tool)) = RECOGNIZED_TOOLS.iter().find(|(needle, _)| executable == *needle || command.to_lowercase().contains(needle)) else { continue };
            let process_id = format!("process:{}:{}", pid.as_u32(), process.start_time());
            let started_at = DateTime::from_timestamp(process.start_time() as i64, 0).unwrap_or_else(Utc::now).to_rfc3339();
            processes.push(ObservedProcess {
                id: process_id.clone(), pid: pid.as_u32(), tool: (*tool).into(), command,
                started_at: started_at.clone(), project_path: process.cwd().map(|path| path.display().to_string()),
                status: ExecutionStatus::Running, reliability: Reliability::Confirmed,
            });
            executions.push(ExecutionNode {
                id: format!("execution:{process_id}"), parent_id: None, process_id: Some(process_id),
                label: format!("{} process", tool), tool: (*tool).into(), model: None,
                status: ExecutionStatus::Running, started_at: Some(started_at), tokens: None,
                relationship: Reliability::Confirmed,
            });
        }

        // A local Codex session file is real evidence of a session artifact, but it does not
        // prove an active process, model, token count, or parent-child relationship.
        for path in codex_session_artifacts() {
            let id = format!("codex-session:{}", path.display());
            let modified = fs::metadata(&path).ok().and_then(|metadata| metadata.modified().ok())
                .map(DateTime::<Utc>::from).map(|time| time.to_rfc3339());
            executions.push(ExecutionNode {
                id, parent_id: None, process_id: None, label: "Codex local session artifact".into(),
                tool: "Codex".into(), model: None, status: ExecutionStatus::Unknown,
                started_at: modified, tokens: None, relationship: Reliability::Unavailable,
            });
        }

        MonitorSnapshot { observed_at, processes, executions, collector_error: None }
    }
}

fn codex_session_artifacts() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let archive = home.join(".codex").join("archived_sessions");
    let Ok(entries) = fs::read_dir(archive) else { return Vec::new() };
    entries.filter_map(Result::ok).map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
        .take(20).collect()
}
