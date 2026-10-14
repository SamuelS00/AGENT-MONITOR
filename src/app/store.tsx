import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { inTauri, loadHistory, loadSnapshot, refreshCollector } from "../monitor";
import { buildSample } from "../model/fixtures";
import { datasetFromSnapshot, historyFromStored } from "../model/live";
import type { HistorySession } from "../model/types";
import { buildIndex } from "../model/tree";
import type { Dataset } from "../model/types";
import { Ctx, type Density, type ExplorerMode, type Store, type ThemePref, type View } from "./storeContext";
import { usePersisted } from "./usePersisted";

export type { Density, ExplorerMode, ThemePref, View } from "./storeContext";

export function StoreProvider({ children }: { children: ReactNode }) {
  const canLive = inTauri();
  const [source, setSource] = useState<"sample" | "live">(canLive ? "live" : "sample");
  const [now, setNow] = useState(() => Date.now());
  const sampleRef = useRef<Dataset | null>(null);
  sampleRef.current ??= buildSample(now);
  const [live, setLive] = useState<Dataset>({ kind: "live", observedAt: 0, projects: [], sessions: [], nodes: [], history: [], tools: [] });
  const [liveHistory, setLiveHistory] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Stored sessions are best effort: if they cannot be read, the live view still works and History stays hidden.
  const reloadHistory = useCallback(() => {
    loadHistory()
      .then((rows) => setLiveHistory(historyFromStored(rows)))
      .catch(() => setLiveHistory([]));
  }, []);

  const refresh = useCallback(async () => {
    if (source === "sample") {
      setLastRefresh(Date.now());
      return;
    }
    setLoading(true);
    try {
      setLive(datasetFromSnapshot(await refreshCollector()));
      reloadHistory();
    } catch (e) {
      setLive((d) => ({ ...d, collectorError: String(e) }));
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, [source, reloadHistory]);

  useEffect(() => {
    if (source !== "live") return;
    setLoading(true);
    loadSnapshot()
      .then((s) => {
        setLive(datasetFromSnapshot(s));
        reloadHistory();
      })
      .catch((e) => setLive((d) => ({ ...d, collectorError: String(e) })))
      .finally(() => {
        setLoading(false);
        setLastRefresh(Date.now());
      });
  }, [source, reloadHistory]);

  const data = useMemo(() => (source === "sample" ? sampleRef.current! : { ...live, history: liveHistory }), [source, live, liveHistory]);
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
