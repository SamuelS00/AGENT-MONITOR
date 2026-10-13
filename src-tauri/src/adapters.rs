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
    let mut by_message: std::collections::HashMap<String, (u64, u64)> = std::collections::HashMap::new();
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
            by_message.insert(id, (input, n("output_tokens")));
        }
        if let Some(ts) = v.get("timestamp").and_then(Value::as_str) {
            usage.started_at.get_or_insert_with(|| ts.to_owned());
            usage.last_event_at = Some(ts.to_owned());
        }
    }
    if !by_message.is_empty() {
        usage.tokens_in = Some(by_message.values().map(|(i, _)| i).sum());
        usage.tokens_out = Some(by_message.values().map(|(_, o)| o).sum());
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
            }
            Some("event_msg") if v.pointer("/payload/type").and_then(Value::as_str) == Some("token_count") => {
                if let Some(total) = v.pointer("/payload/info/total_token_usage") {
                    usage.tokens_in = total.get("input_tokens").and_then(Value::as_u64);
                    usage.tokens_out = total.get("output_tokens").and_then(Value::as_u64);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
        let body = "{\"timestamp\":\"t0\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"cwd\":\"/x\"}}\n\
{\"timestamp\":\"t1\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-a\"}}\n\
{\"timestamp\":\"t2\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"output_tokens\":1}}}}\n\
{\"timestamp\":\"t3\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":30,\"output_tokens\":4}}}}\n";
        let u = parse_codex(&temp("codex", body)).unwrap();
        assert_eq!(
            (u.model.as_deref(), u.tokens_in, u.tokens_out),
            (Some("gpt-a"), Some(30), Some(4))
        );
    }

    #[test]
    fn claude_project_dir_encoding() {
        let d = claude_project_dir(Path::new("/h"), Path::new("/Users/a/Desktop/MAC/AGENT-MONITOR"));
        assert!(d.ends_with("-Users-a-Desktop-MAC-AGENT-MONITOR"));
    }
}
