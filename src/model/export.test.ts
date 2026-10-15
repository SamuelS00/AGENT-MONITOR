import { describe, expect, it } from "vitest";
import { buildIndex } from "./tree";
import { buildOrchestrationExport, renderOrchestrationJson, renderOrchestrationMarkdown } from "./export";
import { unavailable, confirmed } from "./format";
import type { AgentNode } from "./types";

const node = (id: string, parentId?: string, extra: Partial<AgentNode> = {}): AgentNode => ({
  id,
  parentId,
  sessionId: `session-${id}`,
  label: id,
  role: id === "root" ? "meta" : "agent",
  level: id === "root" ? "meta" : id === "child" ? "agent" : "subagent",
  tool: "Orca",
  model: unavailable("model not reported"),
  status: "completed",
  waits: [],
  tokens: unavailable("usage absent"),
  relationship: "confirmed",
  source: "fixture source",
  events: [],
  ...extra,
});

describe("orchestration exporters", () => {
  const data = () =>
    buildOrchestrationExport(
      buildIndex([
        node("root", undefined, {
          activity: "Coordinate workers",
          model: confirmed("model-x", "session record"),
          startedAt: 1000,
          endedAt: 3000,
        }),
        node("retry-old", "root", {
          label: "Build",
          retryOf: undefined,
          activity: "Build task",
          startedAt: 1000,
          endedAt: 1500,
          status: "failed",
          tokensIn: confirmed(12, "usage feed"),
        }),
        node("retry-new", "root", {
          label: "Build",
          retryOf: "retry-old",
          activity: "Build task",
          startedAt: 1500,
          endedAt: 2500,
          tokensOut: confirmed(7, "usage feed"),
          tokens: confirmed(7, "usage feed"),
        }),
        node("child", "retry-new", {
          label: "Nested",
          role: "subagent",
          level: "subagent",
          startedAt: 1600,
          endedAt: 2000,
          activity: "Nested task",
          tokens: confirmed(3, "usage feed"),
        }),
      ]),
      "root",
      3000,
    )!;

  it("renders provenance and explicit unavailable values in Markdown, including nested rows and retries", () => {
    const result = renderOrchestrationMarkdown(data());
    expect(result).toContain("model: model-x [confirmed; source: session record]");
    expect(result).toContain("tokens in: 12 [confirmed; source: usage feed]");
    expect(result).toContain("tokens in: unavailable [unavailable; source: unavailable]");
    expect(result).toContain("try: 1 of 2 (superseded)");
    expect(result).toContain("  - Nested (subagent;");
    expect(result).not.toContain("retry-old");
  });

  it("renders complete safe JSON without private or undisplayed fields", () => {
    const json = renderOrchestrationJson(data());
    const parsed = JSON.parse(json) as { tree: { children: unknown[]; model: object } };
    expect(parsed.tree.children).toHaveLength(2);
    expect(json).toContain('"value": "unavailable"');
    expect(json).toContain('"source": "usage feed"');
    expect(json).not.toContain("sessionId");
    expect(json).not.toContain("retryOf");
    expect(json).not.toContain("events");
    expect(json).not.toContain("projectPath");
  });
});
