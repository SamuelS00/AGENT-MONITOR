use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reliability {
    Confirmed,
    Inferred,
    Unavailable,
}

// The enum variants below model the full domain contract from
// docs/architecture/data-model.md. Not every status is constructible yet,
// but the UI already renders them, so they are intentionally kept.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus {
    Running,
    /// Blocked on another agent or on a dispatch that has not started.
    Waiting,
    /// Ended with an error as recorded by the tool.
    Failed,
    /// A live process, or a live host, with no recent activity.
    Idle,
    /// The tool itself moved the session to its archive (Codex `archived_sessions`, OpenCode `time_archived`).
    Archived,
    /// No live process observed and nothing written recently. Says nothing about how the session ended.
    Inactive,
    Completed,
    Unknown,
}

/// `Session` is user-facing agent work. `Service` is infrastructure (an app server or background daemon)
/// that hosts sessions but is not one itself, so it never owns a project.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionRole {
    Session,
    Service,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedProcess {
    pub id: String,
    pub pid: u32,
    pub tool: String,
    pub command: String,
    pub started_at: String,
    pub project_path: Option<String>,
    pub status: ExecutionStatus,
    pub reliability: Reliability,
}

/// A tool-recorded title shown as "what this agent is working on": whitespace collapsed, capped at 140 characters.
/// Empty titles and tool placeholders (OpenCode's "New session - ...") are not titles.
pub fn clean_task(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let placeholder = collapsed.starts_with("New session -") || collapsed.starts_with("Child session -");
    if collapsed.is_empty() || placeholder {
        return None;
    }
    let mut out: String = collapsed.chars().take(140).collect();
    if collapsed.chars().count() > 140 {
        out.push('…');
    }
    Some(out)
}

/// Optional usage breakdown. Every field is `None` when the source does not report it, never zero.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetail {
    pub provider: Option<String>,
    /// Reasoning effort / variant as recorded by the tool.
    pub effort: Option<String>,
    /// Subset of `tokens_in`.
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    /// Subset of `tokens_out`.
    pub reasoning_tokens: Option<u64>,
    /// USD cost as reported by the tool; never computed by the monitor.
    pub cost_usd: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub process_id: Option<String>,
    pub role: ExecutionRole,
    /// Working directory the tool itself recorded (or the process was started in); `None` when unknown.
    pub project_path: Option<String>,
    pub label: String,
    /// Short title the tool gave this unit of work (Orca task title, Claude subagent description, OpenCode session
    /// title). Capped and whitespace-collapsed; `None` when the tool records none.
    pub task: Option<String>,
    pub tool: String,
    pub model: Option<String>,
    pub status: ExecutionStatus,
    pub started_at: Option<String>,
    pub tokens: Option<u64>,
    pub relationship: Reliability,
    /// Reliability of `model`; `Unavailable` when no adapter could read it.
    pub model_reliability: Reliability,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    /// Reliability of the token counters. `Inferred` when the transcript was matched by working directory only.
    pub usage_reliability: Reliability,
    pub usage_source: Option<String>,
    #[serde(flatten)]
    pub detail: UsageDetail,
    pub last_activity_at: Option<String>,
}

impl ExecutionNode {
    /// A node with every metric unavailable. Adapters fill in only what their source actually reports.
    pub fn new(id: String, label: String, tool: &str) -> Self {
        Self {
            id,
            parent_id: None,
            process_id: None,
            role: ExecutionRole::Session,
            project_path: None,
            label,
            task: None,
            tool: tool.into(),
            model: None,
            status: ExecutionStatus::Unknown,
            started_at: None,
            tokens: None,
            relationship: Reliability::Unavailable,
            model_reliability: Reliability::Unavailable,
            tokens_in: None,
            tokens_out: None,
            usage_reliability: Reliability::Unavailable,
            usage_source: None,
            detail: UsageDetail::default(),
            last_activity_at: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    pub observed_at: String,
    pub processes: Vec<ObservedProcess>,
    pub executions: Vec<ExecutionNode>,
    pub collector_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_metrics_remain_null_in_serialization() {
        let node = ExecutionNode {
            parent_id: Some("fixture-root".into()),
            relationship: Reliability::Inferred,
            ..ExecutionNode::new("fixture-child".into(), "Fixture child".into(), "Codex")
        };
        let value = serde_json::to_value(node).expect("serialize fixture");
        assert!(value["tokens"].is_null());
        assert!(value["model"].is_null());
        assert!(value["costUsd"].is_null() && value["provider"].is_null() && value["effort"].is_null());
        assert_eq!(value["relationship"], "inferred");
        assert_eq!(value["role"], "session");
        assert!(value["task"].is_null());
        assert!(value["projectPath"].is_null());
    }

    #[test]
    fn task_titles_are_collapsed_capped_and_never_placeholders() {
        assert_eq!(clean_task("  fix \n the   bug ").as_deref(), Some("fix the bug"));
        assert_eq!(clean_task("   "), None);
        assert_eq!(clean_task("New session - 2026-10-14T10:00:00Z"), None);
        let long = "é".repeat(200);
        let cut = clean_task(&long).unwrap();
        assert_eq!(cut.chars().count(), 141);
        assert!(cut.ends_with('…'));
    }
}
