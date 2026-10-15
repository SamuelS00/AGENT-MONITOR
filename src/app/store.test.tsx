import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./storeContext";
import { StoreProvider } from "./store";
import { loadHistory, loadSnapshot, refreshCollector } from "../monitor";

const { inTauriMock } = vi.hoisted(() => ({ inTauriMock: vi.fn(() => true) }));
vi.mock("../monitor", () => ({
  inTauri: () => inTauriMock(),
  loadHistory: vi.fn().mockResolvedValue([]),
  loadSnapshot: vi.fn().mockResolvedValue({ observedAt: new Date().toISOString(), processes: [], executions: [] }),
  refreshCollector: vi.fn().mockResolvedValue({ observedAt: new Date().toISOString(), processes: [], executions: [] }),
}));

const refreshMock = vi.mocked(refreshCollector);
function Harness() {
  const store = useStore();
  return <button onClick={() => store.setSource(store.source === "live" ? "sample" : "live")}>{store.source}</button>;
}
const mount = () =>
  render(
    <StoreProvider>
      <Harness />
    </StoreProvider>,
  );
const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });

beforeEach(() => {
  vi.useFakeTimers();
  inTauriMock.mockReturnValue(true);
  vi.mocked(loadSnapshot).mockResolvedValue({ observedAt: new Date().toISOString(), processes: [], executions: [] });
  vi.mocked(loadHistory).mockResolvedValue([]);
  refreshMock.mockReset();
  refreshMock.mockResolvedValue({ observedAt: new Date().toISOString(), processes: [], executions: [] });
  setVisibility("visible");
});

describe("StoreProvider auto refresh", () => {
  it("refreshes live data on each 15 second tick", async () => {
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while hidden and refreshes when visible again", async () => {
    mount();
    setVisibility("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(refreshMock).not.toHaveBeenCalled();
    setVisibility("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while a refresh is in flight", async () => {
    let finish!: (snapshot: Awaited<ReturnType<typeof refreshCollector>>) => void;
    refreshMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await act(async () => finish({ observedAt: new Date().toISOString(), processes: [], executions: [] }));
  });

  it("never refreshes sample data", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
