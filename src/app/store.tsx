import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { inTauri, loadSnapshot, refreshCollector } from "../monitor";
import { buildSample } from "../model/fixtures";
import { datasetFromSnapshot } from "../model/live";
import { buildIndex, type TreeIndex } from "../model/tree";
import type { Dataset } from "../model/types";

export type View = "monitor" | "explorer" | "timeline" | "history" | "settings" | "system";
export type ThemePref = "system" | "light" | "dark";
export type Density = "regular" | "compact";
export type ExplorerMode = "tree" | "graph";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage may be blocked */
  }
};

export function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => read(key, initial));
  useEffect(() => write(key, v), [key, v]);
  return [v, setV] as const;
}

interface Store {
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
  projectFilter?: string;
  setProjectFilter: (p?: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  openInExplorer: (id: string) => void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const canLive = inTauri();
  const [source, setSource] = useState<"sample" | "live">(canLive ? "live" : "sample");
  const [now, setNow] = useState(() => Date.now());
  const sampleRef = useRef<Dataset | null>(null);
  sampleRef.current ??= buildSample(now);
  const [live, setLive] = useState<Dataset>({ kind: "live", observedAt: 0, projects: [], sessions: [], nodes: [], history: [], tools: [] });
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (source === "sample") {
      setLastRefresh(Date.now());
      return;
    }
    setLoading(true);
    try {
      setLive(datasetFromSnapshot(await refreshCollector()));
    } catch (e) {
      setLive((d) => ({ ...d, collectorError: String(e) }));
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, [source]);

  useEffect(() => {
    if (source !== "live") return;
    setLoading(true);
    loadSnapshot()
      .then((s) => setLive(datasetFromSnapshot(s)))
      .catch((e) => setLive((d) => ({ ...d, collectorError: String(e) })))
      .finally(() => {
        setLoading(false);
        setLastRefresh(Date.now());
      });
  }, [source]);

  const data = source === "sample" ? sampleRef.current : live;
  const index = useMemo(() => buildIndex(data.nodes), [data.nodes]);

  const [view, setView] = useState<View>("monitor");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [historyId, setHistoryId] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [mode, setMode] = usePersisted<ExplorerMode>("am.mode", "tree");
  const [inspectorOpen, setInspectorOpen] = usePersisted("am.inspector", true);
  const [sidebarOpen, setSidebarOpen] = usePersisted("am.sidebarOpen", true);
  const [sidebarW, setSidebarW] = usePersisted("am.sidebarW", 216);
  const [inspectorW, setInspectorW] = usePersisted("am.inspectorW", 320);
  const [theme, setTheme] = usePersisted<ThemePref>("am.theme", "system");
  const [density, setDensity] = usePersisted<Density>("am.density", "regular");
  const [projectFilter, setProjectFilter] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [expanded, setExpandedState] = useState<Set<string>>(() => new Set());

  // Default: expand every node that has children when a dataset first arrives.
  const seeded = useRef<string>("");
  useEffect(() => {
    const key = `${data.kind}:${data.nodes.length}`;
    if (seeded.current === key) return;
    seeded.current = key;
    setExpandedState(new Set(data.nodes.filter((n) => index.children.has(n.id)).map((n) => n.id)));
  }, [data, index]);

  useEffect(() => {
    if (sessionId && data.sessions.some((s) => s.id === sessionId)) return;
    setSessionId((data.sessions.find((s) => index.byId.get(s.rootId)?.status === "running") ?? data.sessions[0])?.id);
  }, [data, index, sessionId]);

  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSystemDark(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.density = density;
  }, [resolvedTheme, density]);

  const toggle = useCallback(
    (id: string) =>
      setExpandedState((s) => {
        const n = new Set(s);
        if (n.has(id)) {
          n.delete(id);
        } else {
          n.add(id);
        }
        return n;
      }),
    [],
  );
  const select = useCallback(
    (id?: string) => {
      setSelectedId(id);
      if (id) {
        const n = index.byId.get(id);
        if (n) setSessionId(n.sessionId);
      }
    },
    [index],
  );
  const openInExplorer = useCallback(
    (id: string) => {
      select(id);
      setView("explorer");
    },
    [select],
  );

  const value: Store = {
    data,
    index,
    now,
    loading,
    canLive,
    source,
    setSource,
    refresh,
    lastRefresh,
    view,
    go: setView,
    selectedId,
    select,
    historyId,
    selectHistory: setHistoryId,
    sessionId,
    setSessionId,
    expanded,
    toggle,
    setExpanded: (f) => setExpandedState((s) => f(s)),
    mode,
    setMode,
    inspectorOpen,
    setInspectorOpen,
    sidebarOpen,
    setSidebarOpen,
    sidebarW,
    setSidebarW,
    inspectorW,
    setInspectorW,
    theme,
    setTheme,
    resolvedTheme,
    density,
    setDensity,
    projectFilter,
    setProjectFilter,
    paletteOpen,
    setPaletteOpen,
    openInExplorer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
