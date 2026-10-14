import type { SourceReliability } from "../types";

/** A value that always carries its provenance. `value` is absent when unavailable; never coerce to 0. */
export interface Metric<T> {
  value?: T;
  reliability: SourceReliability;
  source?: string;
}

export type AgentStatus = "running" | "waiting" | "completed" | "failed" | "disconnected" | "idle" | "inactive" | "archived" | "unknown";
export type AgentRole = "meta" | "orchestrator" | "agent" | "subagent";
export type EventKind = "start" | "tool" | "spawn" | "wait" | "resume" | "complete" | "error" | "disconnect";

export interface WaitSpan {
  start: number;
  end?: number;
  reason: string;
}
export interface AgentEvent {
  at: number;
  kind: EventKind;
  summary: string;
}

export interface AgentNode {
  id: string;
  parentId?: string;
  sessionId: string;
  label: string;
  role: AgentRole;
  /** Set only when the collector recorded this node's place in an orchestration. */
  level?: AgentRole;
  tool: string;
  model: Metric<string>;
  status: AgentStatus;
  startedAt?: number;
  endedAt?: number;
  /** Last write seen in the session record; not the same as process activity. */
  lastActivityAt?: number;
  waits: WaitSpan[];
  /** Own usage only. Rollups are computed in tree.ts so a child is never counted twice. */
  tokens: Metric<number>;
  tokensIn?: Metric<number>;
  tokensOut?: Metric<number>;
  provider?: Metric<string>;
  effort?: Metric<string>;
  cacheReadTokens?: Metric<number>;
  cacheWriteTokens?: Metric<number>;
  reasoningTokens?: Metric<number>;
  costUsd?: Metric<number>;
  activity?: string;
  /** Reliability of the edge to the parent. "inferred" = never presented as confirmed delegation. */
  relationship: SourceReliability;
  relationshipNote?: string;
  events: AgentEvent[];
  source: string;
}

export interface Project {
  id: string;
  name: string;
  path?: string;
}
export interface Session {
  id: string;
  projectId: string;
  title: string;
  rootId: string;
}

export interface HistorySession {
  id: string;
  project: string;
  title: string;
  tool: string;
  model: Metric<string>;
  startedAt: number;
  durationMs: number;
  agents: Metric<number>;
  tokens: Metric<number>;
  status: AgentStatus;
}

export type Capability = "process" | "transcript" | "usage" | "hierarchy";
export interface DetectedTool {
  name: string;
  version?: string;
  path?: string;
  /** What this adapter can actually observe, so gaps are explicit. */
  capabilities: Record<Capability, SourceReliability>;
  note?: string;
}

export interface Dataset {
  kind: "sample" | "live";
  observedAt: number;
  projects: Project[];
  sessions: Session[];
  nodes: AgentNode[];
  history: HistorySession[];
  tools: DetectedTool[];
  collectorError?: string;
}
