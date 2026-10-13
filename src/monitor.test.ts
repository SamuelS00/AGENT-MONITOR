// Unit tests for the Tauri command bindings. All snapshot payloads here are
// synthetic fixtures, not real collector output.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { inTauri, loadSnapshot, refreshCollector } from "./monitor";
import type { MonitorSnapshot } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const fixtureSnapshot: MonitorSnapshot = {
  observedAt: "2026-01-01T00:00:00.000Z",
  processes: [],
  executions: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("inTauri", () => {
  it("reports false in a plain browser context", () => {
    expect(inTauri()).toBe(false);
  });

  it("reports true when Tauri injects its internals", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(inTauri()).toBe(true);
  });
});

describe("loadSnapshot", () => {
  it("reads the latest snapshot through the monitor_snapshot command", async () => {
    invokeMock.mockResolvedValue(fixtureSnapshot);
    await expect(loadSnapshot()).resolves.toEqual(fixtureSnapshot);
    expect(invokeMock).toHaveBeenCalledWith("monitor_snapshot");
  });

  it("propagates command failures instead of inventing a snapshot", async () => {
    invokeMock.mockRejectedValue(new Error("fixture: collector unavailable"));
    await expect(loadSnapshot()).rejects.toThrow("fixture: collector unavailable");
  });
});

describe("refreshCollector", () => {
  it("forces a fresh collection through the refresh_collector command", async () => {
    invokeMock.mockResolvedValue(fixtureSnapshot);
    await expect(refreshCollector()).resolves.toEqual(fixtureSnapshot);
    expect(invokeMock).toHaveBeenCalledWith("refresh_collector");
  });
});
