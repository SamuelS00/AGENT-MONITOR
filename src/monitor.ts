import { invoke } from "@tauri-apps/api/core";
import type { MonitorSnapshot } from "./types";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadSnapshot(): Promise<MonitorSnapshot> {
  return invoke<MonitorSnapshot>("monitor_snapshot");
}

export async function refreshCollector(): Promise<MonitorSnapshot> {
  return invoke<MonitorSnapshot>("refresh_collector");
}
