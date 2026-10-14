import { PanelLeft, PanelRight, RefreshCw, Search } from "lucide-react";
import { useStore } from "../app/storeContext";
import { isActive } from "../model/status";
import { fmtAgo } from "../model/format";
import { AppMark } from "./AppMark";
import { navFor } from "./nav";
import { Kbd, Resizer } from "./primitives";

export function Sidebar() {
  const { view, go, data, index, projectFilter, setProjectFilter, sidebarW, setSidebarW, source, now, lastRefresh, loading } = useStore();
  const running = (pid: string) =>
    data.sessions.filter((s) => s.projectId === pid && isActive(index.byId.get(s.rootId)?.status ?? "unknown")).length;
  return (
    <aside className="sidebar" style={{ width: sidebarW }} aria-label="Sidebar">
      <div className="drag-region" data-tauri-drag-region>
        <div className="brand">
          <AppMark size={18} />
          <span>Agent Monitor</span>
        </div>
      </div>
      <nav className="nav" aria-label="Views">
        {navFor({ hasHistory: data.history.length > 0 }).map(({ view: v, label, icon: Icon, key }) => (
          <button
            key={v}
            className={`nav-item ${view === v ? "on" : ""}`}
            aria-current={view === v ? "page" : undefined}
            onClick={() => go(v)}
          >
            <Icon size={15} strokeWidth={1.6} />
            <span className="grow trunc">{label}</span>
            <Kbd>⌘{key}</Kbd>
          </button>
        ))}
      </nav>
      <div className="side-head">Projects</div>
      <div className="nav side-projects">
        <button
          className={`nav-item ${!projectFilter ? "sel" : ""}`}
          onClick={() => {
            setProjectFilter(undefined);
            go("monitor");
          }}
        >
          <span className="grow trunc">All projects</span>
        </button>
        {data.projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${projectFilter === p.id ? "sel" : ""}`}
            onClick={() => {
              setProjectFilter(p.id);
              go("monitor");
            }}
            title={p.path}
          >
            <span className="grow trunc">{p.name}</span>
            {running(p.id) > 0 && (
              <span className="count" title="Active sessions">
                {running(p.id)}
              </span>
            )}
          </button>
        ))}
        {data.projects.length === 0 && <div className="side-empty">No projects observed</div>}
      </div>
      <div className="side-foot">
        {source === "sample" && (
          <button
            className="nav-item"
            onClick={() => go("system")}
            aria-current={view === "system" ? "page" : undefined}
            title="Design system reference"
          >
            <span className="grow trunc">Design System</span>
          </button>
        )}
        <div className="collector" role="status">
          <span className={`dot ${loading ? "busy" : source === "sample" ? "sample" : "live"}`} aria-hidden />
          <span className="trunc">
            {source === "sample" ? "Sample data" : loading ? "Collecting…" : `Local collector · ${fmtAgo(lastRefresh, now)}`}
          </span>
        </div>
      </div>
      <Resizer side="right" onDrag={(dx) => setSidebarW(Math.min(320, Math.max(172, sidebarW + dx)))} onReset={() => setSidebarW(216)} />
    </aside>
  );
}

export function Toolbar() {
  const {
    view,
    setPaletteOpen,
    inspectorOpen,
    setInspectorOpen,
    sidebarOpen,
    setSidebarOpen,
    refresh,
    loading,
    source,
    setSource,
    canLive,
  } = useStore();
  const title = view === "system" ? "Design System" : navFor({ hasHistory: true }).find((n) => n.view === view)?.label;
  return (
    <div className="toolbar" data-tauri-drag-region>
      {!sidebarOpen && <div className="traffic-space" data-tauri-drag-region />}
      <button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar (⌘\)" aria-label="Toggle sidebar">
        <PanelLeft size={16} strokeWidth={1.6} />
      </button>
      <h1 className="toolbar-title" data-tauri-drag-region>
        {title}
      </h1>
      {source === "sample" ? (
        <span className="chip chip-sample" title="Fictional data for prototyping. Nothing here was observed on this Mac.">
          Sample data
          {canLive && (
            <button className="chip-link" onClick={() => setSource("live")}>
              Use live
            </button>
          )}
        </span>
      ) : (
        canLive && (
          <button className="chip chip-btn" onClick={() => setSource("sample")} title="Preview with fictional data">
            Preview sample
          </button>
        )
      )}
      <div className="grow" data-tauri-drag-region />
      <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
        <Search size={13} strokeWidth={1.7} />
        <span>Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button className="icon-btn" onClick={refresh} disabled={loading} title="Refresh observations (⌘R)" aria-label="Refresh">
        <RefreshCw size={15} strokeWidth={1.6} className={loading ? "spin" : ""} />
      </button>
      <button
        className={`icon-btn ${inspectorOpen ? "on" : ""}`}
        onClick={() => setInspectorOpen(!inspectorOpen)}
        title="Toggle inspector (⌘I)"
        aria-label="Toggle inspector"
        aria-pressed={inspectorOpen}
      >
        <PanelRight size={16} strokeWidth={1.6} />
      </button>
    </div>
  );
}
