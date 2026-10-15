import type { Metric } from "./types";
import { describe, summarize, attempts, isSuperseded } from "./orchestration";
import { durationMs, rollupTokens, type TreeIndex } from "./tree";
import type { AgentNode } from "./types";

type ExportMetric<T> = { value: T | "unavailable"; reliability: Metric<T>["reliability"]; source: string | "unavailable" };
export interface ExportNode {
  level: string;
  label: string;
  tool: string;
  model: ExportMetric<string>;
  status: string;
  duration: ExportMetric<number>;
  tokens: ExportMetric<number>;
  tokensIn: ExportMetric<number>;
  tokensOut: ExportMetric<number>;
  taskTitle: string | "unavailable";
  tryNumber: string | "unavailable";
  children: ExportNode[];
}
export interface OrchestrationExport {
  outcome: string;
  counts: string;
  tree: ExportNode;
}

const unavailable = <T>(source?: string): ExportMetric<T> => ({
  value: "unavailable",
  reliability: "unavailable",
  source: source ?? "unavailable",
});
const metric = <T>(m?: Metric<T>): ExportMetric<T> =>
  m?.value !== undefined ? { value: m.value, reliability: m.reliability, source: m.source ?? "unavailable" } : unavailable(m?.source);

function nodeExport(n: AgentNode, index: TreeIndex, now: number, tryMap: ReturnType<typeof attempts>): ExportNode {
  const attempt = tryMap.get(n.id);
  return {
    level: n.level ?? "unavailable",
    label: n.label,
    tool: n.tool,
    model: metric(n.model),
    status: n.status,
    duration: metric(durationMs(n, now)),
    tokens: metric(rollupTokens(index, n.id).tokens),
    tokensIn: metric(n.tokensIn),
    tokensOut: metric(n.tokensOut),
    taskTitle: n.activity ?? "unavailable",
    tryNumber: attempt
      ? `${attempt.attempt} of ${attempt.of}${attempt.basis === "name" ? " (inferred)" : ""}${isSuperseded(attempt) ? " (superseded)" : ""}`
      : "unavailable",
    children: (index.children.get(n.id) ?? []).map((child) => nodeExport(child, index, now, tryMap)),
  };
}

export function buildOrchestrationExport(index: TreeIndex, rootId: string, now: number): OrchestrationExport | undefined {
  const root = index.byId.get(rootId);
  if (!root) return undefined;
  const summary = summarize(index, rootId);
  return {
    outcome: summary.outcome,
    counts: describe(summary) || "No agents",
    tree: nodeExport(root, index, now, attempts(index, rootId)),
  };
}

export function renderOrchestrationJson(data: OrchestrationExport): string {
  return JSON.stringify(data, null, 2);
}

export function renderOrchestrationMarkdown(data: OrchestrationExport): string {
  const lines = [`# Orchestration`, ``, `Outcome: ${data.outcome}`, `Counts: ${data.counts}`, ``, `## Tree`];
  const walk = (n: ExportNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const fields = [
      `${n.label} (${n.level}; ${n.tool}; ${n.status})`,
      `model: ${show(n.model)}`,
      `duration: ${show(n.duration)}`,
      `tokens: ${show(n.tokens)}`,
      `tokens in: ${show(n.tokensIn)}`,
      `tokens out: ${show(n.tokensOut)}`,
      `task: ${n.taskTitle}`,
      `try: ${n.tryNumber}`,
    ];
    lines.push(`${indent}- ${fields.join("; ")}`);
    n.children.forEach((child) => walk(child, depth + 1));
  };
  walk(data.tree, 0);
  return lines.join("\n");
}
function show<T>(m: ExportMetric<T>): string {
  return `${m.value === "unavailable" ? "unavailable" : String(m.value)} [${m.reliability}; source: ${m.source}]`;
}
