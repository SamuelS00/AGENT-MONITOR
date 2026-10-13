import type { AgentNode } from "../model/types";
import { BRAND_PATHS } from "./brandIcons";

export type Brand = "anthropic" | "openai" | "google" | "opencode" | "unknown";

const BRAND_COLOR: Record<Brand, string> = {
  anthropic: "#d97757",
  openai: "#10a37f",
  google: "#4285f4",
  opencode: "#8b8b94",
  unknown: "#8b8b94",
};
const BRAND_NAME: Record<Brand, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", opencode: "OpenCode", unknown: "Unknown provider" };

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
  const tokens = id.replace(/^(anthropic|openai|google)[/:]/i, "").split(/[-_]/).filter(Boolean);
  const isNum = (t: string) => /^\d{1,2}$/.test(t) || /^\d{1,2}\.\d{1,2}$/.test(t);
  const isDate = (t: string) => /^\d{8}$/.test(t);
  const nums: string[] = [];
  const words: string[] = [];
  for (const t of tokens) {
    if (isDate(t)) continue;
    if (isNum(t) && nums.length < 2 && (nums.length === 0 || words.length === 0 || tokens.indexOf(t) > 0)) nums.push(t); else words.push(t);
  }
  const version = nums.length ? nums.join(".") : undefined;
  const cased = words.filter((w) => w !== "latest").map((w) => (w === "gpt" ? "GPT" : w[0].toUpperCase() + w.slice(1)));
  const dropPrefix = cased[0] === "Claude" && cased.length > 1 ? cased.slice(1) : cased;
  return { name: dropPrefix.join(" ") || id, version };
}

function Logo({ brand, size }: { brand: Brand; size: number }) {
  const paths = brand === "unknown" ? undefined : BRAND_PATHS[brand];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor" fillRule="evenodd">
      {paths ? paths.map((d, k) => <path key={k} d={d} />) : <path d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 2v14h14V5H5zm3 6h8v2H8v-2z" />}
    </svg>
  );
}

/** Provider-colored badge: logo, model name, version and reasoning effort. Unavailable parts are omitted, never invented. */
export function ModelBadge({ node, compact = false }: { node: Pick<AgentNode, "model" | "provider" | "effort" | "tool">; compact?: boolean }) {
  const model = node.model.reliability !== "unavailable" ? node.model.value : undefined;
  if (!model) return <span className="val val-na" title={`Unavailable${node.model.source ? ` · ${node.model.source}` : ""}`} aria-label="Model unavailable">—</span>;
  const brand = brandOf(node.provider?.value, model, node.tool);
  const { name, version } = splitModel(model);
  const effort = node.effort?.reliability !== "unavailable" ? node.effort?.value : undefined;
  const estimated = node.model.reliability === "inferred";
  const title = `${model}${node.provider?.value ? ` · provider ${node.provider.value}` : ` · ${BRAND_NAME[brand]} (from model name)`}${effort ? ` · effort ${effort}` : ""}${estimated ? " · inferred" : ""}`;
  return (
    <span className={`mbadge ${compact ? "mbadge-compact" : ""}`} style={{ ["--brand" as string]: BRAND_COLOR[brand] }} title={title}>
      <Logo brand={brand} size={compact ? 11 : 12} />
      {estimated && <span aria-hidden>≈</span>}
      <span className="mbadge-name">{name}</span>
      {version && <span className="mbadge-ver">v{version}</span>}
      {effort && <span className="mbadge-eff">{effort}</span>}
    </span>
  );
}
