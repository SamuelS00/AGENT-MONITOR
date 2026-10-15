import type { AgentNode } from "./types";

/** Recent recorded call, never a claim that the call is still executing. */
export function toolInUse(node: AgentNode, now: number): string | undefined {
  const at = node.lastToolAt;
  if (node.status !== "running" || at === undefined || !Number.isFinite(at) || now < at || now - at >= 120_000) return undefined;
  const tool = node.lastTool;
  if (!tool?.value || tool.reliability === "unavailable") return undefined;
  return `${tool.reliability === "inferred" ? "≈ " : ""}using ${tool.value}`;
}
