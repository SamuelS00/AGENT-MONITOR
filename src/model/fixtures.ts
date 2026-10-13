/* SAMPLE DATA. Entirely fictional, used for the prototype and for browser preview.
   The UI labels it as "Sample data" whenever it is on screen. */
import type { AgentEvent, AgentNode, Dataset, DetectedTool, HistorySession, Metric, Project, Session, WaitSpan } from "./types";
import { confirmed, estimated, unavailable } from "./format";

const MIN = 60_000;

const sumMetric = (a?: Metric<number>, b?: Metric<number>): Metric<number> => {
  const parts = [a, b].filter((m): m is Metric<number> => !!m && m.reliability !== "unavailable");
  if (!parts.length) return unavailable();
  const v = parts.reduce((s, m) => s + (m.value ?? 0), 0);
  return parts.some((m) => m.reliability === "inferred") ? estimated(v, "estimate") : confirmed(v, "transcript");
};

interface Spec {
  id: string; parent?: string; session: string; label: string; role: AgentNode["role"]; tool: string;
  model?: string; status: AgentNode["status"]; start?: number; end?: number; waits?: [number, number | undefined, string][];
  tin?: number; tout?: number; est?: boolean; activity?: string; rel?: AgentNode["relationship"]; relNote?: string;
  tools?: string[]; error?: string; source?: string;
}

