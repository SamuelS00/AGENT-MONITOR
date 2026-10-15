import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { inTauri, loadHistory, loadSnapshot, refreshCollector } from "../monitor";
import { buildSample } from "../model/fixtures";
import { datasetFromSnapshot, historyFromStored } from "../model/live";
import type { HistorySession } from "../model/types";
import { buildIndex } from "../model/tree";
import type { Dataset } from "../model/types";
import { Ctx, type Density, type ExplorerMode, type Store, type ThemePref, type View } from "./storeContext";
import { usePersisted } from "./usePersisted";
import { useNotifications } from "./useNotifications";
import { notificationsFor } from "../model/notifications";

export type { Density, ExplorerMode, ThemePref, View } from "./storeContext";

export function StoreProvider({ children }: { children: ReactNode }) {
  const canLive = inTauri();
  const { notifyMe, setNotifyMe, notificationError, deliver } = useNotifications(canLive);
  const previousLive = useRef<Dataset | null>(null);
  const refreshing = useRef(false);
  const sourceGeneration = useRef(0);
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

  const acceptLive = useCallback(
    (next: Dataset) => {
      const events = notificationsFor(previousLive.current, next);
      previousLive.current = next;
      setLive(next);
      void deliver(events);
    },
    [deliver],
  );

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    if (source === "sample") {
      setLastRefresh(Date.now());
      return;
    }
    refreshing.current = true;
    setLoading(true);
    const generation = sourceGeneration.current;
    try {
      const snapshot = await refreshCollector();
      if (generation !== sourceGeneration.current) return;
      acceptLive(datasetFromSnapshot(snapshot));
      reloadHistory();
    } catch (e) {
      if (generation !== sourceGeneration.current) return;
      previousLive.current = null;
      setLive((d) => ({ ...d, collectorError: String(e) }));
    } finally {
      if (generation === sourceGeneration.current) {
        refreshing.current = false;
        setLoading(false);
        setLastRefresh(Date.now());
      }
    }
  }, [source, reloadHistory, acceptLive]);

  // Keep live data fresh without a click: every 15 s while the window is visible, and once when it becomes visible again.
  // A tick is skipped while a refresh is still running, so refreshes never overlap.
  useEffect(() => {
    if (!canLive || source !== "live") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !refreshing.current) void refresh();
    }, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !refreshing.current) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canLive, source, refresh]);

  useEffect(() => {
    const generation = ++sourceGeneration.current;
    previousLive.current = null;
    if (source !== "live") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    refreshing.current = true;
    setLoading(true);
    loadSnapshot()
      .then((s) => {
        if (cancelled) return;
        acceptLive(datasetFromSnapshot(s));
        reloadHistory();
      })
      .catch((e) => {
        if (!cancelled) setLive((d) => ({ ...d, collectorError: String(e) }));
      })
      .finally(() => {
        if (cancelled) return;
        refreshing.current = false;
        setLoading(false);
        setLastRefresh(Date.now());
      });
    return () => {
      sourceGeneration.current = generation + 1;
      cancelled = true;
      refreshing.current = false;
    };
  }, [source, reloadHistory, acceptLive]);

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
    // Services host sessions but have no work of their own, so they are never the default.
    const work = data.sessions.filter((s) => s.projectId !== "services");
    setSessionId((work.find((s) => index.byId.get(s.rootId)?.status === "running") ?? work[0] ?? data.sessions[0])?.id);
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
    notifyMe,
    setNotifyMe,
    notificationError,
    projectFilter,
    setProjectFilter,
    paletteOpen,
    setPaletteOpen,
    openInExplorer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
