use crate::adapters::{self, ClaudeSession, CodexRollout, OrcaDispatch, SessionUsage, TranscriptFile};
use crate::domain::{
    clean_task, ExecutionNode, ExecutionRole, ExecutionStatus, MonitorSnapshot, ObservedProcess, Reliability,
    UsageDetail,
};
use chrono::{DateTime, Utc};
use std::{
    collections::HashMap,
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
/// Without a live process, a session whose file was written this recently is treated as idle if its host is alive.
const ACTIVE_WINDOW: Duration = Duration::from_secs(30 * 60);
/// How far back sessions that no process owns are listed.
const SESSION_WINDOW: Duration = Duration::from_secs(24 * 3600);
/// Upper bound per tool so a busy machine cannot flood the list.
const MAX_PASSIVE_SESSIONS: usize = 30;
/// Subcommands that are safe to show; every other positional argument may be a prompt and is dropped.
const SAFE_SUBCOMMANDS: &[&str] = &[
    "serve",
    "app-server",
    "exec-server",
    "mcp-server",
    "exec",
    "resume",
    "run",
    "review",
];
/// A dispatched Orca worker with no heartbeat for this long is shown as idle, not running.
const ORCA_STALE: Duration = Duration::from_secs(10 * 60);
const LAUNCHERS: &[&str] = &["node", "bun", "deno", "python", "python3", "npx"];

type UsageCache = HashMap<PathBuf, (SystemTime, u64, SessionUsage)>;

#[derive(Default)]
pub struct Collector {
    cache: Mutex<UsageCache>,
}

fn base_name(value: &str) -> String {
    // Case-sensitive on purpose: CLIs are lowercase, desktop apps ("Claude", "Codex") are capitalized.
    let name = Path::new(value)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    name.trim_end_matches(".exe")
        .trim_end_matches(".js")
        .trim_end_matches(".mjs")
        .to_owned()
}

/// Identify an agent CLI by executable (or the script a launcher runs), never by substring of the full
/// command line. Substring matching also caught every Electron helper of desktop apps.
pub fn recognize(executable: &str, cmd: &[String]) -> Option<&'static str> {
    if cmd.iter().any(|part| part.starts_with("--type=")) || executable.to_lowercase().contains("helper") {
        return None;
    }
    let mut candidates = Vec::new();
    match cmd.first().map(|first| base_name(first)) {
        Some(first) if LAUNCHERS.contains(&first.as_str()) => {
            candidates.push(base_name(executable));
            if let Some(script) = cmd.iter().skip(1).find(|part| !part.starts_with('-')) {
                candidates.push(base_name(script));
            }
        }
        // The name the process was started as wins over the binary on disk: Claude Code re-executes its own
        // binary as `ugrep`, `rg` and similar workers, which are part of one session and not sessions themselves.
        Some(first) => candidates.push(first),
        None => candidates.push(base_name(executable)),
    }
    RECOGNIZED_TOOLS
        .iter()
        .find(|(needle, _)| candidates.iter().any(|c| c == needle))
        .map(|(_, tool)| *tool)
}

struct Seen {
    pid: u32,
    /// Parent process id. Used only to fold a launcher shim into the binary it executes, never as delegation.
    parent: Option<u32>,
    tool: &'static str,
    start: u64,
    cwd: Option<PathBuf>,
    /// Full argument vector. Kept in memory only to match sessions; it is never serialized.
    args: Vec<String>,
}

/// Background servers that host sessions of many projects. They are not sessions themselves.
fn is_service(tool: &str, args: &[String]) -> bool {
    let has = |word: &str| args.iter().skip(1).any(|a| a == word);
    match tool {
        "Codex" => has("app-server") || has("exec-server") || has("mcp-server"),
        "OpenCode" => has("serve"),
        _ => false,
    }
}

/// A working directory that can plausibly be a project. Filesystem roots and application bundles describe where a
/// helper happens to run, not what the user is working on.
fn is_project_dir(cwd: &Path) -> bool {
    cwd.parent().is_some()
        && !["/Applications", "/System", "/Library", "/usr", "/private"]
            .iter()
            .any(|p| cwd.starts_with(p))
}

/// Executable name, flag names and known subcommands only. Flag values and free-form arguments can hold prompts,
/// settings or credentials, so they never reach the snapshot or the database.
pub fn sanitize_command(args: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if i == 0 {
            out.push(base_name(arg));
        } else if let Some(flag) = arg.strip_prefix("--") {
            out.push(format!("--{}", flag.split('=').next().unwrap_or_default()));
        } else if SAFE_SUBCOMMANDS.contains(&arg.as_str()) {
            out.push(arg.clone());
        }
    }
    out.join(" ")
}

/// Session id passed as `--resume <id>`, `--resume=<id>` or `--session-id <id>`.
fn session_id_in(args: &[String]) -> Option<String> {
    let looks_like_id = |v: &str| v.len() >= 8 && v.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    args.iter().enumerate().find_map(|(i, arg)| {
        let value = match arg.split_once('=') {
            Some(("--resume" | "--session-id", v)) => Some(v),
            None if arg == "--resume" || arg == "--session-id" => args.get(i + 1).map(String::as_str),
            _ => None,
        }?;
        looks_like_id(value).then(|| value.to_owned())
    })
}

/// Attach each delegated session to its parent. A delegation is recorded only when the tool named the parent
/// session and that session is in this snapshot. Process ancestry is never used, a session is never its own
/// parent, and a child whose parent is not observed stays a root rather than getting an invented one.
fn attach_parents(
    executions: &mut [ExecutionNode],
    node_of_session: &HashMap<String, String>,
    parent_of: Vec<(String, String)>,
) {
    for (child, parent_session) in parent_of {
        let Some(parent) = node_of_session.get(&parent_session).filter(|parent| **parent != child) else {
            continue;
        };
        if let Some(node) = executions.iter_mut().find(|node| node.id == child) {
            node.parent_id = Some(parent.clone());
            node.relationship = Reliability::Confirmed;
        }
    }
}

const ORCA_SOURCE: &str = "Orca orchestration database";
const ORCA_LINK_SOURCE: &str = "Orca dispatch id in the session's opening prompt";
/// How far into a transcript the dispatch id is looked for. Orca writes it in the worker's first prompt.
const ORCA_OPEN_BYTES: u64 = 256 * 1024;
/// A transcript may start this long before Orca stamps the dispatch (clock and launch skew).
const ORCA_START_SLACK_S: i64 = 120;

