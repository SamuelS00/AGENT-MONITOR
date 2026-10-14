import { invoke } from "@tauri-apps/api/core";
import type { MonitorSnapshot, StoredSession } from "./types";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadSnapshot(): Promise<MonitorSnapshot> {
  return invoke<MonitorSnapshot>("monitor_snapshot");
}

export async function refreshCollector(): Promise<MonitorSnapshot> {
  return invoke<MonitorSnapshot>("refresh_collector");
}

/** Sessions the backend reconstructs from the snapshots stored on this Mac. */
export async function loadHistory(): Promise<StoredSession[]> {
  return invoke<StoredSession[]>("monitor_history");
}
