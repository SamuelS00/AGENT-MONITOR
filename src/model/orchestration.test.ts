// Tests for the orchestration view model. Every node is a synthetic fixture (ids prefixed "fixture-").
import { describe, expect, it } from "vitest";
import { attempts, describe as describeSummary, isOrchestration, isSuperseded, lastActive, modelsUsed, summarize } from "./orchestration";
import { buildIndex } from "./tree";
import { confirmed, unavailable } from "./format";
import type { AgentNode } from "./types";

const node = (over: Partial<AgentNode> & Pick<AgentNode, "id" | "label">): AgentNode => ({
  sessionId: "fixture-root",
  role: "agent",
  tool: "Orca",
  model: unavailable("none"),
  status: "completed",
  waits: [],
  tokens: unavailable("none"),
  events: [],
  source: "fixture",
  relationship: "confirmed",
  ...over,
});

const tree = () =>
  buildIndex([
    node({ id: "fixture-root", label: "meta", tool: "Codex", level: "meta", role: "meta", status: "idle", tokens: confirmed(100) }),
    node({ id: "fixture-orch-a", parentId: "fixture-root", label: "Orchestrator A", level: "orchestrator", role: "orchestrator" }),
    node({ id: "fixture-orch-b", parentId: "fixture-root", label: "Orchestrator B", level: "orchestrator", role: "orchestrator" }),
    // The same task tried twice under orchestrator A: the first try failed, the second succeeded.
    node({ id: "fixture-a1-try1", parentId: "fixture-orch-a", label: "Agent A1", level: "agent", status: "failed", startedAt: 1_000 }),
    node({ id: "fixture-a1-try2", parentId: "fixture-orch-a", label: "Agent A1", level: "agent", startedAt: 2_000, tokens: confirmed(50) }),
    node({ id: "fixture-b1", parentId: "fixture-orch-b", label: "Agent B1", level: "agent", status: "failed", startedAt: 3_000 }),
    node({ id: "fixture-sub", parentId: "fixture-a1-try2", label: "Explore", tool: "Claude Code", level: "subagent", role: "subagent" }),
  ]);

describe("isOrchestration", () => {
  it("is true for a meta-orchestrator or an Orca run, false for a plain session", () => {
    expect(isOrchestration(node({ id: "fixture-m", label: "m", tool: "Claude Code", level: "meta" }))).toBe(true);
    expect(isOrchestration(node({ id: "fixture-r", label: "run", tool: "Orca" }))).toBe(true);
    expect(isOrchestration(node({ id: "fixture-p", label: "plain", tool: "Codex" }))).toBe(false);
  });
});

describe("attempts", () => {
  it("numbers the tries of the same task under one parent and nothing else", () => {
    const tries = attempts(tree(), "fixture-root");
    expect(tries.get("fixture-a1-try1")).toEqual({ attempt: 1, of: 2, basis: "name" });
    expect(tries.get("fixture-a1-try2")).toEqual({ attempt: 2, of: 2, basis: "name" });
    expect(tries.has("fixture-b1")).toBe(false);
    expect(tries.has("fixture-orch-a")).toBe(false);
    expect(isSuperseded(tries.get("fixture-a1-try1"))).toBe(true);
    expect(isSuperseded(tries.get("fixture-a1-try2"))).toBe(false);
  });

  it("does not treat same-named workers under different parents as retries", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "meta", level: "meta" }),
      node({ id: "fixture-o1", parentId: "fixture-root", label: "O1", level: "orchestrator" }),
      node({ id: "fixture-o2", parentId: "fixture-root", label: "O2", level: "orchestrator" }),
      node({ id: "fixture-x1", parentId: "fixture-o1", label: "Same name", level: "agent", startedAt: 1 }),
      node({ id: "fixture-x2", parentId: "fixture-o2", label: "Same name", level: "agent", startedAt: 2 }),
    ]);
    expect(attempts(index, "fixture-root").size).toBe(0);
  });
});