/// The session transcript of one Orca worker, found by evidence and not by guesswork: same agent, same worktree,
/// written since the dispatch started, and opening with the dispatch id Orca injected into the worker's prompt.
struct WorkerSession {
    path: PathBuf,
    modified: SystemTime,
    len: u64,
    claude: bool,
}

fn find_worker_session(
    dispatch: &OrcaDispatch,
    claude: &[ClaudeSession],
    codex: &[CodexRollout],
) -> Option<WorkerSession> {
    let floor = dispatch
        .created_s
        .and_then(|s| u64::try_from((s - ORCA_START_SLACK_S).max(0)).ok())
        .map(|s| SystemTime::UNIX_EPOCH + Duration::from_secs(s));
    let wants = |tool: &str| dispatch.agent.as_deref().is_none_or(|agent| agent.contains(tool));
    let same_tree = |cwd: Option<&str>| match (cwd, dispatch.worktree_path.as_deref()) {
        (Some(cwd), Some(tree)) => cwd == tree,
        _ => true,
    };
    let recent = |modified: SystemTime| floor.is_none_or(|floor| modified >= floor);
    let from_claude = || {
        claude
            .iter()
            .filter(|s| wants("claude") && recent(s.file.modified) && same_tree(s.cwd.as_deref()))
            .find(|s| adapters::opens_with(&s.file.path, &dispatch.id, ORCA_OPEN_BYTES))
            .map(|s| WorkerSession {
                path: s.file.path.clone(),
                modified: s.file.modified,
                len: s.file.len,
                claude: true,
            })
    };
    let from_codex = || {
        codex
            .iter()
            .filter(|r| wants("codex") && recent(r.file.modified) && same_tree(r.cwd.as_deref()))
            .find(|r| adapters::opens_with(&r.file.path, &dispatch.id, ORCA_OPEN_BYTES))
            .map(|r| WorkerSession {
                path: r.file.path.clone(),
                modified: r.file.modified,
                len: r.file.len,
                claude: false,
            })
    };
    from_claude().or_else(from_codex)
}

fn rfc3339(seconds: i64) -> Option<String> {
    DateTime::from_timestamp(seconds, 0).map(|t| t.to_rfc3339())
}

/// A short, stable suffix so workers of one run can be told apart without reading any task text.
fn short_id(id: &str) -> &str {
    &id[id.len().saturating_sub(6)..]
}

fn orca_dispatch_status(dispatch: &OrcaDispatch) -> ExecutionStatus {
    match dispatch.status.as_str() {
        "dispatched" => match dispatch.heartbeat_s.and_then(|s| u64::try_from(s).ok()) {
            Some(beat)
                if age_of(SystemTime::UNIX_EPOCH + Duration::from_secs(beat)).is_some_and(|a| a > ORCA_STALE) =>
            {
                ExecutionStatus::Idle
            }
            _ => ExecutionStatus::Running,
        },
        "completed" => ExecutionStatus::Completed,
        "failed" | "circuit_broken" => ExecutionStatus::Failed,
        _ => ExecutionStatus::Waiting,
    }
}

/// Run nodes and worker nodes from Orca's own records. A worker hangs under the worker that created it when Orca
/// recorded that, else under its run. Tasks without a dispatch are not shown: nothing has executed them yet.
/// No usage or model is available from this source, so those stay unavailable.
fn orca_nodes(dispatches: &[OrcaDispatch]) -> Vec<ExecutionNode> {
    let mut runs: Vec<(String, Vec<&OrcaDispatch>)> = Vec::new();
    for dispatch in dispatches {
        match runs.iter_mut().find(|(id, _)| *id == dispatch.run_id) {
            Some((_, members)) => members.push(dispatch),
            None => runs.push((dispatch.run_id.clone(), vec![dispatch])),
        }
    }
    let known: std::collections::HashSet<&str> = dispatches.iter().map(|d| d.id.as_str()).collect();
    let mut out = Vec::new();
    for (run_id, members) in runs {
        let statuses: Vec<ExecutionStatus> = members.iter().map(|d| orca_dispatch_status(d)).collect();
        let any = |wanted: fn(&ExecutionStatus) -> bool| statuses.iter().any(wanted);
        let run_status = if any(|s| matches!(s, ExecutionStatus::Running)) {
            ExecutionStatus::Running
        } else if any(|s| matches!(s, ExecutionStatus::Waiting)) {
            ExecutionStatus::Waiting
        } else if any(|s| matches!(s, ExecutionStatus::Failed)) {
            ExecutionStatus::Failed
        } else if any(|s| matches!(s, ExecutionStatus::Idle)) {
            ExecutionStatus::Idle
        } else {
            ExecutionStatus::Completed
        };
        let run_node_id = format!("orca-run:{run_id}");
        let started = members.iter().filter_map(|d| d.created_s).min();
        let last = members
            .iter()
            .filter_map(|d| d.completed_s.or(d.heartbeat_s).or(d.created_s))
            .max();
        let mut run = ExecutionNode::new(run_node_id.clone(), format!("Orca run {}", short_id(&run_id)), "Orca");
        run.status = run_status;
        run.relationship = Reliability::Confirmed;
        run.started_at = started.and_then(rfc3339);
        run.last_activity_at = last.and_then(rfc3339);
        run.usage_source = Some(ORCA_SOURCE.into());
        out.push(run);
        for (dispatch, status) in members.into_iter().zip(statuses) {
            // Preference: the worker that created it, then the dispatch of its parent task, then the run.
            let by_creator = dispatch
                .parent_dispatch_id
                .as_deref()
                .filter(|parent| known.contains(parent) && *parent != dispatch.id);
            let by_task = || {
                let parent_task = dispatch.parent_task_id.as_deref()?;
                dispatches
                    .iter()
                    .rev()
                    .find(|other| other.task_id == parent_task && other.id != dispatch.id)
                    .map(|other| other.id.as_str())
            };
            let parent = by_creator
                .or_else(by_task)
                .map_or_else(|| run_node_id.clone(), |parent| format!("orca-dispatch:{parent}"));
            let mut node = ExecutionNode::new(
                format!("orca-dispatch:{}", dispatch.id),
                format!("Worker {}", short_id(&dispatch.task_id)),
                "Orca",
            );
            node.parent_id = Some(parent);
            node.task = dispatch.title.as_deref().and_then(clean_task);
            node.status = status;
            node.relationship = Reliability::Confirmed;
            node.started_at = dispatch.created_s.and_then(rfc3339);
            node.last_activity_at = dispatch
                .completed_s
                .or(dispatch.heartbeat_s)
                .or(dispatch.created_s)
                .and_then(rfc3339);
            node.usage_source = Some(ORCA_SOURCE.into());
            out.push(node);
        }
    }
    out
}

