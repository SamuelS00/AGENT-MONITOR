import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildIndex } from "../model/tree";
import { confirmed } from "../model/format";
import type { AgentNode } from "../model/types";

const fixtureRoot = "fixture-orchestration";
const fixtureIndex = buildIndex([
  {
    id: fixtureRoot,
    sessionId: "fixture-session",
    label: "Coordinator",
    role: "meta",
    level: "meta",
    tool: "Codex",
    model: confirmed("gpt-5"),
    status: "completed",
    waits: [],
    tokens: confirmed(80),
    events: [],
    source: "fixture transcript",
    relationship: "confirmed",
  } as AgentNode,
]);

vi.mock("../app/storeContext", () => ({ useStore: () => ({ index: fixtureIndex, now: 100 }) }));

import { OrchestrationSummary } from "./OrchestrationSummary";

describe("OrchestrationSummary", () => {
  it("shows a collapsed tokens by model table with a model badge", () => {
    render(<OrchestrationSummary rootId={fixtureRoot} />);
    const details = screen.getByText("Tokens by model").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Tokens by model"));
    expect(details).toHaveAttribute("open");
    const table = within(details!).getByRole("table");
    expect(within(table).getByText("GPT")).toBeInTheDocument();
    expect(within(table).getByText("80")).toBeInTheDocument();
    expect(within(table).getByText("Nodes")).toBeInTheDocument();
  });
});
