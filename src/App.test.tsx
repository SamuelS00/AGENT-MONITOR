// Component tests for the shell UI. Every snapshot below is a synthetic
// fixture (ids prefixed with "fixture-"); no real collector data is involved.
// They guard the product invariant from AGENTS.md: unavailable metrics must be
// presented as unavailable, never invented as zero, and sample data must be
// labeled as sample data.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { loadSnapshot, refreshCollector } from "./monitor";
import type { MonitorSnapshot, ObservedProcess, ExecutionNode } from "./types";

const { inTauriMock } = vi.hoisted(() => ({ inTauriMock: vi.fn(() => true) }));
vi.mock("./monitor", () => ({
  inTauri: () => inTauriMock(),
  loadSnapshot: vi.fn(),
  refreshCollector: vi.fn(),
}));

const loadMock = vi.mocked(loadSnapshot);
const refreshMock = vi.mocked(refreshCollector);

const fixtureProcess: ObservedProcess = {
  id: "fixture-process:421:1700000000",
  pid: 421,
  tool: "Codex",
  command: "codex",
  startedAt: new Date().toISOString(),
  projectPath: "/fixture/project",
  status: "running",
  reliability: "confirmed",
};

const fixtureExecution: ExecutionNode = {
  id: "fixture-execution:root",
  processId: "fixture-process:421:1700000000",
  label: "Fixture agent run",
  tool: "Codex",
  status: "running",
  relationship: "confirmed",
  startedAt: new Date().toISOString(),
};

const fixtureSnapshot: MonitorSnapshot = {
  observedAt: new Date().toISOString(),
  processes: [fixtureProcess],
  executions: [fixtureExecution],
};

beforeEach(() => {
  localStorage.clear();
  inTauriMock.mockReset();
  inTauriMock.mockReturnValue(true);
  loadMock.mockReset();
  refreshMock.mockReset();
});

describe("App (live source)", () => {
  it("renders sessions from the collector snapshot", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);

    expect(await screen.findByText("Fixture agent run")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("shows unavailable model and tokens instead of inventing values", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    fireEvent.click(await screen.findByText("Fixture agent run"));

    // Model and Tokens are absent from the fixture, so both must read as
    // unavailable — never a fabricated zero or model name. The model badge
    // renders "—" with an explicit aria-label; tokens read "Unavailable".
    expect(screen.getAllByLabelText("Model unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("surfaces collector errors instead of silently dropping them", async () => {
    loadMock.mockRejectedValue(new Error("fixture failure"));
    render(<App />);

    expect(await screen.findByText(/fixture failure/)).toBeInTheDocument();
  });

  it("refreshes observations through the refresh_collector command", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    refreshMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByText("Fixture agent run");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });
});

describe("App (orchestration)", () => {
  it("shows a recorded subagent under its session in the explorer", async () => {
    const child: ExecutionNode = {
      ...fixtureExecution,
      id: "fixture-execution:child",
      parentId: fixtureExecution.id,
      processId: undefined,
      label: "Fixture subagent",
      status: "idle",
    };
    loadMock.mockResolvedValue({ ...fixtureSnapshot, executions: [fixtureExecution, child] });
    render(<App />);
    await screen.findByText("Fixture agent run");
    // One session row for the project: the subagent is nested, not listed as a second session.
    expect(screen.queryByText("Fixture subagent")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: /Execution Explorer/ }));
    const root = await screen.findAllByText("Fixture agent run");
    expect(root.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /expand|Expand/ }));
    expect(await screen.findByText("Fixture subagent")).toBeInTheDocument();
  });
});

describe("App (sample source)", () => {
  it("labels preview data as sample data outside Tauri", async () => {
    inTauriMock.mockReturnValue(false);
    render(<App />);

    // The sample dataset must always be identifiable as fictional.
    const labels = await screen.findAllByText(/Sample data/);
    expect(labels.length).toBeGreaterThan(0);
  });
});
