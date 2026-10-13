import type { ExecutionNode, MonitorSnapshot, ObservedProcess, SourceReliability } from "../types";
import type { AgentNode, Dataset, DetectedTool, Metric, Project, Session } from "./types";
import { unavailable } from "./format";
import { buildIndex } from "./tree";

const baseName = (p?: string) => p?.split("/").filter(Boolean).pop();

/** Adapter from the collector's domain contract to the UI model. No inference beyond what the collector states. */
export function datasetFromSnapshot(s: MonitorSnapshot): Dataset {
  const procById = new Map<string, ObservedProcess>(s.processes.map((p) => [p.id, p]));
  const parse = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : undefined; };
  const byId = new Map(s.executions.map((e) => [e.id, e]));
  const rootOf = (e: ExecutionNode): string => { let cur = e; const seen = new Set<string>(); while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId)!; } return cur.id; };

  const metric = <T,>(value: T | undefined | null, reliability: SourceReliability | undefined, source: string): Metric<T> =>
    value !== undefined && value !== null && reliability && reliability !== "unavailable"
      ? { value, reliability, source }
      : unavailable<T>(source);
  const nodes: AgentNode[] = s.executions.map((e) => {
    const usageSource = e.usageSource ?? "collector";
    const usageRel = e.usageReliability ?? (e.tokens != null ? "confirmed" : "unavailable");
    return {
      id: e.id, parentId: e.parentId, sessionId: rootOf(e), label: e.label, role: e.parentId ? "agent" : "orchestrator", tool: e.tool,
      model: metric(e.model, e.modelReliability ?? (e.model ? "confirmed" : "unavailable"), usageSource),
      status: e.status, startedAt: parse(e.startedAt), lastActivityAt: parse(e.lastActivityAt), waits: [],
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
      events: [], source: usageSource,
    };
  });
  const idx = buildIndex(nodes);
  const projectFor = (n: AgentNode): Project => {
    const proc = procById.get(s.executions.find((e) => e.id === n.id)?.processId ?? "");
    const path = proc?.projectPath;
    return path && path !== "/" ? { id: path, name: baseName(path) ?? path, path } : { id: "unknown", name: "Unknown project" };
  };
  const projects = new Map<string, Project>();
  const sessions: Session[] = idx.roots.map((r) => {
    const p = projectFor(r); projects.set(p.id, p);
    return { id: r.id, projectId: p.id, title: r.label, rootId: r.id };
  });
  const tools: DetectedTool[] = [...new Set(s.processes.map((p) => p.tool))].map((name) => ({
    name, capabilities: { process: "confirmed", transcript: "unavailable", usage: "unavailable", hierarchy: "unavailable" }, note: "Process discovery only.",
  }));
  return { kind: "live", observedAt: Date.parse(s.observedAt) || Date.now(), projects: [...projects.values()], sessions, nodes, history: [], tools, collectorError: s.collectorError };
}
