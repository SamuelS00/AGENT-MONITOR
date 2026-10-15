import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { loadSnapshot, refreshCollector } from "../monitor";
import type { ExecutionStatus, MonitorSnapshot } from "../types";
import { StoreProvider } from "./store";
import { useStore } from "./storeContext";

vi.mock("../monitor", () => ({
  inTauri: () => true,
  loadSnapshot: vi.fn(),
  refreshCollector: vi.fn(),
  loadHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
const snapshot = (status: ExecutionStatus): MonitorSnapshot => ({
  observedAt: "2026-01-01T00:00:00Z",
  processes: [],
  executions: [
    {
      id: "fixture-orchestration",
      label: "Fixture run",
      tool: "Orca",
      level: "meta",
      status,
      relationship: "confirmed",
    },
  ],
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(loadSnapshot).mockResolvedValue(snapshot("running"));
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
});
const setup = async () => {
  const hook = renderHook(() => useStore(), { wrapper: StoreProvider });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe("store notifications", () => {
  it("stays silent initially, delivers on refresh only when opted in, and never repeats", async () => {
    localStorage.setItem("am.notifyMe", "true");
    const { result } = await setup();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    vi.mocked(refreshCollector).mockResolvedValue(snapshot("completed"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({ title: "Orchestration finished", body: "Fixture run" });
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("reads the preference on refresh and responds to enabling and disabling", async () => {
    const { result } = await setup();
    vi.mocked(refreshCollector).mockResolvedValue(snapshot("waiting"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).not.toHaveBeenCalled();
    await act(() => result.current.setNotifyMe(true));
    expect(sendNotification).not.toHaveBeenCalled();
    vi.mocked(refreshCollector).mockResolvedValue(snapshot("running"));
    await act(async () => {
      await result.current.refresh();
    });
    vi.mocked(refreshCollector).mockResolvedValue(snapshot("failed"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    await act(() => result.current.setNotifyMe(false));
    vi.mocked(refreshCollector).mockResolvedValue(snapshot("waiting"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("ignores in-flight live refreshes after switching to sample data", async () => {
    localStorage.setItem("am.notifyMe", "true");
    const { result } = await setup();
    let resolve!: (value: MonitorSnapshot) => void;
    vi.mocked(refreshCollector).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => {
      void result.current.refresh();
    });
    act(() => result.current.setSource("sample"));
    await act(async () => {
      resolve(snapshot("completed"));
    });
    expect(result.current.data.kind).toBe("sample");
    expect(result.current.loading).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refresh();
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
