use crate::adapters::{self, SessionUsage, TranscriptFile};
use crate::domain::{ExecutionNode, ExecutionStatus, MonitorSnapshot, UsageDetail, ObservedProcess, Reliability};
use chrono::{DateTime, Utc};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use sysinfo::{ProcessesToUpdate, System};

const RECOGNIZED_TOOLS: &[(&str, &str)] = &[
    ("codex", "Codex"),
    ("claude", "Claude Code"),
    ("opencode", "OpenCode"),
    ("gemini", "Gemini CLI"),
];

/// A session with no transcript writes for this long is reported as idle, not running.
const IDLE_AFTER: Duration = Duration::from_secs(120);
/// A transcript last written before the process started cannot belong to it.
const START_SLACK: Duration = Duration::from_secs(5);
const LAUNCHERS: &[&str] = &["node", "bun", "deno", "python", "python3", "npx"];

type UsageCache = HashMap<PathBuf, (SystemTime, u64, SessionUsage)>;

#[derive(Default)]
pub struct Collector {
    cache: Mutex<UsageCache>,
}

fn base_name(value: &str) -> String {
    // Case-sensitive on purpose: CLIs are lowercase, desktop apps ("Claude", "Codex") are capitalized.
    let name = Path::new(value).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    name.trim_end_matches(".exe").trim_end_matches(".js").trim_end_matches(".mjs").to_owned()
}

/// Identify an agent CLI by executable (or the script a launcher runs), never by substring of the full
/// command line. Substring matching also caught every Electron helper of desktop apps.
pub fn recognize(executable: &str, cmd: &[String]) -> Option<&'static str> {
    if cmd.iter().any(|part| part.starts_with("--type=")) || executable.to_lowercase().contains("helper") { return None; }
    let mut candidates = vec![base_name(executable)];
    if let Some(first) = cmd.first() {
        let first_name = base_name(first);
        if LAUNCHERS.contains(&first_name.as_str()) {
            if let Some(script) = cmd.iter().skip(1).find(|part| !part.starts_with('-')) { candidates.push(base_name(script)); }
        } else {
            candidates.push(first_name);
        }
    }
    RECOGNIZED_TOOLS.iter().find(|(needle, _)| candidates.iter().any(|c| c == needle)).map(|(_, tool)| *tool)
}

struct Seen {
    pid: u32,
    tool: &'static str,
    start: u64,
    cwd: Option<PathBuf>,
    command: String,
}

impl Collector {
    pub fn collect(&self) -> MonitorSnapshot {
        let observed_at = Utc::now().to_rfc3339();
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let mut seen = Vec::new();
        for (pid, process) in system.processes() {
            let executable = process.name().to_string_lossy().into_owned();
            let cmd: Vec<String> = process.cmd().iter().map(|part| part.to_string_lossy().into_owned()).collect();
            let Some(tool) = recognize(&executable, &cmd) else { continue };
            seen.push(Seen { pid: pid.as_u32(), tool, start: process.start_time(), cwd: process.cwd().map(Path::to_path_buf), command: cmd.join(" ") });
        }
        // Newest process first so transcripts are assigned to at most one process each.
        seen.sort_by(|a, b| b.start.cmp(&a.start));
        let mut claimed: Vec<PathBuf> = Vec::new();

        let mut processes = Vec::new();
        let mut executions = Vec::new();
        for item in &seen {
            let process_id = format!("process:{}:{}", item.pid, item.start);
            let started_at = DateTime::from_timestamp(item.start as i64, 0).unwrap_or_else(Utc::now).to_rfc3339();
            let linked = item.cwd.as_deref().and_then(|cwd| self.link_usage(item, cwd, &mut claimed));
            processes.push(ObservedProcess {
                id: process_id.clone(), pid: item.pid, tool: item.tool.into(), command: item.command.clone(), started_at: started_at.clone(),
                project_path: item.cwd.as_ref().map(|path| path.display().to_string()),
                status: ExecutionStatus::Running, reliability: Reliability::Confirmed,
            });
            let label = item.cwd.as_deref().and_then(Path::file_name).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| format!("{} process", item.tool));
            let mut node = ExecutionNode {
                id: format!("execution:{process_id}"), parent_id: None, process_id: Some(process_id), label, tool: item.tool.into(), model: None,
                status: ExecutionStatus::Running, started_at: Some(started_at), tokens: None, relationship: Reliability::Confirmed,
                model_reliability: Reliability::Unavailable, tokens_in: None, tokens_out: None, usage_reliability: Reliability::Unavailable,
                usage_source: None, detail: UsageDetail::default(), last_activity_at: None,
            };
            if let Some((usage, reliability, source, modified)) = linked {
                apply_usage(&mut node, &usage, reliability, source);
                node.last_activity_at = Some(DateTime::<Utc>::from(modified).to_rfc3339());
                if SystemTime::now().duration_since(modified).is_ok_and(|age| age > IDLE_AFTER) { node.status = ExecutionStatus::Idle; }
            }
            executions.push(node);
        }

