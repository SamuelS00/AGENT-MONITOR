import { useEffect } from "react";
import { StoreProvider, useStore, type View } from "./app/store";
import { CommandPalette } from "./ui/CommandPalette";
import { Inspector } from "./ui/Inspector";
import { Resizer } from "./ui/primitives";
import { Sidebar, Toolbar } from "./ui/Shell";
import { Explorer } from "./views/Explorer";
import { History } from "./views/History";
import { Monitor } from "./views/Monitor";
import { Settings } from "./views/Settings";
import { System } from "./views/System";
import { Timeline } from "./views/Timeline";

const VIEWS: Record<View, () => React.JSX.Element> = {
  monitor: Monitor,
  explorer: Explorer,
  timeline: Timeline,
  history: History,
  settings: Settings,
  system: System,
};
const KEYS: Record<string, View> = { "1": "monitor", "2": "explorer", "3": "timeline", "4": "history", "5": "settings" };
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (KEYS[k]) {
        e.preventDefault();
        go(KEYS[k]);
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
  }, [go, inspectorOpen, sidebarOpen, paletteOpen, setInspectorOpen, setSidebarOpen, setPaletteOpen, refresh]);

  const Active = VIEWS[view];
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