/// A launcher (`node codex.js`) and the native binary it starts are one agent. Keep the binary and drop the
/// launcher when a same-tool process in the same directory names it as its parent. This is de-duplication of one
/// run, not a delegation edge.
fn drop_launcher_shims(seen: &mut Vec<Seen>) {
    let shims: Vec<u32> = seen
        .iter()
        .filter(|outer| {
            seen.iter().any(|inner| {
                inner.parent == Some(outer.pid)
                    && inner.tool == outer.tool
                    && inner.cwd == outer.cwd
                    && inner.pid != outer.pid
            })
        })
        .map(|outer| outer.pid)
        .collect();
    seen.retain(|item| !shims.contains(&item.pid));
}

fn age_of(modified: SystemTime) -> Option<Duration> {
    SystemTime::now().duration_since(modified).ok()
}

/// Status for a session that no process owns, from its last write and whether its host is alive.
/// Never `Completed`: a quiet file does not prove the session ended, so it is `Inactive`.
fn passive_status(modified: SystemTime, host_alive: bool) -> ExecutionStatus {
    match age_of(modified) {
        Some(age) if age <= IDLE_AFTER => ExecutionStatus::Running,
        Some(age) if age <= ACTIVE_WINDOW && host_alive => ExecutionStatus::Idle,
        _ => ExecutionStatus::Inactive,
    }
}

fn dir_label(path: &str, fallback: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| fallback.to_owned())
}

/// Transcript candidates for one tool plus the parser that reads them.
type TranscriptAdapter = (
    Vec<TranscriptFile>,
    fn(&TranscriptFile) -> Option<SessionUsage>,
    &'static str,
);
/// Usage linked to a process: the parsed data, its reliability, a human-readable source, the session mtime and,
/// for transcript files, the file (used to find the subagents written beside it).
type LinkedUsage = (SessionUsage, Reliability, String, SystemTime, Option<PathBuf>);

