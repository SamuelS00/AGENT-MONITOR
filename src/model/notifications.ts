import { isOrchestration, summarize } from "./orchestration";
import { buildIndex, descendants } from "./tree";
import type { Dataset } from "./types";

export interface MonitorNotification {
  key: string;
  title: string;
  body: string;
  /** Provenance stays attached to the event, even though the OS only displays its title and body. */
  sources: string[];
}

/** Compare successful, consecutive live observations. This function has no delivery or permission side effects. */
export function notificationsFor(previous: Dataset | null, next: Dataset): MonitorNotification[] {
  if (!previous || previous.kind !== "live" || next.kind !== "live" || previous.collectorError || next.collectorError) return [];
  const before = buildIndex(previous.nodes);
  const after = buildIndex(next.nodes);
  const events = new Map<string, MonitorNotification>();
  for (const node of next.nodes) {
    const old = before.byId.get(node.id);
    if (!old || old.status === node.status || node.status !== "waiting") continue;
    const key = `${node.id}:waiting:${node.waits.at(-1)?.start ?? node.lastActivityAt ?? next.observedAt}`;
    events.set(key, { key, title: "Needs input", body: node.label, sources: [node.source] });
  }
  for (const session of next.sessions) {
    const root = after.byId.get(session.rootId);
    const oldRoot = before.byId.get(session.rootId);
    if (!root || !oldRoot || !isOrchestration(root) || !isOrchestration(oldRoot)) continue;
    if (summarize(before, root.id).outcome !== "running") continue;
    const nodes = [root, ...descendants(after, root.id)];
    // Losing a worker or its status is not evidence that an orchestration finished.
    if (descendants(before, root.id).some((n) => !after.byId.has(n.id))) continue;
    const summary = summarize(after, root.id);
    const outcome = summary.outcome === "finished" && root.status === "failed" ? "failed" : summary.outcome;
    if (outcome !== "finished" && outcome !== "failed") continue;
    if (nodes.some((n) => ["unknown", "disconnected", "inactive", "archived"].includes(n.status))) continue;
    const key = `${root.id}:${outcome}:${root.startedAt ?? "unknown"}`;
    events.set(key, {
      key,
      title: outcome === "failed" ? "Orchestration failed" : "Orchestration finished",
      body: session.title,
      sources: [...new Set(nodes.map((n) => n.source))],
    });
  }
  return [...events.values()];
}
