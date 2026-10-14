//! Read-only session adapters. They extract only the model name, token counters and timestamps
//! from local transcript files. Message content is never kept, stored or returned.
use std::{
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde_json::Value;

/// Files above this size are skipped rather than streamed on every refresh.
const MAX_TRANSCRIPT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionUsage {
    pub model: Option<String>,
    /// Input including cached input.
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    /// Breakdown of `tokens_in` (a subset of it).
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    /// Breakdown of `tokens_out` (a subset of it).
    pub reasoning: Option<u64>,
    /// Provider id exactly as the tool records it; never guessed from the model name.
    pub provider: Option<String>,
    /// Reasoning effort / variant exactly as the tool records it.
    pub effort: Option<String>,
    /// Cost in USD as reported by the tool itself; this monitor never prices tokens.
    pub cost_usd: Option<f64>,
    pub started_at: Option<String>,
    pub last_event_at: Option<String>,
    pub session_id: Option<String>,
    /// Session that delegated to this one, exactly as the tool recorded it (Codex `parent_thread_id`).
    pub parent_session_id: Option<String>,
    /// Kind of subagent as the tool names it (a Codex role or subagent source); never derived from content.
    pub agent_kind: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TranscriptFile {
    pub path: PathBuf,
    pub modified: SystemTime,
    pub len: u64,
}

fn jsonl_files(dir: &Path) -> Vec<TranscriptFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<TranscriptFile> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            Some(TranscriptFile {
                path,
                modified: meta.modified().ok()?,
                len: meta.len(),
            })
        })
        .collect();
    files.sort_by_key(|file| std::cmp::Reverse(file.modified));
    files
}

/// Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>.
pub fn claude_project_dir(home: &Path, cwd: &Path) -> PathBuf {
    let encoded: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    home.join(".claude").join("projects").join(encoded)
}

pub fn claude_transcripts(cwd: &Path) -> Vec<TranscriptFile> {
    dirs::home_dir()
        .map(|home| jsonl_files(&claude_project_dir(&home, cwd)))
        .unwrap_or_default()
}

/// Rollout files under `~/.codex/sessions/<year>/<month>/<day>` modified since `cutoff`, newest first.
fn codex_rollout_files(cutoff: SystemTime) -> Vec<TranscriptFile> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let root = home.join(".codex").join("sessions");
    let mut out = Vec::new();
    for year in read_dirs(&root) {
        for month in read_dirs(&year) {
            for day in read_dirs(&month) {
                out.extend(jsonl_files(&day).into_iter().filter(|file| file.modified >= cutoff));
            }
        }
    }
    out.sort_by_key(|file| std::cmp::Reverse(file.modified));
    out
}

/// Codex rollout files whose session_meta cwd equals `cwd`, newest first. Only recent day folders are scanned.
pub fn codex_transcripts(cwd: &Path) -> Vec<TranscriptFile> {
    let cutoff = SystemTime::now() - std::time::Duration::from_secs(3 * 24 * 3600);
    codex_rollout_files(cutoff)
        .into_iter()
        .filter(|file| codex_cwd(&file.path).is_some_and(|c| Path::new(&c) == cwd))
        .collect()
}

/// A recently written Codex rollout and the working directory its own `session_meta` recorded.
#[derive(Clone)]
pub struct CodexRollout {
    pub file: TranscriptFile,
    pub cwd: Option<String>,
    /// Lives in `archived_sessions`: Codex itself archived it.
    pub archived: bool,
}

/// Rollouts written within `window`, from the live and the archived folders, newest first. Not tied to any process:
/// the Codex desktop app hosts many sessions behind one `app-server` process whose own cwd says nothing about them.
pub fn codex_recent_rollouts(window: std::time::Duration) -> Vec<CodexRollout> {
    let cutoff = SystemTime::now() - window;
    let mut files: Vec<(TranscriptFile, bool)> = codex_rollout_files(cutoff).into_iter().map(|f| (f, false)).collect();
    if let Some(home) = dirs::home_dir() {
        files.extend(
            jsonl_files(&home.join(".codex").join("archived_sessions"))
                .into_iter()
                .filter(|file| file.modified >= cutoff)
                .map(|f| (f, true)),
        );
    }
    files.sort_by_key(|(file, _)| std::cmp::Reverse(file.modified));
    files
        .into_iter()
        .map(|(file, archived)| CodexRollout {
            cwd: codex_cwd(&file.path),
            archived,
            file,
        })
        .collect()
}

/// A Claude Code session transcript and the working directory it recorded.
pub struct ClaudeSession {
    pub file: TranscriptFile,
    pub cwd: Option<String>,
}

/// Session transcripts written since `cutoff` under `<root>/<project>/<session>.jsonl`, newest first. The project
/// folder name is a lossy encoding of the path, so the working directory is read from the transcript itself.
fn claude_sessions_under(root: &Path, cutoff: SystemTime) -> Vec<ClaudeSession> {
    let mut out: Vec<ClaudeSession> = read_dirs(root)
        .iter()
        .flat_map(|dir| jsonl_files(dir))
        .filter(|file| file.modified >= cutoff)
        .map(|file| ClaudeSession {
            cwd: claude_cwd(&file.path),
            file,
        })
        .collect();
    out.sort_by_key(|session| std::cmp::Reverse(session.file.modified));
    out
}

/// Claude Code sessions written within `window`, whether or not a process still owns them.
pub fn claude_recent_sessions(window: std::time::Duration) -> Vec<ClaudeSession> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    claude_sessions_under(&home.join(".claude").join("projects"), SystemTime::now() - window)
}

