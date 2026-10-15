// Component tests for the shell UI. Every snapshot below is a synthetic
// fixture (ids prefixed with "fixture-"); no real collector data is involved.
// They guard the product invariant from AGENTS.md: unavailable metrics must be
// presented as unavailable, never invented as zero, and sample data must be
// labeled as sample data.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { loadHistory, loadSnapshot, refreshCollector } from "./monitor";
import type { MonitorSnapshot, ObservedProcess, ExecutionNode } from "./types";

const { inTauriMock } = vi.hoisted(() => ({ inTauriMock: vi.fn(() => true) }));
vi.mock("./monitor", () => ({
  inTauri: () => inTauriMock(),
  loadSnapshot: vi.fn(),
  refreshCollector: vi.fn(),
  loadHistory: vi.fn().mockResolvedValue([]),
}));

const loadMock = vi.mocked(loadSnapshot);
const historyMock = vi.mocked(loadHistory);
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
  historyMock.mockReset();
  historyMock.mockResolvedValue([]);
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

  it.each([
    { status: "running" as const, age: 10_000, hint: true },
    { status: "running" as const, age: 180_000, hint: false },
    { status: "idle" as const, age: 10_000, hint: false },
  ])("shows tool hints only for fresh running calls ($status, $age ms)", async ({ status, age, hint }) => {
    const at = new Date(Date.now() - age).toISOString();
    loadMock.mockResolvedValue({
      ...fixtureSnapshot,
      executions: [
        {
          ...fixtureExecution,
          status,
          lastTool: "Read",
          lastToolAt: at,
          lastToolReliability: "confirmed",
          usageSource: "fixture transcript",
        },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByText("Fixture agent run"));
    const monitor = screen.getByRole("table", { name: "Sessions by project" });
    expect(within(monitor).queryByText(/using Read/) !== null).toBe(hint);
    expect(screen.getByText("Last tool")).toBeInTheDocument();
    expect(screen.getByText("Read")).toHaveAttribute("title", "Confirmed · fixture transcript");
    expect(screen.getByTitle(at)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: /Execution Explorer/ }));
    await screen.findByRole("tree", { name: "Execution hierarchy" });
    expect(screen.queryByText(/using Read/) !== null).toBe(hint);
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

describe("App (navigation)", () => {
  const views = () => within(screen.getByRole("navigation", { name: "Views" }));

  it("offers only screens that can show something when live", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByText("Fixture agent run");

    // No stored history is exposed yet, and the design reference is a sample-mode aid.
    expect(views().queryByRole("button", { name: /History/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Design System" })).not.toBeInTheDocument();
    expect(
      views()
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Monitor⌘1", "Execution Explorer⌘2", "Timeline⌘3", "Settings⌘4"]);
  });

  it("shows History once stored sessions exist", async () => {
    historyMock.mockResolvedValue([
      {
        id: "Codex:s1",
        project: "fixture-project",
        title: "Fixture stored session",
        tool: "Codex",
        modelReliability: "unavailable",
        startedAt: Date.now() - 3_600_000,
        durationMs: 120_000,
        agents: 2,
        tokensReliability: "unavailable",
        status: "inactive",
      },
    ]);
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByText("Fixture agent run");

    fireEvent.click(await views().findByRole("button", { name: /History/ }));
    expect(await screen.findByText("Fixture stored session")).toBeInTheDocument();
    // Tokens were never recorded for it: the row reads as unavailable, not zero.
    const row = screen.getByText("Fixture stored session").closest(".trow") as HTMLElement;
    expect(within(row).queryByText("0")).not.toBeInTheDocument();
    // Model and tokens were never recorded: both cells read as unavailable.
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("never opens a background service as the default session or charts one", async () => {
    const service: ExecutionNode = {
      ...fixtureExecution,
      id: "fixture-execution:service",
      processId: undefined,
      role: "service",
      label: "Fixture server",
    };
    // The service comes first, as it does in a real snapshot.
    loadMock.mockResolvedValue({ ...fixtureSnapshot, executions: [service, fixtureExecution] });
    render(<App />);
    await screen.findByText("Fixture agent run");

    fireEvent.click(views().getByRole("button", { name: /Timeline/ }));
    await screen.findByRole("heading", { level: 1, name: "Timeline" });
    expect(await screen.findByRole("button", { name: /Fixture agent run/ })).toBeInTheDocument();
    expect(screen.queryByText("A background service has no timeline")).not.toBeInTheDocument();
  });

  it("numbers the shortcuts by what is visible", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByText("Fixture agent run");

    fireEvent.keyDown(window, { key: "4", metaKey: true });
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("has no switches that look like options but do nothing", async () => {
    loadMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByText("Fixture agent run");
    fireEvent.click(views().getByRole("button", { name: /Settings/ }));
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    fireEvent.click(screen.getByRole("button", { name: "Data & privacy" }));
    expect(await screen.findByText("Prompts and responses")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

describe("App (orchestration explorer)", () => {
  const meta: ExecutionNode = {
    ...fixtureExecution,
    id: "fixture-execution:meta",
    processId: undefined,
    level: "meta",
    label: "fixture-project",
    task: "Fixture orchestration",
    status: "idle",
  };
  const worker = (id: string, label: string, status: ExecutionNode["status"], startedAt: string): ExecutionNode => ({
    ...fixtureExecution,
    id,
    processId: undefined,
    parentId: meta.id,
    tool: "Orca",
    level: "agent",
    label,
    status,
    startedAt,
  });
  const orchestration: MonitorSnapshot = {
    ...fixtureSnapshot,
    executions: [
      meta,
      worker("fixture-execution:try1", "Fixture task", "failed", "2026-01-01T00:00:01.000Z"),
      worker("fixture-execution:try2", "Fixture task", "completed", "2026-01-01T00:00:02.000Z"),
      // A plain session that happens to live in the same project.
      { ...fixtureExecution, id: "fixture-execution:plain", processId: undefined, label: "fixture-project", status: "idle" },
    ],
  };
  const open = async () => {
    loadMock.mockResolvedValue(orchestration);
    render(<App />);
    await screen.findByText("Fixture orchestration");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: /Execution Explorer/ }));
    return screen.findByRole("group", { name: "Orchestration summary" });
  };

  it("lists only orchestration roots and opens each through click or Enter", async () => {
    const other = { ...meta, id: "fixture-execution:other", task: "Other orchestration", tool: "Orca" };
    loadMock.mockResolvedValue({ ...orchestration, executions: [...orchestration.executions, other] });
    render(<App />);
    const views = within(screen.getByRole("navigation", { name: "Views" }));
    const overview = await views.findByRole("button", { name: /Overview/ });
    expect(views.getAllByRole("button")[0]).toBe(overview);
    expect(overview).toHaveTextContent("Overview⌘1");
    fireEvent.click(overview);
    const table = await screen.findByRole("table", { name: "Orchestrations" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).queryByText("Fixture task")).not.toBeInTheDocument();
    expect(within(table).getByText("2 agents · 1 retry")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("row", { name: "Open Other orchestration in Execution Explorer" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Execution Explorer" })).toBeInTheDocument();
    expect(document.querySelector(".picker")).toHaveTextContent("Other orchestration");
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    const row = await screen.findByRole("row", { name: "Open Fixture orchestration in Execution Explorer" });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(await screen.findByRole("heading", { level: 1, name: "Execution Explorer" })).toBeInTheDocument();
    expect(document.querySelector(".picker")).toHaveTextContent("Fixture orchestration");
  });

  it("shows distinct tree models, partial tokens and unavailable metrics", async () => {
    const executions = orchestration.executions.map((n, i) => ({
      ...n,
      startedAt: undefined,
      model: i < 2 ? "gpt-6" : "claude-opus-4-6",
      tokens: i === 1 ? 120 : undefined,
      usageSource: "fixture usage",
    }));
    loadMock.mockResolvedValue({ ...orchestration, executions });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Overview/ }));
    const row = await screen.findByRole("row", { name: "Open Fixture orchestration in Execution Explorer" });
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("Codex");
    expect(cells[3].querySelectorAll(".mbadge")).toHaveLength(2);
    expect(cells[3].querySelector(".mbadge")).toHaveAttribute("title", expect.stringContaining("fixture usage"));
    expect(cells[5]).toHaveTextContent("≥120");
    expect(within(cells[6]).getByLabelText("Unavailable")).toBeInTheDocument();
    expect(within(cells[7]).getByLabelText("Unavailable")).toBeInTheDocument();
  });

  it("offers Overview in the palette and falls back when orchestrations disappear", async () => {
    loadMock.mockResolvedValue(orchestration);
    refreshMock.mockResolvedValue(fixtureSnapshot);
    render(<App />);
    await screen.findByRole("button", { name: /Overview/ });
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    fireEvent.click(await screen.findByRole("option", { name: /Go to Overview/ }));
    expect(await screen.findByRole("table", { name: "Orchestrations" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Monitor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Overview/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(screen.queryByRole("option", { name: /Go to Overview/ })).not.toBeInTheDocument();
  });

  it("summarizes the orchestration above its tree, counting a retried failure apart from an open one", async () => {
    const summary = await open();
    expect(within(summary).getByText("Finished")).toBeInTheDocument();
    expect(within(summary).getByText("Meta-orchestrator", { exact: false })).toBeInTheDocument();
    expect(within(summary).getByText(/2 agents · 1 retry/)).toBeInTheDocument();
    expect(within(summary).queryByText(/failed/)).not.toBeInTheDocument();
  });

  it("marks each try of a retried task", async () => {
    await open();
    expect(await screen.findByText(/try 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/try 2 of 2/)).toBeInTheDocument();
  });

  it("lists orchestrations apart from plain sessions, each entry saying what it is", async () => {
    await open();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".picker")!);
    const menu = await screen.findByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent ?? "");
    expect(labels[0]).toMatch(/^Orchestrations/);
    expect(labels.findIndex((l) => l.startsWith("Sessions"))).toBeGreaterThan(1);
    // The orchestration says how many agents and retries it has; the plain session does not pose as one.
    expect(labels.find((l) => l.includes("2 agents"))).toBeTruthy();
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("lists the orchestration first in the Monitor with what it holds, and not as a failure when the failure was retried", async () => {
    loadMock.mockResolvedValue(orchestration);
    render(<App />);
    const title = await screen.findByText("Fixture orchestration");
    const rows = Array.from(document.querySelectorAll(".trow.session"));
    expect(rows[0]).toContainElement(title);
    expect(within(rows[0] as HTMLElement).getByText("Orchestration")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/2 agents · 1 retry/)).toBeInTheDocument();
    expect(rows[0].className).not.toContain("st-failed");
    expect(rows.length).toBe(2);
  });

  it("surfaces an orchestration with an open failure under Needs attention", async () => {
    const broken: MonitorSnapshot = {
      ...fixtureSnapshot,
      executions: [meta, worker("fixture-execution:only", "Fixture task", "failed", "2026-01-01T00:00:01.000Z")],
    };
    loadMock.mockResolvedValue(broken);
    render(<App />);
    // An open failure is not "active" work: the row is under Needs attention, not Active.
    const attention = await screen.findByRole("radio", { name: /Needs attention/ });
    await waitFor(() => expect(within(attention).getByText("1")).toBeInTheDocument());
    fireEvent.click(attention);
    await screen.findByText("Fixture orchestration");
    const row = document.querySelector(".trow.session") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.className).toContain("st-failed");
    expect(within(row).getByText(/1 failed/)).toBeInTheDocument();
  });

  it("shows the summary and the tries on the Timeline too", async () => {
    loadMock.mockResolvedValue(orchestration);
    render(<App />);
    await screen.findByText("Fixture orchestration");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: /Timeline/ }));
    const summary = await screen.findByRole("group", { name: "Orchestration summary" });
    expect(within(summary).getByText(/2 agents · 1 retry/)).toBeInTheDocument();
    expect(await screen.findByText(/try 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/try 2 of 2/)).toBeInTheDocument();
  });

  it("tells apart plain sessions that would read the same", async () => {
    const twin = (id: string): ExecutionNode => ({
      ...fixtureExecution,
      id,
      processId: undefined,
      label: "fixture-project",
      status: "idle",
    });
    loadMock.mockResolvedValue({
      ...fixtureSnapshot,
      executions: [twin("fixture-execution:aaaa1111"), twin("fixture-execution:bbbb2222")],
    });
    render(<App />);
    await screen.findAllByText("fixture-project");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: /Execution Explorer/ }));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".picker")!);
    const menu = await screen.findByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent ?? "")
      .filter((l) => !/^(Orchestrations|Sessions)/.test(l));
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(labels.some((l) => l.endsWith("#1111"))).toBe(true);
    expect(labels.some((l) => l.endsWith("#2222"))).toBe(true);
  });

  it("does not call a plain session an orchestrator or mark its root as inferred", async () => {
    await open();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".picker")!);
    const menu = await screen.findByRole("menu");
    const plain = within(menu)
      .getAllByRole("menuitem")
      .find((i) => !/^(Orchestrations|Sessions)/.test(i.textContent ?? "") && !(i.textContent ?? "").includes("agents"))!;
    fireEvent.click(plain);
    expect(screen.queryByText("Orchestrator")).not.toBeInTheDocument();
    expect(screen.queryByText("inferred")).not.toBeInTheDocument();
  });
});

describe("App (sample source)", () => {
  it("labels preview data as sample data outside Tauri", async () => {
    inTauriMock.mockReturnValue(false);
    render(<App />);

    // The sample dataset must always be identifiable as fictional.
    const labels = await screen.findAllByText(/Sample data/);
    expect(labels.length).toBeGreaterThan(0);
    // Sample data has history and is where the design reference is useful.
    expect(screen.getByRole("button", { name: /History/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Design System" })).toBeInTheDocument();
  });
});
