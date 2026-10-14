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

/// Codex rollout files whose session_meta cwd equals `cwd`, newest first. Only recent day folders are scanned.
pub fn codex_transcripts(cwd: &Path) -> Vec<TranscriptFile> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let root = home.join(".codex").join("sessions");
    let mut out = Vec::new();
    let cutoff = SystemTime::now() - std::time::Duration::from_secs(3 * 24 * 3600);
    for year in read_dirs(&root) {
        for month in read_dirs(&year) {
            for day in read_dirs(&month) {
                for file in jsonl_files(&day) {
                    if file.modified >= cutoff && codex_cwd(&file.path).is_some_and(|c| Path::new(&c) == cwd) {
                        out.push(file);
                    }
                }
            }
        }
    }
    out.sort_by_key(|file| std::cmp::Reverse(file.modified));
    out
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
    pub updated_ms: u64,
    pub usage: SessionUsage,
}

/// Read-only: the database is opened with `SQLITE_OPEN_READ_ONLY`; only the model name, token counters and
/// timestamps are selected, never message or part content.
pub fn opencode_sessions(db: &Path, cwd: &Path, updated_since_ms: u64) -> Vec<OpencodeSession> {
    use rusqlite::{Connection, OpenFlags};
    let Ok(conn) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
    else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
    let Ok(mut stmt) = conn.prepare(
        "SELECT s.id, s.time_created, s.time_updated, s.model, s.tokens_input, s.tokens_output, s.tokens_reasoning,
                s.tokens_cache_read, s.tokens_cache_write, s.cost,
                (SELECT json_extract(m.data, '$.modelID') || char(31) || coalesce(json_extract(m.data, '$.providerID'), '') FROM message m
                  WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
                  ORDER BY m.time_created DESC LIMIT 1)
         FROM session s
         WHERE s.directory = ?1 AND s.parent_id IS NULL AND s.time_updated >= ?2
         ORDER BY s.time_updated DESC",
    ) else { return Vec::new() };
    let rows = stmt.query_map(
        rusqlite::params![cwd.to_string_lossy(), updated_since_ms as i64],
        |row| {
            let id: String = row.get(0)?;
            let created: i64 = row.get(1)?;
            let updated: i64 = row.get(2)?;
            let model_json: Option<String> = row.get(3)?;
            let n = |i: usize| row.get::<_, i64>(i).map(|v| v.max(0) as u64);
            let (input, output, reasoning, cache_read, cache_write) = (n(4)?, n(5)?, n(6)?, n(7)?, n(8)?);
            let cost: Option<f64> = row.get(9)?;
            let last: Option<String> = row.get(10)?;
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
                    session_id: Some(id),
                },
            })
        },
    );
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
}