impl Collector {
    pub fn collect(&self) -> MonitorSnapshot {
        let observed_at = Utc::now().to_rfc3339();
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let mut seen = Vec::new();
        for (pid, process) in system.processes() {
            let executable = process.name().to_string_lossy().into_owned();
            let cmd: Vec<String> = process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect();
            let Some(tool) = recognize(&executable, &cmd) else {
                continue;
            };
            seen.push(Seen {
                pid: pid.as_u32(),
                parent: process.parent().map(|p| p.as_u32()),
                tool,
                start: process.start_time(),
                cwd: process.cwd().map(Path::to_path_buf),
                args: cmd,
            });
        }
        drop_launcher_shims(&mut seen);
        // Sessions a command line names explicitly (`--resume <id>`) belong to that process; another process
        // sharing the directory must not take them by the newest-file heuristic.
        let reserved: Vec<String> = seen.iter().filter_map(|item| session_id_in(&item.args)).collect();
        // Newest process first so transcripts are assigned to at most one process each.
        seen.sort_by_key(|item| std::cmp::Reverse(item.start));
        let mut claimed: Vec<PathBuf> = Vec::new();

        let mut processes = Vec::new();
        let mut executions = Vec::new();
        // Session id (as the tool records it) -> node id, to attach delegated sessions to their parent.
        let mut node_of_session: HashMap<String, String> = HashMap::new();
        // Transcript or rollout file -> the process node that owns it.
        let mut owner_of_file: HashMap<PathBuf, String> = HashMap::new();
        let mut parent_of: Vec<(String, String)> = Vec::new();
        for item in &seen {
            let process_id = format!("process:{}:{}", item.pid, item.start);
            let started_at = DateTime::from_timestamp(item.start as i64, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();
            let service = is_service(item.tool, &item.args);
            let project = item.cwd.as_deref().filter(|cwd| !service && is_project_dir(cwd));
            let linked = project.and_then(|cwd| self.link_usage(item, cwd, &mut claimed, &reserved));
            processes.push(ObservedProcess {
                id: process_id.clone(),
                pid: item.pid,
                tool: item.tool.into(),
                command: sanitize_command(&item.args),
                started_at: started_at.clone(),
                project_path: project.map(|path| path.display().to_string()),
                status: ExecutionStatus::Running,
                reliability: Reliability::Confirmed,
            });
            let label = if service {
                format!("{} server", item.tool)
            } else {
                project
                    .and_then(Path::file_name)
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| format!("{} process", item.tool))
            };
            let mut node = ExecutionNode::new(format!("execution:{process_id}"), label, item.tool);
            node.process_id = Some(process_id);
            node.role = if service {
                ExecutionRole::Service
            } else {
                ExecutionRole::Session
            };
            node.project_path = project.map(|path| path.display().to_string());
            node.status = ExecutionStatus::Running;
            node.started_at = Some(started_at);
            node.relationship = Reliability::Confirmed;
            let mut subagents = Vec::new();
            if let Some((usage, reliability, source, modified, file)) = linked {
                apply_usage(&mut node, &usage, reliability, source);
                node.last_activity_at = Some(DateTime::<Utc>::from(modified).to_rfc3339());
                if age_of(modified).is_some_and(|age| age > IDLE_AFTER) {
                    node.status = ExecutionStatus::Idle;
                }
                if let Some(id) = usage.session_id.clone() {
                    node_of_session.insert(id, node.id.clone());
                }
                if let Some(file) = &file {
                    owner_of_file.insert(file.clone(), node.id.clone());
                }
                if item.tool == "Claude Code" {
                    subagents = file.map(|f| self.claude_subagent_nodes(&f, &node)).unwrap_or_default();
                }
            }
            executions.push(node);
            executions.extend(subagents);
        }

        // Sessions no process claimed: the desktop apps host many sessions behind one server process, so the
        // tools' own session stores are the only evidence of which projects are being worked on. Counters are
        // confirmed for the file, but a file does not prove a live process, so status comes from write recency.
        self.link_orca_workers(&mut executions, &mut claimed, &owner_of_file, &mut node_of_session);
        let host_alive = |tool: &str| seen.iter().any(|item| item.tool == tool);
        let mut passive = Vec::new();
        for rollout in adapters::codex_recent_rollouts(SESSION_WINDOW) {
            if claimed.contains(&rollout.file.path) || passive.len() >= MAX_PASSIVE_SESSIONS {
                continue;
            }
            let path = &rollout.file.path;
            let mut node = ExecutionNode::new(
                format!("codex-session:{}", path.display()),
                rollout
                    .cwd
                    .as_deref()
                    .map_or_else(|| "Codex session".into(), |cwd| dir_label(cwd, "Codex session")),
                "Codex",
            );
            node.project_path = rollout.cwd.filter(|cwd| is_project_dir(Path::new(cwd)));
            node.status = if rollout.archived {
                ExecutionStatus::Archived
            } else {
                passive_status(rollout.file.modified, host_alive("Codex"))
            };
            node.started_at = Some(DateTime::<Utc>::from(rollout.file.modified).to_rfc3339());
            node.last_activity_at = node.started_at.clone();
            if let Some(usage) = self.cached(path, rollout.file.modified, rollout.file.len, adapters::parse_codex) {
                apply_usage(&mut node, &usage, Reliability::Confirmed, "Codex rollout file".into());
                node.started_at = usage.started_at.clone().or(node.started_at);
                node.last_activity_at = usage.last_event_at.clone().or(node.last_activity_at);
                if let Some(id) = usage.session_id.clone() {
                    node_of_session.insert(id, node.id.clone());
                }
                if let Some(parent) = usage.parent_session_id.clone() {
                    node.label = usage.agent_kind.clone().unwrap_or_else(|| "Subagent".into());
                    parent_of.push((node.id.clone(), parent));
                }
            }
            passive.push(node);
        }
        // Claude Code sessions with no process (finished, or run by a host that has since closed): listed from their
        // transcripts as workers, with the subagents written beside them. A process-owned session is never repeated.
        for session in adapters::claude_recent_sessions(SESSION_WINDOW)
            .into_iter()
            .filter(|s| !claimed.contains(&s.file.path))
            .take(MAX_PASSIVE_SESSIONS)
        {
            let path = &session.file.path;
            let short = path
                .file_stem()
                .map_or_else(String::new, |s| short_id(&s.to_string_lossy()).to_owned());
            let mut node = ExecutionNode::new(
                format!("claude-session:{}", path.display()),
                format!("Worker {short}"),
                "Claude Code",
            );
            node.project_path = session.cwd.filter(|cwd| is_project_dir(Path::new(cwd)));
            node.status = passive_status(session.file.modified, host_alive("Claude Code"));
            node.started_at = Some(DateTime::<Utc>::from(session.file.modified).to_rfc3339());
            node.last_activity_at = node.started_at.clone();
            if let Some(usage) = self.cached(path, session.file.modified, session.file.len, adapters::parse_claude) {
                apply_usage(
                    &mut node,
                    &usage,
                    Reliability::Confirmed,
                    "Claude Code transcript".into(),
                );
                node.started_at = usage.started_at.clone().or(node.started_at);
                node.last_activity_at = usage.last_event_at.or(node.last_activity_at);
            }
            let subagents = self.claude_subagent_nodes(path, &node);
            passive.push(node);
            passive.extend(subagents);
        }
        if let Some(db) = adapters::opencode_db_path() {
            let since_ms = SystemTime::now()
                .checked_sub(SESSION_WINDOW)
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            for session in adapters::opencode_recent_sessions(&db, since_ms)
                .into_iter()
                .filter(|s| !claimed.contains(&PathBuf::from(format!("opencode:{}", s.id))))
                .take(MAX_PASSIVE_SESSIONS * 3)
            {
                let modified = SystemTime::UNIX_EPOCH + Duration::from_millis(session.updated_ms);
                let mut node = ExecutionNode::new(
                    format!("opencode-session:{}", session.id),
                    match &session.parent_id {
                        Some(_) => session.usage.agent_kind.clone().unwrap_or_else(|| "Subagent".into()),
                        None => dir_label(&session.directory, "OpenCode session"),
                    },
                    "OpenCode",
                );
                node.task = session.title.as_deref().and_then(clean_task);
                node_of_session.insert(session.id.clone(), node.id.clone());
                if let Some(parent) = &session.parent_id {
                    parent_of.push((node.id.clone(), parent.clone()));
                }
                node.project_path = Some(session.directory.clone()).filter(|d| is_project_dir(Path::new(d)));
                node.status = if session.archived {
                    ExecutionStatus::Archived
                } else {
                    passive_status(modified, host_alive("OpenCode"))
                };
                node.started_at = session.usage.started_at.clone();
                node.last_activity_at = session.usage.last_event_at.clone();
                apply_usage(
                    &mut node,
                    &session.usage,
                    Reliability::Confirmed,
                    "OpenCode database".into(),
                );
                passive.push(node);
            }
        }
        executions.extend(passive);

        attach_parents(&mut executions, &node_of_session, parent_of);

        MonitorSnapshot {
            observed_at,
            processes,
            executions,
            collector_error: None,
        }
    }

