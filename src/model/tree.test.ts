// Tests for the tree index and usage rollups. All nodes are synthetic fixtures
// (ids prefixed with "fixture-"). They guard the rollup invariants: each
// agent's own usage counts exactly once, and missing data stays explicit
// instead of becoming a fabricated total.
import { describe, expect, it } from "vitest";
import { buildIndex, durationMs, endOf, rollupTokens, type TreeIndex } from "./tree";
import { confirmed, estimated, unavailable } from "./format";
import type { AgentNode } from "./types";

const node = (over: Partial<AgentNode> & Pick<AgentNode, "id" | "label">): AgentNode => ({
  sessionId: "fixture-session",
  role: "agent",
  tool: "Codex",
  model: unavailable("no model reported"),
  status: "running",
  waits: [],
  tokens: unavailable("no usage reported"),
  events: [],
  source: "fixture transcript",
  relationship: over.relationship ?? "confirmed",
  ...over,
});

function index(...nodes: AgentNode[]): TreeIndex {
  return buildIndex(nodes);
}

describe("rollupTokens", () => {
  it("sums each agent's own usage once across the subtree", () => {
    const idx = index(
      node({ id: "fixture-root", label: "Root", tokens: confirmed(100, "transcript") }),
      node({
        id: "fixture-child-a",
        parentId: "fixture-root",
        label: "Child A",
        tokens: confirmed(50, "transcript"),
      }),
      node({
        id: "fixture-grandchild",
        parentId: "fixture-child-a",
        label: "Grandchild",
        tokens: estimated(25, "estimated"),
      }),
    );
    const roll = rollupTokens(idx, "fixture-root");
    expect(roll.tokens.value).toBe(175);
    expect(roll.tokens.reliability).toBe("inferred");
    expect(roll.withData).toBe(3);
    expect(roll.partial).toBe(false);
  });

  it("flags partial rollups when a node reports no usage", () => {
    const idx = index(
      node({ id: "fixture-root", label: "Root", tokens: confirmed(100, "transcript") }),
      node({ id: "fixture-child-b", parentId: "fixture-root", label: "Child B", tokens: unavailable("no usage reported") }),
    );
    const roll = rollupTokens(idx, "fixture-root");
    expect(roll.partial).toBe(true);
    expect(roll.nodes).toBe(2);
    expect(roll.withData).toBe(1);
  });

  it("stays unavailable when no node in the subtree has usage", () => {
    const idx = index(node({ id: "fixture-root", label: "Root" }));
    const roll = rollupTokens(idx, "fixture-root");
    expect(roll.tokens.reliability).toBe("unavailable");
    expect(roll.tokens.value).toBeUndefined();
  });
});

describe("durationMs", () => {
  const now = 1_000_000;

  it("never invents an end time for finished nodes without one", () => {
    const n = node({ id: "fixture-done", label: "Done", status: "completed", startedAt: 900_000 });
    const d = durationMs(n, now);
    expect(d.reliability).toBe("unavailable");
    expect(d.value).toBeUndefined();
  });

  it("uses the recorded end for finished nodes", () => {
    const n = node({ id: "fixture-done-2", label: "Done", status: "completed", startedAt: 900_000, endedAt: 950_000 });
    expect(durationMs(n, now)).toEqual({ value: 50_000, reliability: "confirmed", source: "fixture transcript" });
  });

  it("measures elapsed time for active nodes", () => {
    const n = node({ id: "fixture-live", label: "Live", status: "running", startedAt: 900_000 });
    expect(durationMs(n, now).value).toBe(100_000);
  });

  it("stops the clock at the last recorded activity once a node is not running", () => {
    for (const status of ["idle", "inactive", "archived", "completed", "failed"] as const) {
      const n = node({ id: `fixture-${status}`, label: status, status, startedAt: 900_000, lastActivityAt: 930_000 });
      const d = durationMs(n, now);
      expect(d.value, status).toBe(30_000);
      expect(d.reliability, status).toBe("inferred");
      // The reading must not grow with the wall clock.
      expect(durationMs(n, now + 5_000_000).value, status).toBe(30_000);
    }
  });

  it("keeps counting only while running or waiting", () => {
    for (const status of ["running", "waiting"] as const) {
      const n = node({ id: `fixture-${status}`, label: status, status, startedAt: 900_000, lastActivityAt: 910_000 });
      expect(durationMs(n, now).value).toBe(100_000);
      expect(endOf(n, now)).toBe(now);
    }
  });

  it("stays unavailable when the start is unknown", () => {
    const n = node({ id: "fixture-nostart", label: "No start", status: "running" });
    expect(durationMs(n, now).reliability).toBe("unavailable");
  });
});

describe("buildIndex", () => {
  it("never creates delegation edges that are not in the data", () => {
    const idx = index(
      node({ id: "fixture-orphan", parentId: "fixture-missing", label: "Orphan" }),
      node({ id: "fixture-self", parentId: "fixture-self", label: "Self" }),
      node({ id: "fixture-real-root", label: "Root" }),
    );
    expect(idx.roots.map((n) => n.id).sort()).toEqual(["fixture-orphan", "fixture-real-root", "fixture-self"]);
    expect(idx.children.has("fixture-missing")).toBe(false);
  });
});
