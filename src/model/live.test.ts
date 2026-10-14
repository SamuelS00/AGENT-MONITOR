// Tests for the adapter from the collector contract to the UI model. Every
// snapshot is a synthetic fixture (ids prefixed with "fixture-"); no assertion
// depends on real collector data. They guard the invariant from AGENTS.md:
// unavailable metrics must stay unavailable — never coerced to zero.
import { describe, expect, it } from "vitest";
import { datasetFromSnapshot } from "./live";
import type { ExecutionNode, MonitorSnapshot, ObservedProcess } from "../types";

const fixtureProcess: ObservedProcess = {
  id: "fixture-process:421:1700000000",
  pid: 421,
  tool: "Codex",
  command: "codex",
  startedAt: "2026-01-01T00:00:00.000Z",
  projectPath: "/fixture/project",
  status: "running",
  reliability: "confirmed",
};

const fixtureSnapshot = (
  executions: ExecutionNode[],
  processes: ObservedProcess[] = [fixtureProcess],
  collectorError?: string,
): MonitorSnapshot => ({ observedAt: "2026-01-01T00:00:00.000Z", processes, executions, collectorError });

describe("datasetFromSnapshot", () => {
  it("keeps missing model and tokens unavailable instead of inventing values", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([{ id: "fixture-execution:1", label: "Fixture run", tool: "Codex", status: "running", relationship: "confirmed" }]),
    );
    const node = dataset.nodes[0];
    expect(node.model.reliability).toBe("unavailable");
    expect(node.model.value).toBeUndefined();
    expect(node.tokens.reliability).toBe("unavailable");
    expect(node.tokens.value).toBeUndefined();
  });

  it("carries confirmed usage with its source and reliability", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([
        {
          id: "fixture-execution:2",
          label: "Fixture linked run",
          tool: "Claude Code",
          status: "running",
          relationship: "confirmed",
          model: "fixture-model-x",
          modelReliability: "confirmed",
          tokens: 1234,
          tokensIn: 1000,
          tokensOut: 234,
          usageReliability: "confirmed",
          usageSource: "fixture transcript",
        },
      ]),
    );
    const node = dataset.nodes[0];
    expect(node.model).toEqual({ value: "fixture-model-x", reliability: "confirmed", source: "fixture transcript" });
    expect(node.tokens.value).toBe(1234);
    expect(node.tokens.reliability).toBe("confirmed");
    expect(node.tokensIn?.value).toBe(1000);
    expect(node.tokensOut?.value).toBe(234);
  });

  it("marks inferred relationships with an explicit note", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([
        { id: "fixture-execution:3", label: "Fixture inferred run", tool: "Codex", status: "running", relationship: "inferred" },
      ]),
    );
    expect(dataset.nodes[0].relationship).toBe("inferred");
    expect(dataset.nodes[0].relationshipNote).toContain("not confirmed");
  });

  it("resolves the session root through the parent chain", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([
        { id: "fixture-execution:root", label: "Fixture root", tool: "Codex", status: "running", relationship: "confirmed" },
        {
          id: "fixture-execution:child",
          parentId: "fixture-execution:root",
          label: "Fixture child",
          tool: "Codex",
          status: "running",
          relationship: "confirmed",
        },
      ]),
    );
    expect(dataset.nodes[1].sessionId).toBe("fixture-execution:root");
    expect(dataset.nodes[1].role).toBe("agent");
    expect(dataset.sessions.map((s) => s.id)).toEqual(["fixture-execution:root"]);
  });

  it("passes collector errors through instead of swallowing them", () => {
    const dataset = datasetFromSnapshot(fixtureSnapshot([], [], "fixture: collector offline"));
    expect(dataset.collectorError).toBe("fixture: collector offline");
  });

  it("groups services apart from projects and uses the project recorded by the session", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([
        {
          id: "fixture-execution:svc",
          processId: fixtureProcess.id,
          role: "service",
          label: "Codex server",
          tool: "Codex",
          status: "running",
          relationship: "confirmed",
        },
        {
          id: "fixture-execution:s1",
          role: "session",
          projectPath: "/fixture/other",
          label: "other",
          tool: "Codex",
          status: "unknown",
          relationship: "unavailable",
        },
        { id: "fixture-execution:s2", label: "orphan", tool: "Codex", status: "unknown", relationship: "unavailable" },
      ]),
    );
    const projectOf = (id: string) => dataset.sessions.find((s) => s.id === id)?.projectId;
    expect(projectOf("fixture-execution:svc")).toBe("services");
    expect(projectOf("fixture-execution:s1")).toBe("/fixture/other");
    expect(projectOf("fixture-execution:s2")).toBe("unknown");
    expect(dataset.projects.find((p) => p.id === "unknown")?.name).toBe("No working directory");
  });

  it("reports usage capability only when a session actually has usage", () => {
    const withUsage = datasetFromSnapshot(
      fixtureSnapshot([
        {
          id: "fixture-execution:u",
          label: "u",
          tool: "Codex",
          status: "running",
          relationship: "confirmed",
          tokens: 5,
          usageReliability: "confirmed",
        },
      ]),
    );
    expect(withUsage.tools[0].capabilities.usage).toBe("confirmed");
    const without = datasetFromSnapshot(
      fixtureSnapshot([{ id: "fixture-execution:n", label: "n", tool: "Codex", status: "running", relationship: "confirmed" }]),
    );
    expect(without.tools[0].capabilities.usage).toBe("unavailable");
  });

  it("nests recorded subagents under their session and keeps inactive sessions out of the active count", () => {
    const dataset = datasetFromSnapshot(
      fixtureSnapshot([
        { id: "fixture-execution:main", label: "main", tool: "Claude Code", status: "running", relationship: "confirmed" },
        {
          id: "fixture-execution:sub",
          parentId: "fixture-execution:main",
          label: "Explore",
          tool: "Claude Code",
          status: "inactive",
          relationship: "confirmed",
        },
        {
          id: "fixture-execution:deep",
          parentId: "fixture-execution:main",
          label: "general-purpose",
          tool: "Claude Code",
          status: "idle",
          relationship: "inferred",
        },
      ]),
    );
    expect(dataset.sessions).toHaveLength(1);
    const byId = new Map(dataset.nodes.map((n) => [n.id, n]));
    expect(byId.get("fixture-execution:sub")?.role).toBe("agent");
    expect(byId.get("fixture-execution:sub")?.status).toBe("inactive");
    expect(byId.get("fixture-execution:sub")?.relationshipNote).toBeUndefined();
    expect(byId.get("fixture-execution:deep")?.relationshipNote).toContain("not confirmed");
  });
});