/// The `cwd` of the first line that records one. Only that field is read; message content is ignored.
fn claude_cwd(path: &Path) -> Option<String> {
    BufReader::new(File::open(path).ok()?)
        .lines()
        .map_while(Result::ok)
        .take(200)
        .filter(|line| line.contains("\"cwd\""))
        .find_map(|line| {
            let v: Value = serde_json::from_str(&line).ok()?;
            v.get("cwd").and_then(Value::as_str).map(str::to_owned)
        })
}

/// A subagent transcript Claude Code wrote next to its parent session.
pub struct ClaudeSubagent {
    pub file: TranscriptFile,
    pub agent_id: String,
    /// Subagent type (`general-purpose`, `Explore`, ...).
    pub agent_type: Option<String>,
    /// The short task description Claude Code recorded for the subagent, shown as what it works on.
    pub description: Option<String>,
    /// 1 when the main session spawned it; deeper when another subagent did.
    pub depth: u64,
}

/// Subagents of a Claude Code session: `<project>/<session id>/subagents/agent-<id>.jsonl`, each with a
/// `.meta.json` sidecar. The directory is written by Claude Code itself, so membership is confirmed.
pub fn claude_subagents(session: &Path) -> Vec<ClaudeSubagent> {
    let dir = session.with_extension("").join("subagents");
    let mut out: Vec<ClaudeSubagent> = jsonl_files(&dir)
        .into_iter()
        .filter_map(|file| {
            let agent_id = file
                .path
                .file_stem()?
                .to_string_lossy()
                .strip_prefix("agent-")?
                .to_owned();
            let meta: Option<Value> = fs::read_to_string(file.path.with_extension("meta.json"))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok());
            let field = |key: &str| meta.as_ref().and_then(|m| m.get(key));
            Some(ClaudeSubagent {
                agent_type: field("agentType").and_then(Value::as_str).map(str::to_owned),
                description: field("description").and_then(Value::as_str).map(str::to_owned),
                depth: field("spawnDepth").and_then(Value::as_u64).unwrap_or(1),
                agent_id,
                file,
            })
        })
        .collect();
    out.sort_by_key(|sub| sub.file.modified);
    out
}

/// A Claude Code transcript by session id, wherever its project folder is. Used when the command line names the
/// session (`--resume <id>`), which identifies it without relying on the process working directory.
pub fn claude_transcript_by_id(id: &str) -> Option<TranscriptFile> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let projects = dirs::home_dir()?.join(".claude").join("projects");
    read_dirs(&projects).into_iter().find_map(|dir| {
        let path = dir.join(format!("{id}.jsonl"));
        let meta = fs::metadata(&path).ok()?;
        Some(TranscriptFile {
            path,
            modified: meta.modified().ok()?,
            len: meta.len(),
        })
    })
}

