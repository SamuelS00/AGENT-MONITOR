import { describe, expect, it } from "vitest";
import { toolInUse } from "./activity";
import type { AgentNode, AgentStatus } from "./types";

const node: AgentNode = {
  id: "fixture",
  sessionId: "fixture",
  label: "Fixture",
  role: "agent",
  tool: "Codex",
  model: { reliability: "unavailable" },
  tokens: { reliability: "unavailable" },
  status: "running",
  waits: [],
  events: [],
  relationship: "unavailable",
  source: "fixture",
  lastTool: { value: "Read", reliability: "confirmed", source: "fixture transcript" },
  lastToolAt: 1_000,
};

describe("toolInUse", () => {
  it("shows a recent running call and preserves inferred confidence", () => {
    expect(toolInUse(node, 120_999)).toBe("using Read");
    expect(toolInUse({ ...node, lastTool: { ...node.lastTool!, reliability: "inferred" } }, 1_000)).toBe("≈ using Read");
  });
  it("hides calls at two minutes, in the future, or without a usable timestamp or metric", () => {
    expect(toolInUse(node, 121_000)).toBeUndefined();
    expect(toolInUse(node, 999)).toBeUndefined();
    expect(toolInUse({ ...node, lastToolAt: undefined }, 1_000)).toBeUndefined();
    expect(toolInUse({ ...node, lastToolAt: NaN }, 1_000)).toBeUndefined();
    expect(toolInUse({ ...node, lastTool: { reliability: "unavailable" } }, 1_000)).toBeUndefined();
  });
  it.each<AgentStatus>(["waiting", "completed", "failed", "disconnected", "idle", "inactive", "archived", "unknown"])(
    "hides calls when %s",
    (status) => expect(toolInUse({ ...node, status }, 1_000)).toBeUndefined(),
  );
});
