import type { AgentNode } from "../model/types";
export type Brand = "anthropic" | "openai" | "google" | "opencode" | "unknown";

export const BRAND_COLOR: Record<Brand, string> = {
  anthropic: "#d97757",
  openai: "#10a37f",
  google: "#4285f4",
  opencode: "#8b8b94",
  unknown: "#8b8b94",
};
export const BRAND_NAME: Record<Brand, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  opencode: "OpenCode",
  unknown: "Unknown provider",
};

/** Presentation only: the recorded provider wins; the model id and tool name are fallbacks for the color/logo. */
export function brandOf(provider: string | undefined, model: string | undefined, tool: string): Brand {
  const p = (provider ?? "").toLowerCase();
  if (p.includes("anthropic")) return "anthropic";
  if (p.includes("openai")) return "openai";
  if (p.includes("google") || p.includes("gemini")) return "google";
  const m = (model ?? "").toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (/^(gpt|o\d|codex)/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "google";
  const t = tool.toLowerCase();
  if (t.includes("claude")) return "anthropic";
  if (t.includes("codex")) return "openai";
  if (t.includes("gemini")) return "google";
  if (t.includes("opencode") || p === "opencode") return "opencode";
  return "unknown";
}

/** Split a model id into a display name and a version. Display formatting only; the full id stays in the tooltip. */
export function splitModel(id: string): { name: string; version?: string } {
  const tokens = id
    .replace(/^(anthropic|openai|google)[/:]/i, "")
    .split(/[-_]/)
    .filter(Boolean);
  const isNum = (t: string) => /^\d{1,2}$/.test(t) || /^\d{1,2}\.\d{1,2}$/.test(t);
  const isDate = (t: string) => /^\d{8}$/.test(t);
  const nums: string[] = [];
  const words: string[] = [];
  for (const t of tokens) {
    if (isDate(t)) continue;
    if (isNum(t) && nums.length < 2 && (nums.length === 0 || words.length === 0 || tokens.indexOf(t) > 0)) nums.push(t);
    else words.push(t);
  }
  const version = nums.length ? nums.join(".") : undefined;
  const cased = words.filter((w) => w !== "latest").map((w) => (w === "gpt" ? "GPT" : w[0].toUpperCase() + w.slice(1)));
  const dropPrefix = cased[0] === "Claude" && cased.length > 1 ? cased.slice(1) : cased;
  return { name: dropPrefix.join(" ") || id, version };
}

/** Brand color of the model a node ran, or undefined when the model is unavailable (never guessed from the tool alone). */
export function nodeBrandColor(node: Pick<AgentNode, "model" | "provider" | "tool">): string | undefined {
  if (node.model.reliability === "unavailable" || !node.model.value) return undefined;
  return BRAND_COLOR[brandOf(node.provider?.value, node.model.value, node.tool)];
}
