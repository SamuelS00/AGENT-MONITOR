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
});
