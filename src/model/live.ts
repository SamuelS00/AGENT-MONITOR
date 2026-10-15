import type { ExecutionNode, MonitorSnapshot, ObservedProcess, SourceReliability, StoredSession } from "../types";
import type { AgentNode, Dataset, DetectedTool, HistorySession, Metric, Project, Session } from "./types";
import { unavailable } from "./format";
import { buildIndex } from "./tree";

/** Servers that host sessions of many projects (Codex app-server, OpenCode serve) are grouped apart from projects. */
const SERVICES_PROJECT: Project = { id: "services", name: "Background services" };
/** Orca runs and workers span worktrees, so they have no single project directory. */
const ORCA_PROJECT: Project = { id: "orca", name: "Orca orchestration" };

const baseName = (p?: string) => p?.split("/").filter(Boolean).pop();

/** Adapter from the collector's domain contract to the UI model. No inference beyond what the collector states. */
export function datasetFromSnapshot(s: MonitorSnapshot): Dataset {
  const procById = new Map<string, ObservedProcess>(s.processes.map((p) => [p.id, p]));
  const parse = (iso?: string) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : undefined;
  };
  const byId = new Map(s.executions.map((e) => [e.id, e]));
  const rootOf = (e: ExecutionNode): string => {
    let cur = e;
    const seen = new Set<string>();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    return cur.id;
  };

  const metric = <T>(value: T | undefined | null, reliability: SourceReliability | undefined, source: string): Metric<T> =>
    value !== undefined && value !== null && reliability && reliability !== "unavailable"
      ? { value, reliability, source }
      : unavailable<T>(source);
  const nodes: AgentNode[] = s.executions.map((e) => {
    const usageSource = e.usageSource ?? "collector";
    const usageRel = e.usageReliability ?? (e.tokens != null ? "confirmed" : "unavailable");
    return {
      id: e.id,
      parentId: e.parentId,
      sessionId: rootOf(e),
      label: e.label,
      activity: e.task,
      // A node with no recorded level is a plain session (or its child), never an orchestrator.
      role: e.level ?? (e.parentId ? "subagent" : "agent"),
      level: e.level,
      tool: e.tool,
      model: metric(e.model, e.modelReliability ?? (e.model ? "confirmed" : "unavailable"), usageSource),
      status: e.status,
      startedAt: parse(e.startedAt),
      lastActivityAt: parse(e.lastActivityAt),
      waits: [],
      tokens: metric(e.tokens, usageRel, usageSource),
      tokensIn: e.tokensIn != null ? metric(e.tokensIn, usageRel, usageSource) : undefined,
      tokensOut: e.tokensOut != null ? metric(e.tokensOut, usageRel, usageSource) : undefined,
      provider: e.provider != null ? metric(e.provider, usageRel, usageSource) : undefined,
      cacheReadTokens: e.cacheReadTokens != null ? metric(e.cacheReadTokens, usageRel, usageSource) : undefined,
      cacheWriteTokens: e.cacheWriteTokens != null ? metric(e.cacheWriteTokens, usageRel, usageSource) : undefined,
      reasoningTokens: e.reasoningTokens != null ? metric(e.reasoningTokens, usageRel, usageSource) : undefined,
      effort: e.effort != null ? metric(e.effort, usageRel, usageSource) : undefined,
      costUsd: e.costUsd != null ? metric(e.costUsd, usageRel, usageSource) : undefined,
      relationship: e.relationship,
      relationshipNote: e.relationship === "inferred" ? "Process relationship only; not confirmed delegation." : undefined,
      events: [],
      source: usageSource,
    };
  });
  const idx = buildIndex(nodes);
  const projectFor = (n: AgentNode): Project => {
    const exec = byId.get(n.id);
    if (exec?.role === "service") return SERVICES_PROJECT;
    const path = exec?.projectPath ?? procById.get(exec?.processId ?? "")?.projectPath;
    if (!path && exec?.tool === "Orca") return ORCA_PROJECT;
    return path && path !== "/" ? { id: path, name: baseName(path) ?? path, path } : { id: "unknown", name: "No working directory" };
  };
  const projects = new Map<string, Project>();
  // A process is the unit of observation for live work. Some adapters can emit
  // more than one root execution while enriching the same process with
  // different metadata. Listing each root would make one running process look
  // like several active sessions in a project. Keep the first root for a
  // process (the snapshot order is authoritative), while executions without a
  // process association remain separate because there is no evidence that they
  // are the same run.
  const sessionRoots = (() => {
    const seenProcessIds = new Set<string>();
    return idx.roots.filter((root) => {
      const processId = byId.get(root.id)?.processId;
      if (!processId) return true;
      if (seenProcessIds.has(processId)) return false;
      seenProcessIds.add(processId);
      return true;
    });
  })();
  const sessions: Session[] = sessionRoots.map((r) => {
    const p = projectFor(r);
    projects.set(p.id, p);
    return { id: r.id, projectId: p.id, title: r.label, rootId: r.id };
  });
  const tools: DetectedTool[] = [...new Set([...s.processes.map((p) => p.tool), ...s.executions.map((e) => e.tool)])].map((name) => {
    const mine = s.executions.filter((e) => e.tool === name);
    const hasUsage = mine.some((e) => e.tokens != null);
    const hasHierarchy = mine.some((e) => e.parentId);
    return {
      name,
      capabilities: {
        process: s.processes.some((p) => p.tool === name) ? "confirmed" : "unavailable",
        transcript: hasUsage ? "confirmed" : "unavailable",
        usage: hasUsage ? "confirmed" : "unavailable",
        hierarchy: hasHierarchy ? "confirmed" : "unavailable",
      },
      note: hasUsage
        ? "Process discovery and session usage."
        : hasHierarchy
          ? "Recorded delegation; no model or usage."
          : "Process discovery only.",
    };
  });
  return {
    kind: "live",
    observedAt: Date.parse(s.observedAt) || Date.now(),
    projects: [...projects.values()],
    sessions,
    nodes,
    history: [],
    tools,
    collectorError: s.collectorError,
  };
}

const HISTORY_SOURCE = "Stored snapshots";

/** History rows from the backend. Reliability and missing values carry over: no value is invented or zero-filled. */
export function historyFromStored(rows: StoredSession[]): HistorySession[] {
  const metric = <T>(value: T | undefined, reliability: SourceReliability): Metric<T> =>
    value !== undefined && reliability !== "unavailable" ? { value, reliability, source: HISTORY_SOURCE } : unavailable<T>(HISTORY_SOURCE);
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    title: r.title,
    tool: r.tool,
    model: metric(r.model, r.modelReliability),
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    agents: metric(r.agents, "confirmed"),
    tokens: metric(r.tokens, r.tokensReliability),
    status: r.status,
  }));
}
