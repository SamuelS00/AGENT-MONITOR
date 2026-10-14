//! Sessions reconstructed from the stored collector snapshots. Nothing is stored beyond the snapshots themselves:
//! a session is whatever the snapshots, taken together, show about one root execution over time.
use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const MAX_ROWS: usize = 500;
const LIVE: [&str; 3] = ["running", "waiting", "idle"];

/// One stored session. `status` is the last status a snapshot recorded, except that a session still shown as live that
/// no later snapshot mentions is `disconnected`: it vanished while active, so how it ended is unknown.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub project: String,
    pub title: String,
    pub tool: String,
    pub model: Option<String>,
    pub model_reliability: String,
    /// Epoch milliseconds.
    pub started_at: i64,
    pub duration_ms: i64,
    pub agents: u64,
    pub tokens: Option<u64>,
    pub tokens_reliability: String,
    pub status: String,
}

struct Entry {
    row: HistoryRow,
    first_seen: i64,
    last_seen: i64,
    last_activity: Option<i64>,
}

fn millis(value: Option<&Value>) -> Option<i64> {
    DateTime::parse_from_rfc3339(value?.as_str()?)
        .ok()
        .map(|t| t.timestamp_millis())
}

fn text<'a>(node: &'a Value, key: &str) -> Option<&'a str> {
    node.get(key).and_then(Value::as_str)
}

fn project_name(path: Option<&str>) -> String {
    path.and_then(|p| p.rsplit('/').find(|part| !part.is_empty()))
        .map_or_else(|| "No working directory".to_owned(), str::to_owned)
}

