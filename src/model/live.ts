import type { ExecutionNode, MonitorSnapshot, ObservedProcess } from "../types";
import type { AgentNode, Dataset, DetectedTool, Project, Session } from "./types";
import { confirmed, unavailable } from "./format";
import { buildIndex } from "./tree";

const baseName = (p?: string) => p?.split("/").filter(Boolean).pop();

/** Adapter from the collector's domain contract to the UI model. No inference beyond what the collector states. */
export function datasetFromSnapshot(s: MonitorSnapshot): Dataset {
  const procById = new Map<string, ObservedProcess>(s.processes.map((p) => [p.id, p]));
  const parse = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : undefined; };
  const byId = new Map(s.executions.map((e) => [e.id, e]));
  const rootOf = (e: ExecutionNode): string => { let cur = e; const seen = new Set<string>(); while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId)!; } return cur.id; };

  const nodes: AgentNode[] = s.executions.map((e) => ({
    id: e.id, parentId: e.parentId, sessionId: rootOf(e), label: e.label, role: e.parentId ? "agent" : "orchestrator", tool: e.tool,
    model: e.model ? confirmed(e.model, "collector") : unavailable("collector"),
    status: e.status, startedAt: parse(e.startedAt), waits: [],
    tokens: e.tokens !== undefined && e.tokens !== null ? confirmed(e.tokens, "collector") : unavailable("collector"),
    relationship: e.relationship,
    relationshipNote: e.relationship === "inferred" ? "Process relationship only; not confirmed delegation." : undefined,
    events: [], source: "collector",
  }));
  const idx = buildIndex(nodes);
  const projectFor = (n: AgentNode): Project => {
    const proc = procById.get(s.executions.find((e) => e.id === n.id)?.processId ?? "");
    const path = proc?.projectPath;
    return path ? { id: path, name: baseName(path) ?? path, path } : { id: "unknown", name: "Unknown project" };
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
