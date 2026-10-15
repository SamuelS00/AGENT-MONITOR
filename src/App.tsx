import { useEffect } from "react";
import { StoreProvider, type View } from "./app/store";
import { useStore } from "./app/storeContext";
import { CommandPalette } from "./ui/CommandPalette";
import { Inspector } from "./ui/Inspector";
import { Resizer } from "./ui/primitives";
import { navFor, viewAvailable } from "./ui/nav";
import { Sidebar, Toolbar } from "./ui/Shell";
import { Explorer } from "./views/Explorer";
import { History } from "./views/History";
import { isOrchestration } from "./model/orchestration";
import { Overview } from "./views/Overview";
import { Monitor } from "./views/Monitor";
import { Settings } from "./views/Settings";
import { System } from "./views/System";
import { Timeline } from "./views/Timeline";

const VIEWS: Record<View, () => React.JSX.Element> = {
  overview: Overview,
  monitor: Monitor,
  explorer: Explorer,
  timeline: Timeline,
  history: History,
  settings: Settings,
  system: System,
};
const NO_INSPECTOR: View[] = ["settings", "system"];

function Shell() {
  const s = useStore();
  const {
    view,
    go,
    inspectorOpen,
    setInspectorOpen,
    sidebarOpen,
    setSidebarOpen,
    inspectorW,
    setInspectorW,
    paletteOpen,
    setPaletteOpen,
    refresh,
  } = s;

  const hasOrchestrations = s.index.roots.some(isOrchestration);
  const hasHistory = s.data.history.length > 0;
  const sample = s.source === "sample";
  const available = viewAvailable(view, { hasOrchestrations, hasHistory, sample });
  // A view that disappeared (history without data, the design reference outside sample mode) falls back to Monitor.
  useEffect(() => {
    if (!available) go("monitor");
  }, [available, go]);

  useEffect(() => {
    const nav = navFor({ hasOrchestrations, hasHistory });
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (nav.some((n) => n.key === k)) {
        e.preventDefault();
        go(nav.find((n) => n.key === k)!.view);
      } else if (k === "i") {
        e.preventDefault();
        setInspectorOpen(!inspectorOpen);
      } else if (k === "\\") {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
      } else if (k === "r" && !e.shiftKey) {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    go,
    hasOrchestrations,
    hasHistory,
    inspectorOpen,
    sidebarOpen,
    paletteOpen,
    setInspectorOpen,
    setSidebarOpen,
    setPaletteOpen,
    refresh,
  ]);

  const Active = VIEWS[available ? view : "monitor"];
  const showInspector = inspectorOpen && !NO_INSPECTOR.includes(view);
  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"}`}>
      {sidebarOpen && <Sidebar />}
      <div className="main">
        <Toolbar />
        <div className="panes">
          <main className="content" aria-label={view}>
            <Active />
          </main>
          {showInspector && (
            <aside className="inspector" style={{ width: inspectorW }} aria-label="Inspector">
              <Resizer
                side="left"
                onDrag={(dx) => setInspectorW(Math.min(560, Math.max(260, inspectorW - dx)))}
                onReset={() => setInspectorW(320)}
              />
              <Inspector />
            </aside>
          )}
        </div>
      </div>
      {paletteOpen && <CommandPalette />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