/// Build history rows from snapshots given oldest first as `(observed_at, payload)`. Services are not sessions.
/// Several snapshots of one session merge: it keeps its earliest start, its latest activity and the highest token
/// count seen, since the counters only grow.
pub fn build_history(snapshots: &[(String, Value)]) -> Vec<HistoryRow> {
    let mut entries: HashMap<String, Entry> = HashMap::new();
    let latest = snapshots
        .iter()
        .filter_map(|(at, _)| millis(Some(&Value::String(at.clone()))))
        .max();
    for (observed, payload) in snapshots {
        let Some(observed_ms) = millis(Some(&Value::String(observed.clone()))) else {
            continue;
        };
        let Some(executions) = payload.get("executions").and_then(Value::as_array) else {
            continue;
        };
        let by_id: HashMap<&str, &Value> = executions.iter().filter_map(|e| Some((text(e, "id")?, e))).collect();
        let mut children: HashMap<&str, Vec<&Value>> = HashMap::new();
        for execution in executions {
            if let Some(parent) = text(execution, "parentId").filter(|p| by_id.contains_key(p)) {
                children.entry(parent).or_default().push(execution);
            }
        }
        let roots = executions.iter().filter(|e| {
            text(e, "parentId").is_none_or(|p| !by_id.contains_key(p)) && text(e, "role") != Some("service")
        });
        for root in roots {
            let Some(root_id) = text(root, "id") else { continue };
            let mut tree: Vec<&Value> = Vec::new();
            let mut seen: HashSet<&str> = HashSet::new();
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                let Some(id) = text(node, "id") else { continue };
                if !seen.insert(id) {
                    continue;
                }
                tree.push(node);
                stack.extend(children.get(id).into_iter().flatten());
            }
            let tool = text(root, "tool").unwrap_or("Unknown").to_owned();
            let key = format!("{tool}:{}", text(root, "sessionRef").unwrap_or(root_id));
            let counted: Vec<&Value> = tree
                .iter()
                .copied()
                .filter(|n| n.get("tokens").is_some_and(|t| t.is_u64()))
                .collect();
            let tokens =
                (!counted.is_empty()).then(|| counted.iter().filter_map(|n| n["tokens"].as_u64()).sum::<u64>());
            let inferred = counted.iter().any(|n| text(n, "usageReliability") == Some("inferred"));
            let started = millis(root.get("startedAt")).unwrap_or(observed_ms);
            let activity = tree.iter().filter_map(|n| millis(n.get("lastActivityAt"))).max();
            let model = text(root, "model").map(str::to_owned);
            let row = HistoryRow {
                id: key.clone(),
                project: project_name(text(root, "projectPath")),
                title: text(root, "label").unwrap_or("Session").to_owned(),
                tool,
                model_reliability: if model.is_some() {
                    text(root, "modelReliability").unwrap_or("confirmed").to_owned()
                } else {
                    "unavailable".into()
                },
                model,
                started_at: started,
                duration_ms: 0,
                agents: tree.len() as u64,
                tokens,
                tokens_reliability: match (tokens, inferred) {
                    (None, _) => "unavailable".into(),
                    (Some(_), true) => "inferred".into(),
                    (Some(_), false) => "confirmed".into(),
                },
                status: text(root, "status").unwrap_or("unknown").to_owned(),
            };
            entries
                .entry(key)
                .and_modify(|e| {
                    e.first_seen = e.first_seen.min(observed_ms);
                    e.last_seen = e.last_seen.max(observed_ms);
                    e.last_activity = e.last_activity.max(activity);
                    e.row.started_at = e.row.started_at.min(row.started_at);
                    if observed_ms >= e.last_seen {
                        // The newest snapshot decides what the session currently looks like.
                        let tokens = e.row.tokens.max(row.tokens);
                        e.row = HistoryRow {
                            started_at: e.row.started_at,
                            tokens,
                            ..row.clone()
                        };
                    }
                })
                .or_insert(Entry {
                    row,
                    first_seen: observed_ms,
                    last_seen: observed_ms,
                    last_activity: activity,
                });
        }
    }
    let mut rows: Vec<HistoryRow> = entries
        .into_values()
        .map(|mut e| {
            if latest.is_some_and(|l| e.last_seen < l) && LIVE.contains(&e.row.status.as_str()) {
                e.row.status = "disconnected".into();
            }
            // A live session counts to the last time it was seen; a stopped one to its last recorded activity.
            let live = LIVE.contains(&e.row.status.as_str());
            let end = e
                .last_activity
                .unwrap_or(e.last_seen)
                .max(if live { e.last_seen } else { 0 });
            e.row.duration_ms = (end - e.row.started_at).max(0);
            e.row
        })
        .collect();
    rows.sort_by(|a, b| b.started_at.cmp(&a.started_at).then(a.id.cmp(&b.id)));
    rows.truncate(MAX_ROWS);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snap(at: &str, executions: Value) -> (String, Value) {
        (at.to_owned(), json!({ "executions": executions }))
    }

    #[test]
    fn one_session_across_snapshots_merges_and_keeps_the_highest_tokens() {
        let a = json!([{ "id": "p1", "tool": "Claude Code", "sessionRef": "s1", "label": "app", "status": "running",
            "projectPath": "/w/app", "startedAt": "2026-10-14T10:00:00+00:00", "tokens": 100, "model": "m", "modelReliability": "confirmed" }]);
        // Later the same session is seen only through its files, with another node id and a lower partial count.
        let b = json!([{ "id": "claude-session:x", "tool": "Claude Code", "sessionRef": "s1", "label": "Worker s1", "status": "inactive",
            "projectPath": "/w/app", "startedAt": "2026-10-14T10:00:00+00:00", "lastActivityAt": "2026-10-14T10:30:00+00:00", "tokens": 90 }]);
        let rows = build_history(&[
            snap("2026-10-14T10:10:00+00:00", a),
            snap("2026-10-14T11:00:00+00:00", b),
        ]);
        assert_eq!(rows.len(), 1, "same tool and sessionRef is one session");
        assert_eq!(
            (rows[0].tokens, rows[0].status.as_str(), rows[0].project.as_str()),
            (Some(100), "inactive", "app")
        );
        assert_eq!(
            rows[0].duration_ms,
            30 * 60 * 1000,
            "from the start to the last recorded activity"
        );
    }

    #[test]
    fn a_live_session_that_vanishes_is_disconnected_not_completed() {
        let gone = json!([{ "id": "p1", "tool": "Codex", "label": "a", "status": "running", "startedAt": "2026-10-14T10:00:00+00:00" }]);
        let stays = json!([{ "id": "p2", "tool": "Codex", "label": "b", "status": "running", "startedAt": "2026-10-14T10:05:00+00:00" }]);
        let rows = build_history(&[
            snap("2026-10-14T10:10:00+00:00", gone),
            snap("2026-10-14T10:20:00+00:00", stays),
        ]);
        let status = |t: &str| rows.iter().find(|r| r.title == t).unwrap().status.clone();
        assert_eq!(status("a"), "disconnected");
        assert_eq!(status("b"), "running", "still present in the newest snapshot");
    }

    #[test]
    fn services_are_not_sessions_and_a_subtree_counts_once() {
        let nodes = json!([
            { "id": "svc", "tool": "Codex", "role": "service", "label": "Codex server", "status": "running" },
            { "id": "root", "tool": "Orca", "label": "meta", "status": "running", "tokens": 10, "startedAt": "2026-10-14T10:00:00+00:00" },
            { "id": "kid", "parentId": "root", "tool": "Orca", "label": "kid", "status": "completed", "tokens": 5, "usageReliability": "inferred" },
            { "id": "orphan", "parentId": "not-in-snapshot", "tool": "Codex", "label": "orphan", "status": "idle" }
        ]);
        let rows = build_history(&[snap("2026-10-14T10:10:00+00:00", nodes)]);
        assert!(rows.iter().all(|r| r.title != "Codex server"));
        let root = rows.iter().find(|r| r.title == "meta").unwrap();
        assert_eq!(
            (root.agents, root.tokens, root.tokens_reliability.as_str()),
            (2, Some(15), "inferred")
        );
        assert!(
            rows.iter().any(|r| r.title == "orphan"),
            "a child whose parent is not observed is its own root"
        );
    }

    #[test]
    fn missing_data_stays_unavailable_and_bad_snapshots_are_skipped() {
        let bare = json!([{ "id": "p", "tool": "Codex", "label": "x", "status": "idle" }]);
        let rows = build_history(&[
            ("not a timestamp".into(), json!({ "executions": [] })),
            ("2026-10-14T10:00:00+00:00".into(), json!({ "nothing": true })),
            snap("2026-10-14T10:10:00+00:00", bare),
        ]);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (
                rows[0].tokens,
                rows[0].tokens_reliability.as_str(),
                rows[0].model_reliability.as_str()
            ),
            (None, "unavailable", "unavailable")
        );
        assert_eq!(rows[0].project, "No working directory");
        assert!(build_history(&[]).is_empty());
    }
}