fn read_dirs(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .map(|e| {
            e.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

fn codex_cwd(path: &Path) -> Option<String> {
    let first = BufReader::new(File::open(path).ok()?).lines().next()?.ok()?;
    let v: Value = serde_json::from_str(&first).ok()?;
    v.pointer("/payload/cwd").and_then(Value::as_str).map(str::to_owned)
}

pub fn parse_claude(file: &TranscriptFile) -> Option<SessionUsage> {
    if file.len > MAX_TRANSCRIPT_BYTES {
        return None;
    }
    let reader = BufReader::new(File::open(&file.path).ok()?);
    let mut by_message: std::collections::HashMap<String, (u64, u64, u64, u64)> = std::collections::HashMap::new();
    let mut usage = SessionUsage {
        session_id: file.path.file_stem().map(|s| s.to_string_lossy().into_owned()),
        ..Default::default()
    };
    for line in reader.lines().map_while(Result::ok) {
        // Cheap prefilter so unrelated lines are never parsed.
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(message) = v.get("message") else { continue };
        if let Some(model) = message.get("model").and_then(Value::as_str) {
            if !model.starts_with('<') {
                usage.model = Some(model.to_owned());
            }
        }
        if let Some(u) = message.get("usage") {
            let n = |key: &str| u.get(key).and_then(Value::as_u64).unwrap_or(0);
            let input = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
            // The same API message can be logged once per content block; keep the latest counters per id.
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("line:{}", by_message.len()));
            by_message.insert(
                id,
                (
                    input,
                    n("output_tokens"),
                    n("cache_read_input_tokens"),
                    n("cache_creation_input_tokens"),
                ),
            );
        }
        if let Some(ts) = v.get("timestamp").and_then(Value::as_str) {
            usage.started_at.get_or_insert_with(|| ts.to_owned());
            usage.last_event_at = Some(ts.to_owned());
        }
    }
    if !by_message.is_empty() {
        usage.tokens_in = Some(by_message.values().map(|m| m.0).sum());
        usage.tokens_out = Some(by_message.values().map(|m| m.1).sum());
        usage.cache_read = Some(by_message.values().map(|m| m.2).sum());
        usage.cache_write = Some(by_message.values().map(|m| m.3).sum());
    }
    Some(usage)
}

/// How Codex labels a subagent session: its role, else the subagent source (`{"subagent":{"other":"guardian"}}`).
fn codex_agent_kind(session_meta: &Value) -> Option<String> {
    let text = |pointer: &str| session_meta.pointer(pointer).and_then(Value::as_str).map(str::to_owned);
    text("/payload/agent_role").or_else(|| {
        let subagent = session_meta.pointer("/payload/source/subagent")?;
        subagent
            .as_str()
            .map(str::to_owned)
            .or_else(|| subagent.get("other").and_then(Value::as_str).map(str::to_owned))
            .or_else(|| subagent.as_object().and_then(|o| o.keys().next().cloned()))
    })
}

pub fn parse_codex(file: &TranscriptFile) -> Option<SessionUsage> {
    if file.len > MAX_TRANSCRIPT_BYTES {
        return None;
    }
    let reader = BufReader::new(File::open(&file.path).ok()?);
    let mut usage = SessionUsage::default();
    for line in reader.lines().map_while(Result::ok) {
        let wants_meta = line.starts_with("{\"timestamp\"")
            && (line.contains("\"session_meta\"")
                || line.contains("\"turn_context\"")
                || line.contains("\"token_count\""));
        if !wants_meta {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let ts = v.get("timestamp").and_then(Value::as_str);
        match v.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                usage.session_id = v.pointer("/payload/id").and_then(Value::as_str).map(str::to_owned);
                usage.parent_session_id = v
                    .pointer("/payload/parent_thread_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                usage.agent_kind = codex_agent_kind(&v);
                usage.provider = v
                    .pointer("/payload/model_provider")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                usage.started_at = v
                    .pointer("/payload/timestamp")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or(ts.map(str::to_owned));
            }
            Some("turn_context") => {
                if let Some(m) = v.pointer("/payload/model").and_then(Value::as_str) {
                    usage.model = Some(m.to_owned());
                }
                if let Some(e) = v.pointer("/payload/effort").and_then(Value::as_str) {
                    usage.effort = Some(e.to_owned());
                }
            }
            Some("event_msg") if v.pointer("/payload/type").and_then(Value::as_str) == Some("token_count") => {
                if let Some(total) = v.pointer("/payload/info/total_token_usage") {
                    usage.tokens_in = total.get("input_tokens").and_then(Value::as_u64);
                    usage.tokens_out = total.get("output_tokens").and_then(Value::as_u64);
                    usage.cache_read = total.get("cached_input_tokens").and_then(Value::as_u64);
                    usage.cache_write = total.get("cache_write_input_tokens").and_then(Value::as_u64);
                    usage.reasoning = total.get("reasoning_output_tokens").and_then(Value::as_u64);
                }
            }
            _ => {}
        }
        if let Some(ts) = ts {
            usage.last_event_at = Some(ts.to_owned());
        }
    }
    Some(usage)
}

/// OpenCode keeps sessions in a SQLite database (WAL mode), not in transcript files.
pub fn opencode_db_path() -> Option<PathBuf> {
    let path = dirs::home_dir()?
        .join(".local")
        .join("share")
        .join("opencode")
        .join("opencode.db");
    path.is_file().then_some(path)
}

/// A root (non-subagent) OpenCode session of `cwd`, newest first, with its last update in epoch milliseconds.
pub struct OpencodeSession {
    pub id: String,
    pub directory: String,
    /// Delegating session, as recorded in the `parent_id` column. `None` for root sessions.
    pub parent_id: Option<String>,
    /// OpenCode archived the session (`time_archived` is set).
    pub archived: bool,
    /// Session title as OpenCode stores it (it summarizes the first prompt).
    pub title: Option<String>,
    pub updated_ms: u64,
    pub usage: SessionUsage,
}

/// Read-only: the database is opened with `SQLITE_OPEN_READ_ONLY`; only the model name, token counters and
/// timestamps are selected, never message or part content.
pub fn opencode_sessions(db: &Path, cwd: &Path, updated_since_ms: u64) -> Vec<OpencodeSession> {
    opencode_query(db, Some(cwd), updated_since_ms, false)
}

/// Sessions of every directory updated since `updated_since_ms`, subagent sessions included. An `opencode serve`
/// process hosts sessions of many projects, so its own working directory cannot be used to find them.
pub fn opencode_recent_sessions(db: &Path, updated_since_ms: u64) -> Vec<OpencodeSession> {
    opencode_query(db, None, updated_since_ms, true)
}

fn opencode_query(db: &Path, cwd: Option<&Path>, updated_since_ms: u64, with_children: bool) -> Vec<OpencodeSession> {
    use rusqlite::{Connection, OpenFlags};
    let Ok(conn) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
    else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
    // Older databases may lack the optional columns; each falls back to a constant instead of failing the query.
    let has_column = |name: &str| {
        conn.prepare("SELECT 1 FROM pragma_table_info('session') WHERE name = ?1")
            .and_then(|mut q| q.exists([name]))
            .unwrap_or(false)
    };
    let optional =
        |name: &str, expr: &'static str, fallback: &'static str| if has_column(name) { expr } else { fallback };
    let agent_column = optional("agent", "s.agent", "NULL");
    let archived_column = optional("time_archived", "s.time_archived IS NOT NULL", "0");
    let title_column = optional("title", "s.title", "NULL");
    let sql = format!(
        "SELECT s.id, s.directory, s.parent_id, s.time_created, s.time_updated, s.model, s.tokens_input, s.tokens_output, s.tokens_reasoning,
                s.tokens_cache_read, s.tokens_cache_write, s.cost,
                (SELECT json_extract(m.data, '$.modelID') || char(31) || coalesce(json_extract(m.data, '$.providerID'), '') FROM message m
                  WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
                  ORDER BY m.time_created DESC LIMIT 1),
                {agent_column},
                {archived_column},
                {title_column}
         FROM session s
         WHERE (?1 IS NULL OR s.directory = ?1) AND (?3 OR s.parent_id IS NULL) AND s.time_updated >= ?2
         ORDER BY s.time_updated DESC"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return Vec::new();
    };
    let rows = stmt.query_map(
        rusqlite::params![
            cwd.map(|c| c.to_string_lossy().into_owned()),
            updated_since_ms as i64,
            with_children
        ],
        |row| {
            let id: String = row.get(0)?;
            let directory: String = row.get(1)?;
            let parent_id: Option<String> = row.get(2)?;
            let created: i64 = row.get(3)?;
            let updated: i64 = row.get(4)?;
            let model_json: Option<String> = row.get(5)?;
            let n = |i: usize| row.get::<_, i64>(i).map(|v| v.max(0) as u64);
            let (input, output, reasoning, cache_read, cache_write) = (n(6)?, n(7)?, n(8)?, n(9)?, n(10)?);
            let cost: Option<f64> = row.get(11)?;
            let last: Option<String> = row.get(12)?;
            let agent: Option<String> = row.get(13)?;
            let archived: bool = row.get(14)?;
            let title: Option<String> = row.get(15)?;
            let (last_model, last_provider) = match last.as_deref().and_then(|l| l.split_once('\u{1f}')) {
                Some((m, p)) => (Some(m.to_owned()), Some(p.to_owned()).filter(|p| !p.is_empty())),
                None => (None, None),
            };
            let recorded = model_json.and_then(|json| serde_json::from_str::<Value>(&json).ok());
            let field = |key: &str| {
                recorded
                    .as_ref()
                    .and_then(|v| v.get(key))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            };
            let model = field("id").or(last_model);
            let provider = field("providerID").or(last_provider);
            let effort = field("variant");
            let any_tokens = input + output + reasoning + cache_read + cache_write > 0;
            let iso = |ms: i64| chrono::DateTime::from_timestamp_millis(ms).map(|t| t.to_rfc3339());
            Ok(OpencodeSession {
                id: id.clone(),
                directory,
                parent_id: parent_id.clone(),
                archived,
                title,
                updated_ms: updated.max(0) as u64,
                usage: SessionUsage {
                    model,
                    // Same convention as Claude Code: input includes cached input; output includes reasoning.
                    // A session with every counter at zero has not reported usage yet, so it stays unavailable.
                    tokens_in: any_tokens.then_some(input + cache_read + cache_write),
                    tokens_out: any_tokens.then_some(output + reasoning),
                    cache_read: any_tokens.then_some(cache_read),
                    cache_write: any_tokens.then_some(cache_write),
                    reasoning: any_tokens.then_some(reasoning),
                    provider,
                    effort,
                    cost_usd: cost.filter(|_| any_tokens),
                    started_at: iso(created),
                    last_event_at: iso(updated),
                    parent_session_id: parent_id.clone(),
                    agent_kind: agent.filter(|a| parent_id.is_some() && !a.is_empty()),
                    session_id: Some(id),
                },
            })
        },
    );
    rows.map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default()
}

/// True when `needle` occurs in the first `limit` bytes of the file. Orca puts the task and dispatch ids in the
/// worker's opening prompt, so a transcript that opens with the dispatch id belongs to that worker. Nothing from
/// the file is kept: the bytes are only searched.
pub fn opens_with(path: &Path, needle: &str, limit: u64) -> bool {
    use std::io::Read;
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut head = Vec::new();
    if file.take(limit).read_to_end(&mut head).is_err() {
        return false;
    }
    head.windows(needle.len()).any(|window| window == needle.as_bytes())
}

/// True when `needle` occurs anywhere in the file, streamed in chunks so a large transcript is never held in memory.
/// Used to find the session that issued an Orca run (its transcript mentions the run id). Only matched, never kept.
pub fn mentions(path: &Path, needle: &str) -> bool {
    use std::io::Read;
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let needle = needle.as_bytes();
    let mut buffer = vec![0u8; 1 << 20];
    let mut carried: Vec<u8> = Vec::new();
    loop {
        let Ok(read) = file.read(&mut buffer) else {
            return false;
        };
        if read == 0 {
            return false;
        }
        carried.extend_from_slice(&buffer[..read]);
        if carried.windows(needle.len()).any(|w| w == needle) {
            return true;
        }
        let keep = needle.len().saturating_sub(1).min(carried.len());
        carried.drain(..carried.len() - keep);
    }
}

/// Orca keeps its orchestration state (runs, tasks, worker dispatches) in a SQLite database of its own.
pub fn orca_db_path() -> Option<PathBuf> {
    let path = dirs::data_dir()?.join("orca").join("orchestration.db");
    path.is_file().then_some(path)
}

/// One worker run recorded by Orca. Only identifiers, state and timestamps: the task spec, objective, result and
/// message bodies hold prompt content and are never selected.
#[derive(Clone, Debug, PartialEq)]
pub struct OrcaDispatch {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    /// Dispatch whose worker created this one, set only for real delegation (see `orca_dispatches`).
    pub parent_dispatch_id: Option<String>,
    /// Parent of this dispatch's task in Orca's task tree (`worker-start --parent`). This is where a coordinator
    /// records orchestrator -> agent structure, because dispatched workers cannot start nested workers.
    pub parent_task_id: Option<String>,
    /// `pending`, `dispatched`, `completed`, `failed` or `circuit_broken`, as Orca records it.
    pub status: String,
    pub depth: u64,
    /// Directory of the worktree the worker ran in (`worker_dispatches.worktree_id` after the `::`).
    pub worktree_path: Option<String>,
    /// Agent Orca launched (`claude`, `codex`, ...), as `launch.effective.agent` records it.
    pub agent: Option<String>,
    /// Orca's own task title (`display_name`, else `task_title`). The task spec is never read.
    pub title: Option<String>,
    pub created_s: Option<i64>,
    pub completed_s: Option<i64>,
    pub heartbeat_s: Option<i64>,
}

/// Read-only: opened with `SQLITE_OPEN_READ_ONLY`. A dispatch counts as delegated by another worker only when its
/// `creator_dispatch_id` is set and the creator is not its own assignee (Orca documents that case as bookkeeping).
/// Active dispatches are always returned; finished ones only when created since `created_since_s`.
pub fn orca_dispatches(db: &Path, created_since_s: i64) -> Vec<OrcaDispatch> {
    use rusqlite::{Connection, OpenFlags};
    let Ok(conn) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
    else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
    let has_workers = conn
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worker_dispatches'")
        .and_then(|mut q| q.exists([]))
        .unwrap_or(false);
    let (worker_columns, worker_join) = if has_workers {
        (
            "w.worktree_id,
                coalesce(json_extract(w.start_options, '$.launch.effective.agent'), json_extract(w.start_options, '$.agent'))",
            "LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id",
        )
    } else {
        ("NULL, NULL", "")
    };
    let sql = format!(
        "SELECT d.id, d.run_id, d.task_id, d.creator_dispatch_id, d.creator_handle, d.assignee_handle, d.status, d.depth,
                CAST(strftime('%s', d.created_at) AS INTEGER),
                CAST(strftime('%s', d.completed_at) AS INTEGER),
                CAST(strftime('%s', d.last_heartbeat_at) AS INTEGER),
                coalesce(nullif(t.display_name, ''), nullif(t.task_title, '')),
                t.parent_id,
                {worker_columns}
         FROM dispatch_contexts d LEFT JOIN tasks t ON t.id = d.task_id {worker_join}
         WHERE d.status IN ('pending', 'dispatched') OR CAST(strftime('%s', d.created_at) AS INTEGER) >= ?1
         ORDER BY d.created_at"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return Vec::new();
    };
    let rows = stmt.query_map([created_since_s], |row| {
        let creator_dispatch: Option<String> = row.get(3)?;
        let creator: Option<String> = row.get(4)?;
        let assignee: Option<String> = row.get(5)?;
        let delegated = creator_dispatch.filter(|_| creator.is_some() && creator != assignee);
        Ok(OrcaDispatch {
            id: row.get(0)?,
            run_id: row.get(1)?,
            task_id: row.get(2)?,
            parent_dispatch_id: delegated,
            status: row.get(6)?,
            depth: row.get::<_, i64>(7)?.max(0) as u64,
            created_s: row.get(8)?,
            completed_s: row.get(9)?,
            heartbeat_s: row.get(10)?,
            title: row.get(11)?,
            parent_task_id: row.get(12)?,
            worktree_path: row
                .get::<_, Option<String>>(13)?
                .and_then(|id| id.split_once("::").map(|(_, path)| path.to_owned())),
            agent: row.get(14)?,
        })
    });
    rows.map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn opencode_reads_root_sessions_of_cwd_only() {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-opencode.db", std::process::id()));
        let _ = fs::remove_file(&path);
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, model TEXT, time_created INTEGER, time_updated INTEGER,
                   tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, cost REAL);
                 CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
                 INSERT INTO session VALUES ('a', NULL, '/x', '{\"id\":\"m1\",\"providerID\":\"p\",\"variant\":\"high\"}', 1000, 2000, 10, 4, 1, 100, 5, 0.25);
                 INSERT INTO session VALUES ('sub', 'a', '/x', NULL, 1000, 2000, 99, 99, 0, 0, 0, 0.0);
                 INSERT INTO session VALUES ('other', NULL, '/y', NULL, 1000, 2000, 99, 99, 0, 0, 0, 0.0);
                 INSERT INTO session VALUES ('empty', NULL, '/x', NULL, 1000, 1500, 0, 0, 0, 0, 0, 0.0);
                 INSERT INTO message VALUES ('1', 'empty', 1, '{\"role\":\"assistant\",\"modelID\":\"fallback\"}');",
            ).unwrap();
        }
        let found = opencode_sessions(&path, Path::new("/x"), 0);
        assert_eq!(found.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["a", "empty"]);
        assert_eq!(
            (
                found[0].usage.model.as_deref(),
                found[0].usage.tokens_in,
                found[0].usage.tokens_out
            ),
            (Some("m1"), Some(115), Some(5))
        );
        assert_eq!(
            (
                found[0].usage.provider.as_deref(),
                found[0].usage.cache_read,
                found[0].usage.reasoning
            ),
            (Some("p"), Some(100), Some(1))
        );
        assert_eq!(found[0].usage.cost_usd, Some(0.25));
        assert_eq!(found[0].usage.effort.as_deref(), Some("high"));
        assert_eq!(
            (
                found[1].usage.model.as_deref(),
                found[1].usage.tokens_in,
                found[1].usage.tokens_out
            ),
            (Some("fallback"), None, None)
        );
        assert!(opencode_sessions(&path, Path::new("/x"), 1800).len() == 1);
        // Without a directory every project's root sessions are listed, each with its own directory.
        let all = opencode_recent_sessions(&path, 0);
        let mut dirs: Vec<_> = all.iter().map(|s| (s.id.as_str(), s.directory.as_str())).collect();
        dirs.sort();
        assert_eq!(dirs, [("a", "/x"), ("empty", "/x"), ("other", "/y"), ("sub", "/x")]);
        let sub = all.iter().find(|s| s.id == "sub").unwrap();
        assert_eq!(sub.parent_id.as_deref(), Some("a"));
        assert!(all.iter().find(|s| s.id == "a").unwrap().parent_id.is_none());
        let _ = fs::remove_file(&path);
    }

    fn temp(name: &str, body: &str) -> TranscriptFile {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-{name}.jsonl", std::process::id()));
        File::create(&path).unwrap().write_all(body.as_bytes()).unwrap();
        let meta = fs::metadata(&path).unwrap();
        TranscriptFile {
            path,
            modified: meta.modified().unwrap(),
            len: meta.len(),
        }
    }

    #[test]
    fn claude_dedupes_blocks_of_one_message_and_ignores_content() {
        let line = |id: &str, out: u64| {
            format!(
            "{{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:0{out}Z\",\"message\":{{\"id\":\"{id}\",\"model\":\"claude-sonnet-5-5\",\"content\":[{{\"text\":\"SECRET\"}}],\"usage\":{{\"input_tokens\":2,\"cache_creation_input_tokens\":10,\"cache_read_input_tokens\":20,\"output_tokens\":{out}}}}}}}\n")
        };
        let f = temp("claude", &(line("a", 5) + &line("a", 5) + &line("b", 7)));
        let u = parse_claude(&f).unwrap();
        assert_eq!(u.model.as_deref(), Some("claude-sonnet-5-5"));
        assert_eq!(u.tokens_in, Some(64)); // two messages x (2 + 10 + 20)
        assert_eq!(u.tokens_out, Some(12));
        assert_eq!(
            (u.cache_read, u.cache_write, u.reasoning, u.provider),
            (Some(40), Some(20), None, None)
        );
        let _ = fs::remove_file(&f.path);
    }

    #[test]
    fn missing_usage_stays_none_not_zero() {
        let f = temp("empty", "{\"type\":\"user\"}\n");
        let u = parse_claude(&f).unwrap();
        assert_eq!((u.model, u.tokens_in, u.tokens_out), (None, None, None));
        let _ = fs::remove_file(&f.path);
    }

    #[test]
    fn codex_takes_last_cumulative_counter_and_last_model() {
        let body = "{\"timestamp\":\"t0\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"cwd\":\"/x\",\"model_provider\":\"openai\"}}\n\
{\"timestamp\":\"t1\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-a\",\"effort\":\"xhigh\"}}\n\
{\"timestamp\":\"t2\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"output_tokens\":1}}}}\n\
{\"timestamp\":\"t3\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":30,\"cached_input_tokens\":20,\"output_tokens\":4,\"reasoning_output_tokens\":3}}}}\n";
        let u = parse_codex(&temp("codex", body)).unwrap();
        assert_eq!(
            (u.model.as_deref(), u.tokens_in, u.tokens_out),
            (Some("gpt-a"), Some(30), Some(4))
        );
        assert_eq!(
            (u.provider.as_deref(), u.cache_read, u.reasoning),
            (Some("openai"), Some(20), Some(3))
        );
        assert_eq!(u.effort.as_deref(), Some("xhigh"));
    }

    #[test]
    fn claude_project_dir_encoding() {
        let d = claude_project_dir(Path::new("/h"), Path::new("/Users/a/Desktop/MAC/AGENT-MONITOR"));
        assert!(d.ends_with("-Users-a-Desktop-MAC-AGENT-MONITOR"));
    }

    #[test]
    fn claude_skips_malformed_lines() {
        let good = "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{\"id\":\"a\",\"model\":\"claude-x\",\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}}\n";
        let f = temp("claude-malformed", &format!("not json\n{{broken\n{good}\n"));
        let u = parse_claude(&f).unwrap();
        assert_eq!(
            (u.model.as_deref(), u.tokens_in, u.tokens_out),
            (Some("claude-x"), Some(3), Some(4))
        );
        let _ = fs::remove_file(&f.path);
    }

    #[test]
    fn oversized_transcripts_are_not_parsed() {
        let mut f = temp("oversized", "{}\n");
        f.len = MAX_TRANSCRIPT_BYTES + 1;
        assert!(parse_claude(&f).is_none());
        assert!(parse_codex(&f).is_none());
        let _ = fs::remove_file(&f.path);
    }

    #[test]
    fn codex_without_token_count_keeps_counters_unavailable() {
        let body = "{\"timestamp\":\"t0\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s2\",\"cwd\":\"/x\"}}\n";
        let u = parse_codex(&temp("codex-nocount", body)).unwrap();
        assert_eq!(
            (u.tokens_in, u.tokens_out, u.cache_read, u.reasoning),
            (None, None, None, None)
        );
        assert_eq!(u.session_id.as_deref(), Some("s2"));
    }

    #[test]
    fn codex_cwd_reads_first_line_only() {
        let f = temp(
            "codex-cwd",
            "{\"payload\":{\"cwd\":\"/first\"}}\n{\"payload\":{\"cwd\":\"/second\"}}\n",
        );
        assert_eq!(codex_cwd(&f.path).as_deref(), Some("/first"));
        let bad = temp("codex-cwd-bad", "garbage\n");
        assert_eq!(codex_cwd(&bad.path), None);
        assert_eq!(codex_cwd(Path::new("/definitely/missing.jsonl")), None);
        let _ = fs::remove_file(&f.path);
        let _ = fs::remove_file(&bad.path);
    }

    #[test]
    fn jsonl_files_lists_only_jsonl_and_tolerates_missing_dir() {
        let dir = std::env::temp_dir().join(format!("agent-monitor-{}-jsonl-dir", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.jsonl"), "{}").unwrap();
        fs::write(dir.join("b.txt"), "x").unwrap();
        let names: Vec<_> = jsonl_files(&dir)
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.jsonl"]);
        assert!(jsonl_files(&dir.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn opencode_missing_or_invalid_db_yields_no_sessions() {
        assert!(opencode_sessions(Path::new("/definitely/missing.db"), Path::new("/x"), 0).is_empty());
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-invalid.db", std::process::id()));
        fs::write(&path, "not a database").unwrap();
        assert!(opencode_sessions(&path, Path::new("/x"), 0).is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn codex_records_the_delegating_session_and_agent_kind() {
        let body = "{\"timestamp\":\"t0\",\"type\":\"session_meta\",\"payload\":{\"id\":\"child\",\"parent_thread_id\":\"parent\",\"cwd\":\"/x\",\"source\":{\"subagent\":{\"other\":\"guardian\"}}}}\n";
        let u = parse_codex(&temp("codex-child", body)).unwrap();
        assert_eq!(u.session_id.as_deref(), Some("child"));
        assert_eq!(u.parent_session_id.as_deref(), Some("parent"));
        assert_eq!(u.agent_kind.as_deref(), Some("guardian"));
        let root =
            "{\"timestamp\":\"t0\",\"type\":\"session_meta\",\"payload\":{\"id\":\"root\",\"source\":\"vscode\"}}\n";
        let u = parse_codex(&temp("codex-root", root)).unwrap();
        assert_eq!((u.parent_session_id, u.agent_kind), (None, None));
    }

    #[test]
    fn claude_subagents_come_from_the_session_subagents_folder() {
        let base = std::env::temp_dir().join(format!("agent-monitor-{}-subagents", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let dir = base.join("proj").join("sess").join("subagents");
        fs::create_dir_all(&dir).unwrap();
        let session = base.join("proj").join("sess.jsonl");
        fs::write(&session, "{}").unwrap();
        fs::write(dir.join("agent-a1.jsonl"), "{}").unwrap();
        fs::write(
            dir.join("agent-a1.meta.json"),
            "{\"agentType\":\"Explore\",\"description\":\"SECRET TASK\",\"spawnDepth\":2}",
        )
        .unwrap();
        fs::write(dir.join("agent-a2.jsonl"), "{}").unwrap(); // no sidecar
        fs::write(dir.join("notes.jsonl"), "{}").unwrap(); // not an agent file
        let mut subs = claude_subagents(&session);
        subs.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
        assert_eq!(
            subs.iter().map(|s| s.agent_id.as_str()).collect::<Vec<_>>(),
            ["a1", "a2"]
        );
        assert_eq!((subs[0].agent_type.as_deref(), subs[0].depth), (Some("Explore"), 2));
        assert_eq!((subs[1].agent_type.as_deref(), subs[1].depth), (None, 1));
        assert!(claude_subagents(&base.join("proj").join("none.jsonl")).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn orca_delegation_requires_a_creator_that_is_not_the_assignee() {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-orca.db", std::process::id()));
        let _ = fs::remove_file(&path);
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE dispatch_contexts (id TEXT, run_id TEXT, task_id TEXT, creator_dispatch_id TEXT, creator_handle TEXT,
                   assignee_handle TEXT, status TEXT, depth INTEGER, created_at TEXT, completed_at TEXT, last_heartbeat_at TEXT);
                 CREATE TABLE tasks (id TEXT, display_name TEXT, task_title TEXT, parent_id TEXT);
                 CREATE TABLE worker_dispatches (dispatch_id TEXT, worktree_id TEXT, start_options TEXT);
                 INSERT INTO worker_dispatches VALUES ('root', 'repo1::/Users/a/work/app', '{\"launch\":{\"effective\":{\"agent\":\"claude\"}}}'),
                   ('kid', 'repo1::/Users/a/work/app', '{\"agent\":\"codex\"}');
                 INSERT INTO tasks VALUES ('t1', '', 'Map the repo', NULL), ('t2', 'Count tests', 'ignored when a display name exists', 't1');
                 INSERT INTO dispatch_contexts VALUES ('root', 'r', 't1', NULL, NULL, 'h1', 'dispatched', 1, '2026-10-14 10:00:00', NULL, '2026-10-14 10:05:00');
                 INSERT INTO dispatch_contexts VALUES ('kid', 'r', 't2', 'root', 'h1', 'h2', 'completed', 2, '2026-10-14 10:01:00', '2026-10-14 10:04:00', NULL);
                 INSERT INTO dispatch_contexts VALUES ('self', 'r', 't3', 'root', 'h3', 'h3', 'completed', 2, '2026-10-14 10:02:00', NULL, NULL);
                 INSERT INTO dispatch_contexts VALUES ('old', 'r', 't4', NULL, NULL, 'h4', 'completed', 1, '2020-01-01 00:00:00', NULL, NULL);",
            )
            .unwrap();
        }
        let got = orca_dispatches(&path, 1_700_000_000);
        let find = |id: &str| got.iter().find(|d| d.id == id).unwrap();
        assert_eq!(
            got.len(),
            3,
            "finished dispatches before the cutoff are dropped, active ones kept"
        );
        assert_eq!(find("root").parent_dispatch_id, None);
        assert_eq!(find("kid").parent_dispatch_id.as_deref(), Some("root"));
        assert_eq!(
            find("self").parent_dispatch_id,
            None,
            "creator == assignee is bookkeeping, not delegation"
        );
        assert_eq!(find("kid").depth, 2);
        assert_eq!(find("kid").parent_task_id.as_deref(), Some("t1"));
        assert_eq!(find("root").worktree_path.as_deref(), Some("/Users/a/work/app"));
        assert_eq!(
            (find("root").agent.as_deref(), find("kid").agent.as_deref()),
            (Some("claude"), Some("codex"))
        );
        assert_eq!(
            (find("self").worktree_path.clone(), find("self").agent.clone()),
            (None, None)
        );
        assert_eq!(find("root").parent_task_id, None);
        assert_eq!(find("root").title.as_deref(), Some("Map the repo"));
        assert_eq!(find("kid").title.as_deref(), Some("Count tests"));
        assert_eq!(
            find("self").title,
            None,
            "a dispatch whose task row is missing has no title"
        );
        assert!(find("root").heartbeat_s.is_some() && find("kid").completed_s.is_some());
        assert!(orca_dispatches(Path::new("/definitely/missing.db"), 0).is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn opencode_archived_sessions_are_flagged_only_when_the_tool_archived_them() {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-archived.db", std::process::id()));
        let _ = fs::remove_file(&path);
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, model TEXT, time_created INTEGER, time_updated INTEGER,
                   tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER,
                   cost REAL, time_archived INTEGER, title TEXT);
                 CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
                 INSERT INTO session VALUES ('live', NULL, '/x', NULL, 1, 2, 0, 0, 0, 0, 0, 0.0, NULL, 'Refactor the parser');
                 INSERT INTO session VALUES ('shelved', NULL, '/x', NULL, 1, 2, 0, 0, 0, 0, 0, 0.0, 99, 'New session - 2026-10-14');",
            )
            .unwrap();
        }
        let found = opencode_recent_sessions(&path, 0);
        let archived = |id: &str| found.iter().find(|s| s.id == id).unwrap().archived;
        assert!(!archived("live") && archived("shelved"));
        let title = |id: &str| found.iter().find(|s| s.id == id).unwrap().title.clone();
        assert_eq!(title("live").as_deref(), Some("Refactor the parser"));
        assert_eq!(
            title("shelved").as_deref(),
            Some("New session - 2026-10-14"),
            "raw here; the collector filters placeholders"
        );
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn claude_sessions_come_with_their_own_working_directory() {
        let root = std::env::temp_dir().join(format!("agent-monitor-{}-claude-root", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let proj = root.join("-Users-a-work-app");
        fs::create_dir_all(proj.join("s1").join("subagents")).unwrap();
        fs::write(
            proj.join("s1.jsonl"),
            "{\"type\":\"summary\"}\n{\"type\":\"user\",\"cwd\":\"/Users/a/work-app\",\"message\":\"SECRET\"}\n",
        )
        .unwrap();
        fs::write(proj.join("s2.jsonl"), "{\"type\":\"user\"}\n").unwrap(); // no cwd recorded
        fs::write(proj.join("notes.txt"), "x").unwrap();
        let mut found = claude_sessions_under(&root, SystemTime::now() - std::time::Duration::from_secs(60));
        found.sort_by(|a, b| a.file.path.cmp(&b.file.path));
        assert_eq!(
            found.len(),
            2,
            "only transcripts, not other files or the subagents folder"
        );
        assert_eq!(found[0].cwd.as_deref(), Some("/Users/a/work-app"));
        assert_eq!(
            found[1].cwd, None,
            "a missing cwd stays unknown rather than being decoded from the folder name"
        );
        assert!(claude_sessions_under(&root, SystemTime::now() + std::time::Duration::from_secs(60)).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_transcript_belongs_to_a_worker_only_when_it_opens_with_the_dispatch_id() {
        let opening = temp("opens", "{\"msg\":\"preamble ctx_abc123 do the task\"}\n");
        assert!(opens_with(&opening.path, "ctx_abc123", 4096));
        assert!(!opens_with(&opening.path, "ctx_other", 4096));
        // The coordinator's transcript mentions the id too, but only after a long unrelated prefix.
        let later = temp("later", &format!("{}ctx_abc123\n", "x".repeat(8192)));
        assert!(
            !opens_with(&later.path, "ctx_abc123", 4096),
            "an id past the opening bytes does not count"
        );
        assert!(!opens_with(Path::new("/definitely/missing.jsonl"), "ctx_abc123", 4096));
        let _ = fs::remove_file(&opening.path);
        let _ = fs::remove_file(&later.path);
    }

    #[test]
    fn mentions_finds_an_id_anywhere_including_across_chunk_boundaries() {
        let near = temp("mention-near", "{\"m\":\"run_abc\"}\n");
        assert!(mentions(&near.path, "run_abc"));
        assert!(!mentions(&near.path, "run_zzz"));
        // Place the needle so it straddles the 1 MiB read boundary.
        let mut body = "x".repeat((1 << 20) - 3);
        body.push_str("run_abc");
        body.push_str(&"y".repeat(100));
        let straddling = temp("mention-straddle", &body);
        assert!(mentions(&straddling.path, "run_abc"));
        assert!(!mentions(Path::new("/definitely/missing.jsonl"), "run_abc"));
        let _ = fs::remove_file(&near.path);
        let _ = fs::remove_file(&straddling.path);
    }
}
