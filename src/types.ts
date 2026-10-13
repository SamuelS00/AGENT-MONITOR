export type SourceReliability = "confirmed" | "inferred" | "unavailable";
export type ExecutionStatus = "running" | "idle" | "completed" | "unknown";

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
  label: string;
  tool: string;
  model?: string;
  status: ExecutionStatus;
  startedAt?: string;
  tokens?: number;
  relationship: SourceReliability;
}

export interface MonitorSnapshot {
  observedAt: string;
  processes: ObservedProcess[];
  executions: ExecutionNode[];
  collectorError?: string;
}
