use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reliability { Confirmed, Inferred, Unavailable }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus { Running, Idle, Completed, Unknown }

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub process_id: Option<String>,
    pub label: String,
    pub tool: String,
    pub model: Option<String>,
    pub status: ExecutionStatus,
    pub started_at: Option<String>,
    pub tokens: Option<u64>,
    pub relationship: Reliability,
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
            id: "fixture-child".into(), parent_id: Some("fixture-root".into()), process_id: None,
            label: "Fixture child".into(), tool: "Codex".into(), model: None,
            status: ExecutionStatus::Unknown, started_at: None, tokens: None,
            relationship: Reliability::Inferred,
        };
        let value = serde_json::to_value(node).expect("serialize fixture");
        assert!(value["tokens"].is_null());
        assert!(value["model"].is_null());
        assert_eq!(value["relationship"], "inferred");
    }
}
