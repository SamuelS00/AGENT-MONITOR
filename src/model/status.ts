import type { AgentStatus } from "./types";

export const STATUS_ORDER: AgentStatus[] = [
  "running",
  "waiting",
  "failed",
  "disconnected",
  "idle",
  "inactive",
  "archived",
  "completed",
  "unknown",
];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Running",
  waiting: "Needs input",
  completed: "Completed",
  failed: "Failed",
  disconnected: "Disconnected",
  idle: "Idle",
  inactive: "Stopped",
  archived: "Archived",
  unknown: "Unknown",
};

export const STATUS_HINT: Record<AgentStatus, string> = {
  running: "Actively executing",
  waiting: "Blocked on approval, input or another agent",
  archived: "Moved to the tool's archive",
  completed: "Finished normally",
  failed: "Ended with an error",
  disconnected: "Process lost; final state unknown",
  idle: "Process alive, no recent activity",
  inactive: "No live process observed and nothing written recently; the session may or may not have finished",
  unknown: "State could not be determined",
};

export const isActive = (s: AgentStatus) => s === "running" || s === "waiting" || s === "idle";