describe("attempts (recorded retries)", () => {
  it("follows a recorded retry even when the names differ, and calls it recorded", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "meta", level: "meta" }),
      node({ id: "fixture-first", parentId: "fixture-root", label: "Build", level: "agent", status: "failed", startedAt: 1 }),
      node({
        id: "fixture-second",
        parentId: "fixture-root",
        label: "Build again",
        level: "agent",
        startedAt: 2,
        retryOf: "fixture-first",
      }),
      node({
        id: "fixture-third",
        parentId: "fixture-root",
        label: "Build once more",
        level: "agent",
        startedAt: 3,
        retryOf: "fixture-second",
      }),
    ]);
    const tries = attempts(index, "fixture-root");
    expect(tries.get("fixture-first")).toEqual({ attempt: 1, of: 3, basis: "recorded" });
    expect(tries.get("fixture-second")).toEqual({ attempt: 2, of: 3, basis: "recorded" });
    expect(tries.get("fixture-third")).toEqual({ attempt: 3, of: 3, basis: "recorded" });
  });

  it("ignores a retry link to a node that is not in the tree, and falls back to the name", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "meta", level: "meta" }),
      node({ id: "fixture-a", parentId: "fixture-root", label: "Same", level: "agent", startedAt: 1, retryOf: "fixture-gone" }),
      node({ id: "fixture-b", parentId: "fixture-root", label: "Same", level: "agent", startedAt: 2 }),
    ]);
    const tries = attempts(index, "fixture-root");
    expect(tries.get("fixture-a")?.basis).toBe("name");
    expect(tries.get("fixture-b")?.basis).toBe("name");
  });
});

describe("summarize", () => {
  it("counts levels, separates a retried failure from an open one, and sums tokens once", () => {
    const s = summarize(tree(), "fixture-root");
    expect([s.orchestrators, s.agents, s.subagents]).toEqual([2, 3, 1]);
    expect(s.retried).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.outcome).toBe("failed");
    expect(s.tokens.tokens.value).toBe(150);
    expect(describeSummary(s)).toBe("2 orchestrators · 3 agents · 1 subagent · 1 failed · 1 retry");
  });

  it("is finished when the only failure was retried", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "meta", level: "meta", status: "idle" }),
      node({ id: "fixture-t1", parentId: "fixture-root", label: "Task", level: "agent", status: "failed", startedAt: 1 }),
      node({ id: "fixture-t2", parentId: "fixture-root", label: "Task", level: "agent", startedAt: 2 }),
    ]);
    const s = summarize(index, "fixture-root");
    expect([s.failed, s.retried, s.outcome]).toEqual([0, 1, "finished"]);
  });

  it("reports running while any agent is running", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "meta", level: "meta", status: "idle" }),
      node({ id: "fixture-w", parentId: "fixture-root", label: "Worker", level: "agent", status: "running" }),
    ]);
    expect(summarize(index, "fixture-root").outcome).toBe("running");
  });
});

describe("overview tree models and activity", () => {
  it("deduplicates models across the full tree and preserves provenance and unknowns", () => {
    const root = node({ id: "fixture-root", label: "Meta", level: "meta", model: confirmed("gpt-6", "fixture root") });
    const unknown = node({ id: "fixture-unknown", parentId: root.id, label: "Missing" });
    const other = node({ id: "fixture-other", parentId: unknown.id, label: "Other", model: confirmed("opus", "fixture child") });
    const index = buildIndex([
      root,
      unknown,
      other,
      node({ id: "fixture-duplicate", parentId: root.id, label: "Duplicate", model: confirmed("gpt-6") }),
      node({ id: "fixture-missing", parentId: root.id, label: "Missing too" }),
      node({ id: "fixture-unrelated", label: "Separate", model: confirmed("unrelated") }),
    ]);
    const models = modelsUsed(index, root.id);
    expect(models).toHaveLength(3);
    expect(models).toContain(root);
    expect(models).toContain(other);
    expect(models.filter((n) => n.model.reliability === "unavailable")).toHaveLength(1);
    expect(modelsUsed(index, "absent")).toEqual([]);
  });

  it("finds activity in descendants, falls back to starts and leaves absent activity unknown", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "Meta", startedAt: 10 }),
      node({ id: "fixture-child", parentId: "fixture-root", label: "Child", startedAt: 20, lastActivityAt: 80 }),
      node({ id: "fixture-unknown", label: "Unknown" }),
    ]);
    expect(lastActive(index, "fixture-root", 100)).toBe(80);
    expect(lastActive(index, "fixture-unknown", 100)).toBe(0);
  });
});
