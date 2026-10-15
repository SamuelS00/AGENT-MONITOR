import { describe, expect, it } from "vitest";
import { notificationsFor } from "./notifications";
import type { AgentNode, Dataset } from "./types";

const node = (id: string, status: AgentNode["status"], extra: Partial<AgentNode> = {}): AgentNode => ({
  id,
  sessionId: "fixture-root",
  label: id,
  tool: "Orca",
  role: "agent",
  status,
  model: { reliability: "unavailable" },
  tokens: { reliability: "unavailable" },
  waits: [],
  events: [],
  source: "fixture-metadata",
  relationship: "confirmed",
  ...extra,
});
const dataset = (status: AgentNode["status"], children: AgentNode[] = []): Dataset => ({
  kind: "live",
  observedAt: 100,
  projects: [],
  tools: [],
  history: [],
  sessions: [{ id: "fixture-session", rootId: "fixture-root", projectId: "fixture-project", title: "Fixture orchestration" }],
  nodes: [node("fixture-root", status, { level: "meta" }), ...children],
});

describe("notificationsFor", () => {
  it("never notifies on first load, newly discovered nodes, or sample data", () => {
    expect(notificationsFor(null, dataset("completed"))).toEqual([]);
    expect(notificationsFor(dataset("running"), dataset("running", [node("fixture-new", "waiting")]))).toEqual([]);
    expect(notificationsFor({ ...dataset("running"), kind: "sample" }, dataset("completed"))).toEqual([]);
    expect(notificationsFor(dataset("running"), { ...dataset("completed"), kind: "sample" })).toEqual([]);
  });

  it("does nothing when there is no change", () => {
    expect(notificationsFor(dataset("running"), dataset("running"))).toEqual([]);
    expect(notificationsFor(dataset("waiting"), dataset("waiting"))).toEqual([]);
  });

  it("reports a running orchestration finishing and retains source provenance", () => {
    expect(notificationsFor(dataset("running"), dataset("completed"))).toEqual([
      {
        key: "fixture-root:finished:unknown",
        title: "Orchestration finished",
        body: "Fixture orchestration",
        sources: ["fixture-metadata"],
      },
    ]);
  });

  it("reports both root and worker failures", () => {
    expect(notificationsFor(dataset("running"), dataset("failed"))[0]?.title).toBe("Orchestration failed");
    const worker = (status: AgentNode["status"]) => node("fixture-worker", status, { parentId: "fixture-root", level: "agent" });
    expect(notificationsFor(dataset("idle", [worker("running")]), dataset("idle", [worker("failed")]))[0]?.title).toBe(
      "Orchestration failed",
    );
    expect(notificationsFor(dataset("running", [worker("running")]), dataset("failed", [worker("running")]))).toEqual([]);
  });

  it("reports any existing agent entering Needs input, even outside an orchestration", () => {
    const before = dataset("running");
    before.nodes[0].tool = "Codex";
    before.nodes[0].level = undefined;
    const next = { ...before, nodes: [{ ...before.nodes[0], status: "waiting" as const }] };
    expect(notificationsFor(before, next)[0]?.title).toBe("Needs input");
  });

  it("does not repeat events on consecutive refreshes and deduplicates duplicate session rows", () => {
    const finished = dataset("completed");
    finished.sessions.push(finished.sessions[0]);
    expect(notificationsFor(dataset("running"), finished)).toHaveLength(1);
    expect(notificationsFor(finished, { ...finished, observedAt: 200 })).toEqual([]);
    expect(notificationsFor(dataset("waiting"), dataset("waiting"))).toEqual([]);
  });

  it("distinguishes a new wait after an agent resumes", () => {
    const first = dataset("waiting");
    const resumed = dataset("running");
    const second = { ...dataset("waiting"), observedAt: 200 };
    const initial = notificationsFor(dataset("running"), first)[0];
    expect(notificationsFor(first, resumed)).toEqual([]);
    expect(notificationsFor(resumed, second)[0].key).not.toBe(initial.key);
  });

  it("does not invent completion from errors, missing workers or unavailable states", () => {
    for (const status of ["unknown", "disconnected", "inactive", "archived"] as const) {
      expect(notificationsFor(dataset("running"), dataset(status))).toEqual([]);
    }
    expect(notificationsFor(dataset("running"), { ...dataset("completed"), collectorError: "fixture error" })).toEqual([]);
    expect(
      notificationsFor(dataset("running", [node("fixture-worker", "running", { parentId: "fixture-root" })]), dataset("idle")),
    ).toEqual([]);
    const plain = dataset("completed");
    plain.nodes[0].level = undefined;
    plain.nodes[0].tool = "Codex";
    expect(notificationsFor(dataset("running"), plain)).toEqual([]);
  });
});