        // A local Codex session file is exact evidence for that file, so its counters are confirmed for the artifact.
        // It does not prove an active process or a parent-child relationship.
        for path in codex_session_artifacts() {
            let id = format!("codex-session:{}", path.display());
            let meta = fs::metadata(&path).ok();
            let modified = meta.as_ref().and_then(|m| m.modified().ok());
            let usage = meta.as_ref().zip(modified).and_then(|(m, modified)| self.cached(&path, modified, m.len(), adapters::parse_codex));
            let mut node = ExecutionNode {
                id, parent_id: None, process_id: None, label: "Codex local session artifact".into(), tool: "Codex".into(), model: None,
                status: ExecutionStatus::Unknown, started_at: modified.map(DateTime::<Utc>::from).map(|time| time.to_rfc3339()), tokens: None,
                relationship: Reliability::Unavailable, model_reliability: Reliability::Unavailable, tokens_in: None, tokens_out: None,
                usage_reliability: Reliability::Unavailable, usage_source: None, detail: UsageDetail::default(), last_activity_at: None,
            };
            if let Some(usage) = usage {
                apply_usage(&mut node, &usage, Reliability::Confirmed, "Codex rollout file".into());
                node.started_at = usage.started_at.clone().or(node.started_at);
                node.last_activity_at = usage.last_event_at;
            }
            executions.push(node);
        }

        MonitorSnapshot { observed_at, processes, executions, collector_error: None }
    }

    fn cached(&self, path: &Path, modified: SystemTime, len: u64, parse: impl Fn(&TranscriptFile) -> Option<SessionUsage>) -> Option<SessionUsage> {
        if let Ok(cache) = self.cache.lock() {
            if let Some((m, l, usage)) = cache.get(path) { if *m == modified && *l == len { return Some(usage.clone()); } }
        }
        let usage = parse(&TranscriptFile { path: path.to_path_buf(), modified, len })?;
        if let Ok(mut cache) = self.cache.lock() { cache.insert(path.to_path_buf(), (modified, len, usage.clone())); }
        Some(usage)
    }

    /// Pair a process with the newest unclaimed transcript of the same tool and working directory.
    /// Confirmed only when the command line names the session id; otherwise the pairing is inferred.
    fn link_usage(&self, item: &Seen, cwd: &Path, claimed: &mut Vec<PathBuf>) -> Option<(SessionUsage, Reliability, String, SystemTime)> {
        if item.tool == "OpenCode" { return self.link_opencode(item, cwd, claimed); }
        let (candidates, parse, source): (Vec<TranscriptFile>, fn(&TranscriptFile) -> Option<SessionUsage>, &str) = match item.tool {
            "Claude Code" => (adapters::claude_transcripts(cwd), adapters::parse_claude, "Claude Code transcript"),
            "Codex" => (adapters::codex_transcripts(cwd), adapters::parse_codex, "Codex rollout file"),
            _ => return None,
        };
        let floor = SystemTime::UNIX_EPOCH + Duration::from_secs(item.start.saturating_sub(START_SLACK.as_secs()));
        let file = candidates.into_iter().find(|f| f.modified >= floor && !claimed.contains(&f.path))?;
        claimed.push(file.path.clone());
        let usage = self.cached(&file.path, file.modified, file.len, parse)?;
        let named = usage.session_id.as_deref().is_some_and(|id| item.command.contains(id));
        let (reliability, how) = if named { (Reliability::Confirmed, "session id in command") } else { (Reliability::Inferred, "matched by working directory") };
        Some((usage, reliability, format!("{source} ({how})"), file.modified))
    }

    /// OpenCode stores sessions in SQLite. The pairing rules match the transcript adapters: same working
    /// directory, updated after the process started, one session per process, confirmed only by session id.
    fn link_opencode(&self, item: &Seen, cwd: &Path, claimed: &mut Vec<PathBuf>) -> Option<(SessionUsage, Reliability, String, SystemTime)> {
        let db = adapters::opencode_db_path()?;
        let floor_ms = item.start.saturating_sub(START_SLACK.as_secs()) * 1000;
        let session = adapters::opencode_sessions(&db, cwd, floor_ms).into_iter().find(|s| !claimed.contains(&PathBuf::from(format!("opencode:{}", s.id))))?;
        claimed.push(PathBuf::from(format!("opencode:{}", session.id)));
        let named = item.command.contains(&session.id);
        let (reliability, how) = if named { (Reliability::Confirmed, "session id in command") } else { (Reliability::Inferred, "matched by working directory") };
        let modified = SystemTime::UNIX_EPOCH + Duration::from_millis(session.updated_ms);
        Some((session.usage, reliability, format!("OpenCode database ({how})"), modified))
    }
}