export function buildSample(now: number): Dataset {
  const ago = (m: number) => now - m * MIN;
  const specs: Spec[] = [
    // billing-api / Claude Code
    { id: "n1", session: "s1", label: "Orchestrator", role: "orchestrator", tool: "Claude Code", model: "claude-opus-5-5", status: "running", start: 14.5, tin: 182_400, tout: 24_800, activity: "Reviewing plan diff while 4 subagents run", tools: ["Read docs/queue-design.md", "TodoWrite 6 items"] },
    { id: "n2", parent: "n1", session: "s1", label: "Plan migration", role: "agent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "completed", start: 14, end: 10.8, tin: 61_000, tout: 9_200, tools: ["Read src/invoice/service.ts", "Write plan.md"] },
    { id: "n3", parent: "n2", session: "s1", label: "Scan call sites", role: "subagent", tool: "Claude Code", model: "claude-haiku-5-5", status: "completed", start: 13.8, end: 12.4, tin: 22_100, tout: 2_900, tools: ["Grep enqueueInvoice", "Grep InvoiceService"] },
    { id: "n4", parent: "n2", session: "s1", label: "Read queue config", role: "subagent", tool: "Claude Code", model: "claude-haiku-5-5", status: "completed", start: 13.8, end: 13.1, tin: 8_400, tout: 900, tools: ["Read config/queue.yml"] },
    { id: "n5", parent: "n1", session: "s1", label: "Refactor handlers", role: "agent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "running", start: 10.5, tin: 98_300, tout: 17_100, activity: "Editing src/invoice/handlers", tools: ["Edit handlers/index.ts", "Bash pnpm tsc --noEmit"] },
    { id: "n6", parent: "n5", session: "s1", label: "invoice.create", role: "subagent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "running", start: 9.8, tin: 41_200, tout: 6_300, activity: "Writing handlers/create.ts", tools: ["Edit handlers/create.ts"] },
    { id: "n7", parent: "n5", session: "s1", label: "invoice.refund", role: "subagent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "running", start: 9.8, tin: 36_900, tout: 5_100, activity: "Reading ledger/rounding.ts", tools: ["Read ledger/rounding.ts"] },
    { id: "n8", parent: "n7", session: "s1", label: "Ledger rounding check", role: "subagent", tool: "Claude Code", model: "claude-haiku-5-5", status: "running", start: 6.2, tin: 12_000, tout: 1_400, est: true, activity: "Running 14 property tests", tools: ["Bash pnpm vitest rounding"] },
    { id: "n9", parent: "n5", session: "s1", label: "invoice.void", role: "subagent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "waiting", start: 9.8, tin: 29_700, tout: 3_800, waits: [[5, undefined, "Tool permission: Bash(psql -c \"SELECT ...\")"]], activity: "Waiting for tool permission" },
    { id: "n10", parent: "n1", session: "s1", label: "Run test suite", role: "agent", tool: "Codex", status: "running", start: 3, rel: "inferred", relNote: "Linked by process ancestry only. No adapter confirms the orchestrator delegated this run.", source: "process tree", activity: "pnpm test --filter billing" },
    // billing-api / Codex
    { id: "m1", session: "s2", label: "Orchestrator", role: "orchestrator", tool: "Codex", model: "gpt-5.1-codex", status: "waiting", start: 22, tin: 74_000, tout: 11_300, waits: [[4, undefined, "Approval required: apply patch to 4 files"]], activity: "Waiting for patch approval" },
    { id: "m2", parent: "m1", session: "s2", label: "Trace retry scheduler", role: "agent", tool: "Codex", model: "gpt-5.1-codex", status: "completed", start: 21, end: 15, tin: 28_400, tout: 4_100, tools: ["rg retryWithBackoff", "sed -n 1,120p scheduler.ts"] },
    { id: "m3", parent: "m1", session: "s2", label: "Reproduce failure", role: "agent", tool: "Codex", model: "gpt-5.1-codex", status: "failed", start: 20, end: 17, tin: 15_200, tout: 1_900, error: "exit 1: 3 failing specs in webhook.retry.spec.ts" },
    // web-dashboard / OpenCode
    { id: "o1", session: "s3", label: "Orchestrator", role: "orchestrator", tool: "OpenCode", model: "qwen3-coder", status: "running", start: 31, tin: 120_500, tout: 18_900, est: true, activity: "Coordinating layout rebuild" },
    { id: "o2", parent: "o1", session: "s3", label: "Audit form components", role: "agent", tool: "OpenCode", model: "qwen3-coder", status: "completed", start: 30, end: 22, tin: 44_000, tout: 6_000, est: true },
    { id: "o3", parent: "o1", session: "s3", label: "Rebuild layout", role: "agent", tool: "OpenCode", model: "qwen3-coder", status: "running", start: 21, tin: 52_700, tout: 8_800, est: true, activity: "Editing SettingsLayout.tsx" },
    { id: "o4", parent: "o1", session: "s3", label: "Visual regression run", role: "agent", tool: "OpenCode", model: "qwen3-coder", status: "failed", start: 12, end: 9, tin: 9_100, tout: 700, est: true, error: "12 screenshots differ from baseline" },
    // web-dashboard / Gemini CLI
    { id: "g1", session: "s4", label: "Orchestrator", role: "orchestrator", tool: "Gemini CLI", status: "disconnected", start: 47, end: 38, source: "process tree" },
    // infra-terraform / Claude Code
    { id: "c1", session: "s5", label: "Orchestrator", role: "orchestrator", tool: "Claude Code", model: "claude-opus-5-5", status: "completed", start: 58, end: 41, tin: 96_000, tout: 12_400 },
    { id: "c2", parent: "c1", session: "s5", label: "Validate modules", role: "agent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "completed", start: 57, end: 50, tin: 33_000, tout: 3_900 },
    { id: "c3", parent: "c1", session: "s5", label: "Cost estimate", role: "agent", tool: "Claude Code", model: "claude-sonnet-5-5", status: "completed", start: 55, end: 44, tin: 27_000, tout: 5_100 },
  ];

  const nodes: AgentNode[] = specs.map((s) => {
    const startedAt = s.start !== undefined ? ago(s.start) : undefined;
    const endedAt = s.end !== undefined ? ago(s.end) : undefined;
    const waits: WaitSpan[] = (s.waits ?? []).map(([a, b, reason]) => ({ start: ago(a), end: b !== undefined ? ago(b) : undefined, reason }));
    const mk = (n?: number) => n === undefined ? unavailable<number>(s.source) : s.est ? estimated(n, "estimated from output size") : confirmed(n, "session transcript");
    const tokensIn = mk(s.tin), tokensOut = mk(s.tout);
    const events: AgentEvent[] = [];
    if (startedAt !== undefined) events.push({ at: startedAt, kind: "start", summary: s.parent ? "Started by parent" : "Session started" });
    (s.tools ?? []).forEach((t, i) => {
      const span = (endedAt ?? now) - (startedAt ?? now);
      events.push({ at: (startedAt ?? now) + span * ((i + 1) / ((s.tools?.length ?? 1) + 1)), kind: "tool", summary: t });
    });
    waits.forEach((w) => { events.push({ at: w.start, kind: "wait", summary: w.reason }); if (w.end) events.push({ at: w.end, kind: "resume", summary: "Resumed" }); });
    if (endedAt !== undefined) events.push({ at: endedAt, kind: s.status === "failed" ? "error" : s.status === "disconnected" ? "disconnect" : "complete", summary: s.error ?? (s.status === "disconnected" ? "Process no longer found" : "Completed") });
    return {
      id: s.id, parentId: s.parent, sessionId: s.session, label: s.label, role: s.role, tool: s.tool,
      model: s.model ? confirmed(s.model, "session transcript") : unavailable("no model reported"),
      status: s.status, startedAt, endedAt, waits,
      tokens: sumMetric(tokensIn, tokensOut), tokensIn, tokensOut, activity: s.activity,
      relationship: s.rel ?? "confirmed", relationshipNote: s.relNote, events, source: s.source ?? "session transcript",
    };
  });
  // Spawn events on parents, derived from confirmed child edges only.
  for (const n of nodes) {
    const p = nodes.find((x) => x.id === n.parentId);
    if (p && n.startedAt !== undefined && n.relationship === "confirmed") p.events.push({ at: n.startedAt, kind: "spawn", summary: `Spawned ${n.label}` });
  }
  nodes.forEach((n) => n.events.sort((a, b) => a.at - b.at));

  const projects: Project[] = [
    { id: "billing-api", name: "billing-api", path: "~/dev/billing-api" },
    { id: "web-dashboard", name: "web-dashboard", path: "~/dev/web-dashboard" },
    { id: "infra-terraform", name: "infra-terraform", path: "~/dev/infra-terraform" },
  ];
  const sessions: Session[] = [
    { id: "s1", projectId: "billing-api", title: "Migrate invoice service to async queue", rootId: "n1" },
    { id: "s2", projectId: "billing-api", title: "Fix flaky webhook retries", rootId: "m1" },
    { id: "s3", projectId: "web-dashboard", title: "Redesign settings page", rootId: "o1" },
    { id: "s4", projectId: "web-dashboard", title: "Explain build failure", rootId: "g1" },
    { id: "s5", projectId: "infra-terraform", title: "Plan VPC peering change", rootId: "c1" },
  ];

  const tools: DetectedTool[] = [
    { name: "Claude Code", version: "2.3.1", path: "~/.local/bin/claude", capabilities: { process: "confirmed", transcript: "confirmed", usage: "confirmed", hierarchy: "confirmed" } },
    { name: "Codex", version: "0.58.0", path: "/opt/homebrew/bin/codex", capabilities: { process: "confirmed", transcript: "confirmed", usage: "confirmed", hierarchy: "inferred" }, note: "Delegation is inferred from process ancestry." },
    { name: "OpenCode", version: "1.4.2", path: "~/.opencode/bin/opencode", capabilities: { process: "confirmed", transcript: "confirmed", usage: "inferred", hierarchy: "confirmed" }, note: "Token counts are estimated from output size." },
    { name: "Gemini CLI", version: "0.9.0", path: "/opt/homebrew/bin/gemini", capabilities: { process: "confirmed", transcript: "unavailable", usage: "unavailable", hierarchy: "unavailable" }, note: "Process discovery only." },
  ];

  return { kind: "sample", observedAt: now, projects, sessions, nodes, history: buildHistory(now), tools };
}

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function buildHistory(now: number): HistorySession[] {
  const r = rng(7);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const projects = ["billing-api", "billing-api", "web-dashboard", "web-dashboard", "infra-terraform", "docs-site", "mobile-app"];
  const toolModels: [string, string[]][] = [
    ["Claude Code", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]],
    ["Claude Code", ["claude-sonnet-5-5"]],
    ["Codex", ["gpt-5.1-codex"]],
    ["OpenCode", ["qwen3-coder", "claude-sonnet-5-5"]],
    ["Gemini CLI", ["gemini-3-pro"]],
  ];
  const titles = ["Add pagination to invoices endpoint", "Investigate memory leak in worker", "Upgrade React Router", "Write migration for ledger table", "Refactor auth middleware", "Document retry policy", "Fix timezone bug in reports", "Split monolith build step", "Audit unused dependencies", "Harden webhook signature check", "Port settings screen to new layout", "Tune Terraform module outputs", "Reproduce CI-only test failure", "Generate API client types", "Rename billing events"];
  const out: HistorySession[] = [];
  for (let i = 0; i < 84; i++) {
    const [tool, models] = pick(toolModels);
    const gemini = tool === "Gemini CLI";
    const startedAt = now - (0.5 + r() * 44) * 24 * 60 * MIN;
    const durationMs = Math.max(40_000, Math.exp(6.3 + r() * 3.4) * 1000 * (tool === "Claude Code" ? 1.2 : 1));
    const roll = r();
    const status = roll < 0.08 ? "failed" : roll < 0.12 ? "disconnected" : "completed";
    const tokenBase = Math.round(durationMs / 1000 * (40 + r() * 140));
    const tokens: Metric<number> = gemini || r() < 0.1 ? unavailable("no usage reported") : r() < 0.18 ? estimated(tokenBase, "estimated") : confirmed(tokenBase, "transcript");
    out.push({
      id: `h${i}`, project: pick(projects), title: pick(titles), tool,
      model: status === "disconnected" || gemini && r() < 0.5 ? unavailable() : confirmed(pick(models), "transcript"),
      startedAt, durationMs, status, tokens,
      agents: gemini ? unavailable() : confirmed(1 + Math.floor(r() * r() * 14), "transcript"),
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}