    /// Orca worker nodes, enriched with the model and usage of the session each one ran. A session already owned by
    /// a live process is folded into the worker (the process node and its subagents move under it) so the same
    /// work is never listed twice.
    fn link_orca_workers(
        &self,
        executions: &mut Vec<ExecutionNode>,
        claimed: &mut Vec<PathBuf>,
        owner_of_file: &HashMap<PathBuf, String>,
        node_of_session: &mut HashMap<String, String>,
    ) {
        let Some(db) = adapters::orca_db_path() else {
            return;
        };
        let since = SystemTime::now()
            .checked_sub(SESSION_WINDOW)
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs() as i64);
        let dispatches = adapters::orca_dispatches(&db, since);
        let mut nodes = orca_nodes(&dispatches);
        let claude = adapters::claude_recent_sessions(SESSION_WINDOW);
        let codex = adapters::codex_recent_rollouts(SESSION_WINDOW);
        let mut subagents = Vec::new();
        for dispatch in &dispatches {
            let id = format!("orca-dispatch:{}", dispatch.id);
            let Some(found) = find_worker_session(dispatch, &claude, &codex) else {
                continue;
            };
            let parse = if found.claude {
                adapters::parse_claude
            } else {
                adapters::parse_codex
            };
            let Some(usage) = self.cached(&found.path, found.modified, found.len, parse) else {
                continue;
            };
            let Some(node) = nodes.iter_mut().find(|n| n.id == id) else {
                continue;
            };
            apply_usage(node, &usage, Reliability::Confirmed, ORCA_LINK_SOURCE.into());
            node.last_activity_at = usage.last_event_at.clone().or_else(|| node.last_activity_at.take());
            if let Some(session) = usage.session_id.clone() {
                node_of_session.insert(session, id.clone());
            }
            if let Some(owner) = owner_of_file.get(&found.path) {
                for other in executions.iter_mut().filter(|n| n.parent_id.as_ref() == Some(owner)) {
                    other.parent_id = Some(id.clone());
                }
                for target in node_of_session.values_mut().filter(|t| *t == owner) {
                    *target = id.clone();
                }
                executions.retain(|n| &n.id != owner);
            } else {
                claimed.push(found.path.clone());
                if found.claude {
                    subagents.extend(self.claude_subagent_nodes(&found.path, node));
                }
            }
        }
        executions.extend(nodes);
        executions.extend(subagents);
    }

    /// Subagents Claude Code wrote beside `session`, as children of the node that owns that session. Their
    /// usage is read from their own transcripts; a subagent of a subagent hangs under the main session with an
    /// inferred relationship because the parent subagent is not recorded.
    fn claude_subagent_nodes(&self, session: &Path, parent: &ExecutionNode) -> Vec<ExecutionNode> {
        adapters::claude_subagents(session)
            .into_iter()
            .filter(|sub| age_of(sub.file.modified).is_some_and(|age| age <= SESSION_WINDOW))
            .take(MAX_PASSIVE_SESSIONS * 2)
            .map(|sub| {
                let label = sub.agent_type.clone().unwrap_or_else(|| "Subagent".into());
                let mut node =
                    ExecutionNode::new(format!("{}:subagent:{}", parent.id, sub.agent_id), label, "Claude Code");
                node.parent_id = Some(parent.id.clone());
                node.task = sub.description.as_deref().and_then(clean_task);
                node.process_id = None;
                node.project_path = parent.project_path.clone();
                node.relationship = if sub.depth <= 1 {
                    Reliability::Confirmed
                } else {
                    Reliability::Inferred
                };
                node.status = passive_status(sub.file.modified, true);
                node.started_at = Some(DateTime::<Utc>::from(sub.file.modified).to_rfc3339());
                node.last_activity_at = node.started_at.clone();
                if let Some(usage) =
                    self.cached(&sub.file.path, sub.file.modified, sub.file.len, adapters::parse_claude)
                {
                    apply_usage(
                        &mut node,
                        &usage,
                        Reliability::Confirmed,
                        "Claude Code subagent transcript".into(),
                    );
                    node.started_at = usage.started_at.clone().or(node.started_at);
                    node.last_activity_at = usage.last_event_at.or(node.last_activity_at);
                }
                node
            })
            .collect()
    }

    fn cached(
        &self,
        path: &Path,
        modified: SystemTime,
        len: u64,
        parse: impl Fn(&TranscriptFile) -> Option<SessionUsage>,
    ) -> Option<SessionUsage> {
        if let Ok(cache) = self.cache.lock() {
            if let Some((m, l, usage)) = cache.get(path) {
                if *m == modified && *l == len {
                    return Some(usage.clone());
                }
            }
        }
        let usage = parse(&TranscriptFile {
            path: path.to_path_buf(),
            modified,
            len,
        })?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(path.to_path_buf(), (modified, len, usage.clone()));
        }
        Some(usage)
    }

    /// Pair a process with the newest unclaimed transcript of the same tool and working directory.
    /// Confirmed only when the command line names the session id; otherwise the pairing is inferred.
    fn link_usage(
        &self,
        item: &Seen,
        cwd: &Path,
        claimed: &mut Vec<PathBuf>,
        reserved: &[String],
    ) -> Option<LinkedUsage> {
        if item.tool == "OpenCode" {
            return self.link_opencode(item, cwd, claimed);
        }
        let (candidates, parse, source): TranscriptAdapter = match item.tool {
            "Claude Code" => (
                adapters::claude_transcripts(cwd),
                adapters::parse_claude,
                "Claude Code transcript",
            ),
            "Codex" => (
                adapters::codex_transcripts(cwd),
                adapters::parse_codex,
                "Codex rollout file",
            ),
            _ => return None,
        };
        if item.tool == "Claude Code" {
            let named_file = session_id_in(&item.args)
                .and_then(|id| adapters::claude_transcript_by_id(&id))
                .filter(|f| !claimed.contains(&f.path));
            if let Some(file) = named_file {
                claimed.push(file.path.clone());
                let usage = self.cached(&file.path, file.modified, file.len, parse)?;
                return Some((
                    usage,
                    Reliability::Confirmed,
                    format!("{source} (session id in command)"),
                    file.modified,
                    Some(file.path),
                ));
            }
        }
        let floor = SystemTime::UNIX_EPOCH + Duration::from_secs(item.start.saturating_sub(START_SLACK.as_secs()));
        // A process owns its own session, never a subagent session that happens to share the directory.
        let (file, usage) = candidates
            .into_iter()
            .filter(|f| f.modified >= floor && !claimed.contains(&f.path))
            .filter(|f| {
                let stem = f.path.file_stem().map(|s| s.to_string_lossy().into_owned());
                !stem.is_some_and(|stem| reserved.contains(&stem))
            })
            .find_map(|f| {
                let usage = self.cached(&f.path, f.modified, f.len, parse)?;
                usage.parent_session_id.is_none().then_some((f, usage))
            })?;
        claimed.push(file.path.clone());
        let named = usage
            .session_id
            .as_deref()
            .is_some_and(|id| item.args.iter().any(|a| a.contains(id)));
        let (reliability, how) = if named {
            (Reliability::Confirmed, "session id in command")
        } else {
            (Reliability::Inferred, "matched by working directory")
        };
        Some((
            usage,
            reliability,
            format!("{source} ({how})"),
            file.modified,
            Some(file.path),
        ))
    }

    /// OpenCode stores sessions in SQLite. The pairing rules match the transcript adapters: same working
    /// directory, updated after the process started, one session per process, confirmed only by session id.
    fn link_opencode(&self, item: &Seen, cwd: &Path, claimed: &mut Vec<PathBuf>) -> Option<LinkedUsage> {
        let db = adapters::opencode_db_path()?;
        let floor_ms = item.start.saturating_sub(START_SLACK.as_secs()) * 1000;
        let session = adapters::opencode_sessions(&db, cwd, floor_ms)
            .into_iter()
            .find(|s| !claimed.contains(&PathBuf::from(format!("opencode:{}", s.id))))?;
        claimed.push(PathBuf::from(format!("opencode:{}", session.id)));
        let named = item.args.iter().any(|a| a.contains(&session.id));
        let (reliability, how) = if named {
            (Reliability::Confirmed, "session id in command")
        } else {
            (Reliability::Inferred, "matched by working directory")
        };
        let modified = SystemTime::UNIX_EPOCH + Duration::from_millis(session.updated_ms);
        Some((
            session.usage,
            reliability,
            format!("OpenCode database ({how})"),
            modified,
            None,
        ))
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
            provider: usage.provider.clone(),
            effort: usage.effort.clone(),
            cache_read_tokens: usage.cache_read,
            cache_write_tokens: usage.cache_write,
            reasoning_tokens: usage.reasoning,
            cost_usd: usage.cost_usd,
        };
    }
    node.usage_source = Some(source);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn recognizes_cli_binaries_and_launcher_scripts() {
        assert_eq!(
            recognize("claude", &cmd(&["/Users/a/.local/bin/claude", "--resume"])),
            Some("Claude Code")
        );
        assert_eq!(
            recognize(
                "node",
                &cmd(&["node", "/opt/lib/node_modules/@google/gemini-cli/bin/gemini.js"])
            ),
            Some("Gemini CLI")
        );
        assert_eq!(
            recognize("opencode.exe", &cmd(&["/opt/x/opencode.exe", "serve"])),
            Some("OpenCode")
        );
    }

    #[test]
    fn ignores_desktop_app_helpers_and_unrelated_paths() {
        assert_eq!(
            recognize(
                "Claude Helper",
                &cmd(&[
                    "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
                    "--type=gpu-process"
                ])
            ),
            None
        );
        assert_eq!(
            recognize("Claude", &cmd(&["/Applications/Claude.app/Contents/MacOS/Claude"])),
            None
        );
        assert_eq!(
            recognize(
                "zsh",
                &cmd(&["/bin/zsh", "-c", "source /Users/a/.claude/shell-snapshots/x.sh"])
            ),
            None
        );
        assert_eq!(
            recognize(
                "chrome-native-host",
                &cmd(&[
                    "/Applications/Claude.app/Contents/Helpers/chrome-native-host",
                    "chrome-extension://x"
                ])
            ),
            None
        );
    }

    #[test]
    fn embedded_workers_run_from_a_cli_binary_are_not_sessions() {
        // Claude Code re-executes its own binary as `ugrep`; the executable name is still `claude`.
        assert_eq!(recognize("claude", &cmd(&["ugrep", "--ignore-files", "pattern"])), None);
        assert_eq!(
            recognize("claude", &cmd(&["claude", "--resume", "x"])),
            Some("Claude Code")
        );
        assert_eq!(recognize("claude", &[]), Some("Claude Code"));
    }

    #[test]
    fn app_servers_are_services_but_cli_sessions_are_not() {
        let args = |parts: &[&str]| parts.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        assert!(is_service("Codex", &args(&["/x/codex", "-c", "a=b", "app-server"])));
        assert!(is_service("Codex", &args(&["codex", "exec-server", "--remote", "u"])));
        assert!(is_service("OpenCode", &args(&["opencode.exe", "serve", "--service"])));
        assert!(!is_service("Codex", &args(&["codex", "resume", "abc"])));
        assert!(!is_service("Claude Code", &args(&["claude", "serve"])));
    }

    #[test]
    fn sanitized_command_drops_flag_values_and_free_text() {
        let args = [
            "/usr/bin/claude",
            "--settings",
            "{\"token\":\"SECRET\"}",
            "--model=opus",
            "fix the bug",
            "resume",
        ]
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>();
        let out = sanitize_command(&args);
        assert_eq!(out, "claude --settings --model resume");
        assert!(!out.contains("SECRET") && !out.contains("opus") && !out.contains("bug"));
    }

    #[test]
    fn session_id_is_read_only_from_resume_flags() {
        let args = |parts: &[&str]| parts.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        let id = "36a77769-8d52-4ea5-8719-33f69cacf8eb";
        assert_eq!(session_id_in(&args(&["claude", "--resume", id])).as_deref(), Some(id));
        assert_eq!(
            session_id_in(&args(&["claude", &format!("--session-id={id}")])).as_deref(),
            Some(id)
        );
        assert_eq!(session_id_in(&args(&["claude", "--resume"])), None);
        assert_eq!(session_id_in(&args(&["claude", "--resume", "not-an-id!"])), None);
        assert_eq!(session_id_in(&args(&["claude", id])), None);
    }

    #[test]
    fn roots_and_app_bundles_are_not_projects() {
        assert!(!is_project_dir(Path::new("/")));
        assert!(!is_project_dir(Path::new(
            "/Applications/ChatGPT.app/Contents/Resources"
        )));
        assert!(is_project_dir(Path::new("/Users/a/work/app")));
    }

    #[test]
    fn passive_status_never_claims_completion() {
        let ago = |secs| SystemTime::now() - Duration::from_secs(secs);
        assert!(matches!(passive_status(ago(10), false), ExecutionStatus::Running));
        assert!(matches!(passive_status(ago(600), true), ExecutionStatus::Idle));
        assert!(matches!(passive_status(ago(600), false), ExecutionStatus::Inactive));
        assert!(matches!(passive_status(ago(86_400), true), ExecutionStatus::Inactive));
    }

    fn node(id: &str) -> ExecutionNode {
        ExecutionNode::new(id.into(), id.into(), "Codex")
    }

    #[test]
    fn delegation_needs_a_named_parent_that_was_observed() {
        let mut nodes = vec![node("root"), node("child"), node("orphan"), node("self")];
        let sessions: HashMap<String, String> = [("s-root", "root"), ("s-self", "self")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        attach_parents(
            &mut nodes,
            &sessions,
            vec![
                ("child".into(), "s-root".into()),
                ("orphan".into(), "s-missing".into()),
                ("self".into(), "s-self".into()),
            ],
        );
        let parent = |id: &str| nodes.iter().find(|n| n.id == id).unwrap().parent_id.clone();
        assert_eq!(parent("child").as_deref(), Some("root"));
        assert_eq!(parent("orphan"), None, "unobserved parent must not be invented");
        assert_eq!(parent("self"), None, "a session is never its own parent");
        assert_eq!(parent("root"), None);
        let child = nodes.iter().find(|n| n.id == "child").unwrap();
        assert!(matches!(child.relationship, Reliability::Confirmed));
        let orphan = nodes.iter().find(|n| n.id == "orphan").unwrap();
        assert!(matches!(orphan.relationship, Reliability::Unavailable));
    }

    fn dispatch(id: &str, run: &str, parent: Option<&str>, status: &str) -> OrcaDispatch {
        OrcaDispatch {
            id: id.into(),
            run_id: run.into(),
            task_id: format!("task_{id}"),
            parent_dispatch_id: parent.map(str::to_owned),
            parent_task_id: None,
            status: status.into(),
            depth: 1,
            worktree_path: None,
            agent: None,
            title: Some(format!("title {id}")),
            created_s: Some(1_700_000_000),
            completed_s: None,
            heartbeat_s: None,
        }
    }

    #[test]
    fn orca_workers_nest_under_their_creator_or_their_run() {
        let nodes = orca_nodes(&[
            dispatch("a", "run1", None, "dispatched"),
            dispatch("b", "run1", Some("a"), "completed"),
            dispatch("c", "run1", Some("gone"), "failed"),
            dispatch("d", "run2", None, "pending"),
        ]);
        let parent = |id: &str| nodes.iter().find(|n| n.id == id).and_then(|n| n.parent_id.clone());
        assert_eq!(parent("orca-dispatch:a").as_deref(), Some("orca-run:run1"));
        assert_eq!(parent("orca-dispatch:b").as_deref(), Some("orca-dispatch:a"));
        assert_eq!(
            parent("orca-dispatch:c").as_deref(),
            Some("orca-run:run1"),
            "unknown creator falls back to the run"
        );
        assert_eq!(parent("orca-dispatch:d").as_deref(), Some("orca-run:run2"));
        assert_eq!(parent("orca-run:run1"), None);
        assert_eq!(nodes.iter().filter(|n| n.id.starts_with("orca-run:")).count(), 2);
    }

    #[test]
    fn a_coordinator_declared_task_parent_nests_agents_under_their_orchestrator() {
        // Real Orca 1.4 behavior: workers cannot start workers, so the coordinator records hierarchy with
        // `worker-start --parent`; creator_dispatch_id stays empty and every dispatch has depth 1.
        let mut agent = dispatch("agent", "run1", None, "dispatched");
        agent.task_id = "task_agent".into();
        agent.parent_task_id = Some("task_orch".into());
        let mut orch = dispatch("orch", "run1", None, "failed");
        orch.task_id = "task_orch".into();
        let mut stray = dispatch("stray", "run1", None, "completed");
        stray.parent_task_id = Some("task_unknown".into());
        let nodes = orca_nodes(&[orch, agent, stray]);
        let parent = |id: &str| nodes.iter().find(|n| n.id == id).and_then(|n| n.parent_id.clone());
        assert_eq!(parent("orca-dispatch:agent").as_deref(), Some("orca-dispatch:orch"));
        assert_eq!(parent("orca-dispatch:orch").as_deref(), Some("orca-run:run1"));
        assert_eq!(
            parent("orca-dispatch:stray").as_deref(),
            Some("orca-run:run1"),
            "unknown parent task falls back to the run"
        );
    }

    #[test]
    fn orca_status_comes_from_recorded_state_and_run_aggregates_it() {
        let nodes = orca_nodes(&[
            dispatch("a", "r", None, "dispatched"),
            dispatch("b", "r", None, "failed"),
            dispatch("c", "q", None, "completed"),
            dispatch("d", "p", None, "pending"),
        ]);
        let status = |id: &str| {
            nodes
                .iter()
                .find(|n| n.id == id)
                .map(|n| format!("{:?}", n.status))
                .unwrap()
        };
        assert_eq!(status("orca-dispatch:a"), "Running");
        assert_eq!(status("orca-dispatch:b"), "Failed");
        assert_eq!(status("orca-dispatch:d"), "Waiting");
        assert_eq!(status("orca-run:r"), "Running");
        assert_eq!(status("orca-run:q"), "Completed");
        assert_eq!(status("orca-run:p"), "Waiting");
    }

    #[test]
    fn orca_nodes_report_no_model_or_usage_and_name_their_source() {
        let nodes = orca_nodes(&[dispatch("a", "r", None, "completed")]);
        for node in &nodes {
            assert!(node.model.is_none() && node.tokens.is_none());
            assert!(node.task.is_none() || node.task.as_deref() == Some("title a"));
            assert!(matches!(node.usage_reliability, Reliability::Unavailable));
            assert_eq!(node.usage_source.as_deref(), Some(ORCA_SOURCE));
            assert!(node.project_path.is_none());
        }
    }

    #[test]
    fn a_stale_heartbeat_makes_a_dispatched_worker_idle() {
        let mut d = dispatch("a", "r", None, "dispatched");
        d.heartbeat_s = Some(1_700_000_000);
        assert!(matches!(orca_dispatch_status(&d), ExecutionStatus::Idle));
        d.heartbeat_s = None;
        assert!(matches!(orca_dispatch_status(&d), ExecutionStatus::Running));
    }

    fn seen(pid: u32, parent: Option<u32>, tool: &'static str, cwd: &str) -> Seen {
        Seen {
            pid,
            parent,
            tool,
            start: 1,
            cwd: Some(PathBuf::from(cwd)),
            args: Vec::new(),
        }
    }

    #[test]
    fn a_launcher_and_the_binary_it_runs_count_as_one_agent() {
        let mut items = vec![
            seen(10, Some(1), "Codex", "/p"),
            seen(11, Some(10), "Codex", "/p"),       // binary started by the launcher
            seen(20, Some(1), "Codex", "/p"),        // unrelated agent, same directory
            seen(30, Some(20), "Claude Code", "/p"), // different tool: not a shim
            seen(40, Some(20), "Codex", "/other"),   // different directory: not a shim
        ];
        drop_launcher_shims(&mut items);
        let mut pids: Vec<u32> = items.iter().map(|i| i.pid).collect();
        pids.sort();
        assert_eq!(pids, [11, 20, 30, 40]);
    }

    fn transcript(name: &str, body: &str) -> TranscriptFile {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-{name}.jsonl", std::process::id()));
        std::fs::write(&path, body).unwrap();
        let meta = std::fs::metadata(&path).unwrap();
        TranscriptFile {
            path,
            modified: meta.modified().unwrap(),
            len: meta.len(),
        }
    }

    #[test]
    fn an_orca_worker_is_matched_to_the_session_that_opens_with_its_dispatch_id() {
        let worker = transcript("w-open", "{\"m\":\"You are dispatch ctx_w1 on task t\"}\n");
        // The coordinator's own session also mentions the id, but only after a long unrelated prefix.
        let coordinator = transcript("w-coord", &format!("{}ctx_w1\n", "x".repeat(300_000)));
        let elsewhere = transcript("w-else", "{\"m\":\"ctx_w1 in another repo\"}\n");
        let claude = vec![
            ClaudeSession {
                file: coordinator.clone(),
                cwd: Some("/repo".into()),
            },
            ClaudeSession {
                file: elsewhere.clone(),
                cwd: Some("/other".into()),
            },
            ClaudeSession {
                file: worker.clone(),
                cwd: Some("/repo".into()),
            },
        ];
        let mut d = dispatch("ctx_w1", "run", None, "completed");
        d.agent = Some("claude".into());
        d.worktree_path = Some("/repo".into());
        d.created_s = Some(0);
        let found = find_worker_session(&d, &claude, &[]).expect("worker session");
        assert_eq!(found.path, worker.path);
        assert!(found.claude);
        // A different agent, a different worktree, or a dispatch that started after the file was written: no match.
        d.agent = Some("codex".into());
        assert!(find_worker_session(&d, &claude, &[]).is_none());
        d.agent = Some("claude".into());
        d.worktree_path = Some("/nowhere".into());
        assert!(find_worker_session(&d, &claude, &[]).is_none());
        d.worktree_path = Some("/repo".into());
        d.created_s = Some(i64::MAX / 4);
        assert!(find_worker_session(&d, &claude, &[]).is_none());
        for f in [&worker, &coordinator, &elsewhere] {
            let _ = std::fs::remove_file(&f.path);
        }
    }

    /// Synthetic stand-in for a real Orca run (the Orca CLI was not runnable when this was written): a coordinator
    /// run with two orchestrators, their agents and one subagent, read through the real SQL and mapping.
    #[test]
    fn a_three_level_orca_orchestration_is_reconstructed_from_its_database() {
        let path = std::env::temp_dir().join(format!("agent-monitor-{}-orca-e2e.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE dispatch_contexts (id TEXT, run_id TEXT, task_id TEXT, creator_dispatch_id TEXT, creator_handle TEXT,
                   assignee_handle TEXT, status TEXT, depth INTEGER, created_at TEXT, completed_at TEXT, last_heartbeat_at TEXT);
                 CREATE TABLE tasks (id TEXT, display_name TEXT, task_title TEXT, parent_id TEXT);
                 INSERT INTO tasks VALUES ('task_orchA', NULL, 'Backend workstream', NULL), ('task_orchB', NULL, 'Frontend workstream', NULL),
                   ('task_agentA1', NULL, 'Write the parser', NULL), ('task_agentB1', NULL, 'Style the table', 'task_orchB'), ('task_subA1x', NULL, 'Check edge cases', NULL);
                 INSERT INTO dispatch_contexts VALUES ('oA', 'run', 'task_orchA', NULL, NULL, 'hA', 'dispatched', 1, '2999-01-01 10:00:00', NULL, '2999-01-01 10:09:00');
                 INSERT INTO dispatch_contexts VALUES ('oB', 'run', 'task_orchB', NULL, NULL, 'hB', 'dispatched', 1, '2999-01-01 10:00:05', NULL, '2999-01-01 10:09:00');
                 INSERT INTO dispatch_contexts VALUES ('aA1', 'run', 'task_agentA1', 'oA', 'hA', 'hA1', 'dispatched', 2, '2999-01-01 10:02:00', NULL, '2999-01-01 10:09:00');
                 INSERT INTO dispatch_contexts VALUES ('aB1', 'run', 'task_agentB1', 'oB', 'hB', 'hB1', 'completed', 2, '2999-01-01 10:02:30', '2999-01-01 10:05:00', NULL);
                 INSERT INTO dispatch_contexts VALUES ('sA1x', 'run', 'task_subA1x', 'aA1', 'hA1', 'hS', 'failed', 3, '2999-01-01 10:04:00', '2999-01-01 10:06:00', NULL);",
            )
            .unwrap();
        }
        let nodes = orca_nodes(&adapters::orca_dispatches(&path, 0));
        let by = |id: &str| {
            nodes
                .iter()
                .find(|n| n.id == id)
                .unwrap_or_else(|| panic!("missing {id}"))
        };
        let parent = |id: &str| by(id).parent_id.clone();
        assert_eq!(nodes.len(), 6, "one run plus five workers");
        assert_eq!(parent("orca-dispatch:oA").as_deref(), Some("orca-run:run"));
        assert_eq!(parent("orca-dispatch:oB").as_deref(), Some("orca-run:run"));
        assert_eq!(parent("orca-dispatch:aA1").as_deref(), Some("orca-dispatch:oA"));
        assert_eq!(parent("orca-dispatch:aB1").as_deref(), Some("orca-dispatch:oB"));
        assert_eq!(parent("orca-dispatch:sA1x").as_deref(), Some("orca-dispatch:aA1"));
        assert_eq!(by("orca-dispatch:sA1x").task.as_deref(), Some("Check edge cases"));
        assert_eq!(by("orca-dispatch:oA").task.as_deref(), Some("Backend workstream"));
        assert_eq!(format!("{:?}", by("orca-dispatch:aB1").status), "Completed");
        assert_eq!(format!("{:?}", by("orca-dispatch:sA1x").status), "Failed");
        assert_eq!(format!("{:?}", by("orca-run:run").status), "Running");
        let _ = std::fs::remove_file(&path);
    }

    /// Manual smoke test against this machine: `cargo test live_snapshot -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_snapshot() {
        let snapshot = super::Collector::default().collect();
        for p in &snapshot.processes {
            println!(
                "proc pid={} tool={} cwd={:?} status={:?} cmd={}",
                p.pid, p.tool, p.project_path, p.status, p.command
            );
        }
        for e in &snapshot.executions {
            println!(
                "{:<12} {:?} proj={:?} {:?} parent={:?} id={} task={:?} {:<28} model={:?}({:?}) in={:?} out={:?} usage={:?} src={:?}",
                e.tool,
                e.role,
                e.project_path,
                e.status,
                e.parent_id.as_deref().map(|p| &p[p.len().saturating_sub(8)..]),
                &e.id[e.id.len().saturating_sub(8)..],
                e.task,
                e.label,
                e.model,
                e.model_reliability,
                e.tokens_in,
                e.tokens_out,
                e.usage_reliability,
                e.usage_source
            );
        }
        if let Ok(path) = std::env::var("AM_DUMP") {
            let mut value = serde_json::to_value(&snapshot).expect("serialize");
            value["processes"] = serde_json::json!([]); // never dump command lines
            std::fs::write(path, value.to_string()).expect("write dump");
        }
    }
}
