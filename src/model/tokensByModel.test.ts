import { describe, expect, it } from "vitest";
import { buildIndex } from "./tree";
import { confirmed, estimated, unavailable } from "./format";
import type { AgentNode } from "./types";
import { tokensByModel } from "./orchestration";

const node = (over: Partial<AgentNode> & Pick<AgentNode, "id" | "label">): AgentNode => ({
  sessionId: "fixture-session",
  role: "agent",
  tool: "Codex",
  model: unavailable("fixture model unavailable"),
  status: "completed",
  waits: [],
  tokens: unavailable("fixture usage unavailable"),
  events: [],
  source: "fixture transcript",
  relationship: "confirmed",
  ...over,
});

describe("tokensByModel", () => {
  it("counts each node's own usage once without adding parent rollups", () => {
    const index = buildIndex([
      node({
        id: "fixture-root",
        label: "root",
        model: confirmed("gpt-5"),
        tokens: confirmed(700),
        tokensIn: confirmed(500),
        tokensOut: confirmed(200),
      }),
      node({
        id: "fixture-child",
        label: "child",
        parentId: "fixture-root",
        model: confirmed("gpt-5"),
        tokens: confirmed(120),
        tokensIn: confirmed(80),
        tokensOut: confirmed(40),
      }),
      node({ id: "fixture-other", label: "other", parentId: "fixture-root", model: confirmed("claude-sonnet"), tokens: confirmed(30) }),
    ]);
    const result = tokensByModel(index, "fixture-root");
    expect(result.models.find((m) => m.modelId === "gpt-5")).toMatchObject({ nodes: 2, total: { value: 820 } });
    expect(result.models.find((m) => m.modelId === "gpt-5")?.tokensIn.value).toBe(580);
    expect(result.models.find((m) => m.modelId === "claude-sonnet")?.total.value).toBe(30);
  });

  it("counts nodes with unavailable model or tokens separately and never as zero", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "root", model: confirmed("gpt-5"), tokens: confirmed(12) }),
      node({ id: "fixture-no-model", label: "no model", parentId: "fixture-root", tokens: confirmed(5) }),
      node({ id: "fixture-no-tokens", label: "no tokens", parentId: "fixture-root", model: confirmed("gpt-5") }),
    ]);
    const result = tokensByModel(index, "fixture-root");
    expect(result.unavailableNodes).toBe(2);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].total.value).toBe(12);
  });

  it("preserves inferred reliability in model groups", () => {
    const index = buildIndex([
      node({ id: "fixture-root", label: "root", model: confirmed("gpt-5"), tokens: confirmed(10) }),
      node({
        id: "fixture-child",
        label: "child",
        parentId: "fixture-root",
        model: estimated("gpt-5", "guess"),
        tokens: estimated(3, "estimate"),
      }),
    ]);
    const group = tokensByModel(index, "fixture-root").models[0];
    expect(group.model.reliability).toBe("inferred");
    expect(group.total).toMatchObject({ value: 13, reliability: "inferred" });
  });
});
