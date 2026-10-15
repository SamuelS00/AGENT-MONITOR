import type { AgentNode } from "./types";
import { descendants, endOf, isLive, rollupTokens, type TreeIndex } from "./tree";

/** An orchestration is a session whose root coordinates others: a meta-orchestrator, or an Orca run with no coordinator
 *  found. Everything else is a plain session, however many subagents it happens to have. */
export const isOrchestration = (root: AgentNode) => root.level === "meta" || root.tool === "Orca";

const isOrcaWorker = (n: AgentNode) => n.tool === "Orca" && n.level !== undefined && n.level !== "meta";

export interface Attempt {
  /** 1-based position among the tries of the same task. */
  attempt: number;
  of: number;
}

/** Tries of one task under the same parent: Orca workers that share a parent and a name. The coordinator retried
 *  a task by starting a new dispatch for it, so the earlier try is superseded by the later one. */
export function attempts(index: TreeIndex, rootId: string): Map<string, Attempt> {
  const groups = new Map<string, AgentNode[]>();
  for (const n of descendants(index, rootId).filter(isOrcaWorker)) {
    const key = `${n.parentId}|${n.label}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out = new Map<string, Attempt>();
  for (const tries of groups.values()) {
    if (tries.length < 2) continue;
    tries.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id));
    tries.forEach((n, i) => out.set(n.id, { attempt: i + 1, of: tries.length }));
  }
  return out;
}

/** A try that a later try of the same task replaced. Its failure is history, not an open problem. */
export const isSuperseded = (a: Attempt | undefined) => !!a && a.attempt < a.of;

export type Outcome = "running" | "needs-input" | "failed" | "finished";

export interface OrchestrationSummary {
  orchestrators: number;
  agents: number;
  subagents: number;
  /** Failures nobody retried. */
  failed: number;
  /** Tries replaced by a later try of the same task. */
  retried: number;
  outcome: Outcome;
  tokens: ReturnType<typeof rollupTokens>;
}

export function summarize(index: TreeIndex, rootId: string): OrchestrationSummary {
  const below = descendants(index, rootId);
  const tries = attempts(index, rootId);
  const count = (level: AgentNode["level"]) => below.filter((n) => n.level === level).length;
  const retried = below.filter((n) => isSuperseded(tries.get(n.id))).length;
  const failed = below.filter((n) => n.status === "failed" && !isSuperseded(tries.get(n.id))).length;
  const all = [index.byId.get(rootId)!, ...below].filter(Boolean);
  const outcome: Outcome = all.some((n) => isLive(n.status) && n.status === "running")
    ? "running"
    : all.some((n) => n.status === "waiting")
      ? "needs-input"
      : failed > 0
        ? "failed"
        : "finished";
  return {
    orchestrators: count("orchestrator"),
    agents: count("agent"),
    subagents: count("subagent"),
    failed,
    retried,
    outcome,
    tokens: rollupTokens(index, rootId),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 orchestrators · 3 agents · 1 subagent", with failures and retries called out. Zero counts are left out. */
export function describe(s: OrchestrationSummary): string {
  return [
    s.orchestrators > 0 && plural(s.orchestrators, "orchestrator"),
    s.agents > 0 && plural(s.agents, "agent"),
    s.subagents > 0 && plural(s.subagents, "subagent"),
    s.failed > 0 && `${s.failed} failed`,
    s.retried > 0 && plural(s.retried, "retry", "retries"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** When a session last did anything: the latest recorded activity in its tree, else its start. */
export function lastActive(index: TreeIndex, rootId: string, now: number): number {
  const nodes = [index.byId.get(rootId), ...descendants(index, rootId)].filter((n): n is AgentNode => !!n);
  return Math.max(0, ...nodes.map((n) => endOf(n, now) ?? n.startedAt ?? 0));
}
