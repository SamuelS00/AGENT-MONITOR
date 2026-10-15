export type SourceReliability = "confirmed" | "inferred" | "unavailable";
export type ExecutionStatus = "running" | "waiting" | "failed" | "idle" | "inactive" | "archived" | "completed" | "unknown";

export interface ObservedProcess {
  id: string;
  pid: number;
  tool: string;
  command: string;
  startedAt: string;
  projectPath?: string;
  status: ExecutionStatus;
  reliability: SourceReliability;
}

export interface ExecutionNode {
  id: string;
  parentId?: string;
  processId?: string;
  /** `service` is a background server that hosts sessions; it never owns a project. */
  role?: "session" | "service";
  /** Position in an orchestration, from recorded structure only. Absent for plain sessions. */
  level?: "meta" | "orchestrator" | "agent" | "subagent";
  /** The node this one is a new try of, when the tool recorded the retry. */
  retryOf?: string;
  /** Working directory the tool recorded for this session, when known. */
  projectPath?: string;
  label: string;
  /** Short title the tool recorded for this work (what the agent is working on). */
  task?: string;
  tool: string;
  model?: string;
  status: ExecutionStatus;
  startedAt?: string;
  tokens?: number;
  relationship: SourceReliability;
  modelReliability?: SourceReliability;
  tokensIn?: number;
  tokensOut?: number;
  usageReliability?: SourceReliability;
  usageSource?: string;
  provider?: string;
  effort?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** USD as reported by the tool itself; never computed by the monitor. */
  costUsd?: number;
  lastActivityAt?: string;
}

export interface MonitorSnapshot {
  observedAt: string;
  processes: ObservedProcess[];
  executions: ExecutionNode[];
  collectorError?: string;
}

/** A session reconstructed by the backend from stored snapshots. */
export interface StoredSession {
  id: string;
  project: string;
  title: string;
  tool: string;
  model?: string;
  modelReliability: SourceReliability;
  /** Epoch milliseconds. */
  startedAt: number;
  durationMs: number;
  agents: number;
  tokens?: number;
  tokensReliability: SourceReliability;
  status: ExecutionStatus | "waiting" | "failed" | "disconnected" | "inactive" | "archived" | "unknown";
}