fn apply_usage(node: &mut ExecutionNode, usage: &SessionUsage, reliability: Reliability, source: String) {
    if let Some(model) = &usage.model {
        node.model = Some(model.clone());
        node.model_reliability = reliability.clone();
    }
    if usage.tokens_in.is_some() || usage.tokens_out.is_some() {
        node.tokens_in = usage.tokens_in;
        node.tokens_out = usage.tokens_out;
        node.tokens = Some(usage.tokens_in.unwrap_or(0) + usage.tokens_out.unwrap_or(0));
        node.usage_reliability = reliability;
        node.detail = UsageDetail {
            provider: usage.provider.clone(), effort: usage.effort.clone(), cache_read_tokens: usage.cache_read, cache_write_tokens: usage.cache_write,
            reasoning_tokens: usage.reasoning, cost_usd: usage.cost_usd,
        };
    }
    node.usage_source = Some(source);
}

fn codex_session_artifacts() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let archive = home.join(".codex").join("archived_sessions");
    let Ok(entries) = fs::read_dir(archive) else { return Vec::new() };
    entries.filter_map(Result::ok).map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
        .take(20).collect()
}

#[cfg(test)]
mod tests {
    use super::recognize;

    fn cmd(parts: &[&str]) -> Vec<String> { parts.iter().map(|p| p.to_string()).collect() }

    #[test]
    fn recognizes_cli_binaries_and_launcher_scripts() {
        assert_eq!(recognize("claude", &cmd(&["/Users/a/.local/bin/claude", "--resume"])), Some("Claude Code"));
        assert_eq!(recognize("node", &cmd(&["node", "/opt/lib/node_modules/@google/gemini-cli/bin/gemini.js"])), Some("Gemini CLI"));
        assert_eq!(recognize("opencode.exe", &cmd(&["/opt/x/opencode.exe", "serve"])), Some("OpenCode"));
    }

    #[test]
    fn ignores_desktop_app_helpers_and_unrelated_paths() {
        assert_eq!(recognize("Claude Helper", &cmd(&["/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper", "--type=gpu-process"])), None);
        assert_eq!(recognize("Claude", &cmd(&["/Applications/Claude.app/Contents/MacOS/Claude"])), None);
        assert_eq!(recognize("zsh", &cmd(&["/bin/zsh", "-c", "source /Users/a/.claude/shell-snapshots/x.sh"])), None);
        assert_eq!(recognize("chrome-native-host", &cmd(&["/Applications/Claude.app/Contents/Helpers/chrome-native-host", "chrome-extension://x"])), None);
    }

    /// Manual smoke test against this machine: `cargo test live_snapshot -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_snapshot() {
        let snapshot = super::Collector::default().collect();
        for e in &snapshot.executions {
            println!("{:<12} {:<28} model={:?}({:?}) in={:?} out={:?} usage={:?} src={:?}", e.tool, e.label, e.model, e.model_reliability, e.tokens_in, e.tokens_out, e.usage_reliability, e.usage_source);
        }
        if let Ok(path) = std::env::var("AM_DUMP") {
            let mut value = serde_json::to_value(&snapshot).expect("serialize");
            value["processes"] = serde_json::json!([]); // never dump command lines
            std::fs::write(path, value.to_string()).expect("write dump");
        }
    }
}
