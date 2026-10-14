import type { AgentNode, AgentStatus, Metric } from "./types";
import { confirmed, estimated, unavailable } from "./format";

export interface TreeIndex {
  byId: Map<string, AgentNode>;
  children: Map<string, AgentNode[]>;
  roots: AgentNode[];
}

export function buildIndex(nodes: AgentNode[]): TreeIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, AgentNode[]>();
  const roots: AgentNode[] = [];
  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId) && n.parentId !== n.id) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    } else roots.push(n);
  }
  const byStart = (a: AgentNode, b: AgentNode) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity);
  children.forEach((list) => list.sort(byStart));
  roots.sort(byStart);
  return { byId, children, roots };
}

export interface Row {
  node: AgentNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  lastFlags: boolean[];
}

/** Flatten to visible rows. `visited` guards against cycles in malformed collector data. */
export function visibleRows(index: TreeIndex, rootId: string | undefined, expanded: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const visited = new Set<string>();
  const walk = (node: AgentNode, depth: number, lastFlags: boolean[]) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const kids = index.children.get(node.id) ?? [];
    const open = expanded.has(node.id);
    out.push({ node, depth, hasChildren: kids.length > 0, open, lastFlags });
    if (open) kids.forEach((k, i) => walk(k, depth + 1, [...lastFlags, i === kids.length - 1]));
  };
  const root = rootId ? index.byId.get(rootId) : undefined;
  (root ? [root] : index.roots).forEach((r) => walk(r, 0, []));
  return out;
}

export function descendants(index: TreeIndex, id: string): AgentNode[] {
  const out: AgentNode[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(index.children.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    stack.push(...(index.children.get(n.id) ?? []));
  }
  return out;
}

export function ancestors(index: TreeIndex, id: string): AgentNode[] {
  const out: AgentNode[] = [];
  let cur = index.byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = index.byId.get(cur.parentId);
    if (cur) out.unshift(cur);
  }
  return out;
}

export interface Rollup {
  tokens: Metric<number>;
  /** true when at least one node in the subtree has no token data, so the sum is a lower bound. */
  partial: boolean;
  nodes: number;
  withData: number;
}

/** Sum of each node's OWN usage across the subtree. Parents never include child usage, so nothing is double counted. */
export function rollupTokens(index: TreeIndex, id: string): Rollup {
  const self = index.byId.get(id);
  const all = self ? [self, ...descendants(index, id)] : [];
  let sum = 0,
    withData = 0,
    inferred = false;
  for (const n of all) {
    if (n.tokens.reliability === "unavailable" || n.tokens.value === undefined) continue;
    withData++;
    sum += n.tokens.value;
    if (n.tokens.reliability === "inferred") inferred = true;
  }
  const partial = withData < all.length;
  const tokens: Metric<number> = withData === 0 ? unavailable("rollup") : inferred ? estimated(sum, "rollup") : confirmed(sum, "rollup");
  return { tokens, partial, nodes: all.length, withData };
}

/** Only these keep the clock running. Anything else stopped counting at its last recorded activity. */
export const isLive = (s: AgentStatus) => s === "running" || s === "waiting";

/** Where a node's span ends: the recorded end, "now" while live, otherwise its last recorded activity. */
export function endOf(n: AgentNode, now: number): number | undefined {
  if (n.endedAt !== undefined) return n.endedAt;
  if (isLive(n.status)) return now;
  const last = n.lastActivityAt;
  if (last !== undefined && (n.startedAt === undefined || last >= n.startedAt)) return last;
  return n.status === "idle" ? now : undefined;
}

export function durationMs(n: AgentNode, now: number): Metric<number> {
  if (n.startedAt === undefined) return unavailable();
  if (n.endedAt !== undefined) return confirmed(n.endedAt - n.startedAt, n.source);
  if (isLive(n.status)) return confirmed(now - n.startedAt, n.source);
  // Not running: the clock stops at the last recorded activity. That is a lower bound, not a recorded end.
  const end = endOf(n, now);
  if (end !== undefined && n.lastActivityAt !== undefined) return estimated(end - n.startedAt, "last recorded activity");
  return unavailable(n.source); // finished or lost with no recorded end: do not invent one
}

/** Ids of siblings whose active intervals overlap another sibling's. */
export function parallelIds(siblings: AgentNode[], now: number): Set<string> {
  const out = new Set<string>();
  const iv = siblings.filter((s) => s.startedAt !== undefined).map((s) => ({ id: s.id, a: s.startedAt!, b: s.endedAt ?? now }));
  for (let i = 0; i < iv.length; i++)
    for (let j = i + 1; j < iv.length; j++)
      if (iv[i].a < iv[j].b && iv[j].a < iv[i].b) {
        out.add(iv[i].id);
        out.add(iv[j].id);
      }
  return out;
}

export function sessionStatus(index: TreeIndex, rootId: string): AgentStatus {
  const root = index.byId.get(rootId);
  if (!root) return "unknown";
  const all = [root, ...descendants(index, rootId)];
  if (all.some((n) => n.status === "running")) return "running";
  if (all.some((n) => n.status === "waiting")) return "waiting";
  return root.status;
}

/** Step series of concurrently running agents (waiting spans excluded). */
export function concurrency(nodes: AgentNode[], now: number): { t: number; n: number }[] {
  const ev: { t: number; d: number }[] = [];
  for (const n of nodes) {
    if (n.startedAt === undefined) continue;
    const end = endOf(n, now) ?? n.startedAt;
    ev.push({ t: n.startedAt, d: 1 }, { t: end, d: -1 });
    for (const w of n.waits) {
      ev.push({ t: w.start, d: -1 }, { t: Math.min(w.end ?? end, end), d: 1 });
    }
  }
  ev.sort((a, b) => a.t - b.t || a.d - b.d);
  const out: { t: number; n: number }[] = [];
  let c = 0;
  for (const e of ev) {
    c += e.d;
    out.push({ t: e.t, n: Math.max(0, c) });
  }
  return out;
}
