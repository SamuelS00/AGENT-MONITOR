import { createContext, useContext } from "react";
import type { Dataset } from "../model/types";
import type { TreeIndex } from "../model/tree";

export type View = "overview" | "monitor" | "explorer" | "timeline" | "history" | "settings" | "system";
export type ThemePref = "system" | "light" | "dark";
export type Density = "regular" | "compact";
export type ExplorerMode = "tree" | "graph";

export interface Store {
  data: Dataset;
  index: TreeIndex;
  now: number;
  loading: boolean;
  canLive: boolean;
  source: "sample" | "live";
  setSource: (s: "sample" | "live") => void;
  refresh: () => void;
  lastRefresh: number;
  view: View;
  go: (v: View) => void;
  selectedId?: string;
  select: (id?: string) => void;
  historyId?: string;
  selectHistory: (id?: string) => void;
  sessionId?: string;
  setSessionId: (id: string) => void;
  expanded: Set<string>;
  toggle: (id: string) => void;
  setExpanded: (f: (s: Set<string>) => Set<string>) => void;
  mode: ExplorerMode;
  setMode: (m: ExplorerMode) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (b: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (b: boolean) => void;
  sidebarW: number;
  setSidebarW: (n: number) => void;
  inspectorW: number;
  setInspectorW: (n: number) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  resolvedTheme: "light" | "dark";
  density: Density;
  setDensity: (d: Density) => void;
  notifyMe: boolean;
  setNotifyMe: (enabled: boolean) => Promise<void>;
  notificationError?: string;
  projectFilter?: string;
  setProjectFilter: (p?: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  openInExplorer: (id: string) => void;
}

export const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};
