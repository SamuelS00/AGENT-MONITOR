import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight, Clock3, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { loadSnapshot, refreshCollector } from "./monitor";
import type { ExecutionNode, MonitorSnapshot, ObservedProcess } from "./types";

const emptySnapshot: MonitorSnapshot = { observedAt: new Date(0).toISOString(), processes: [], executions: [] };

function elapsed(iso?: string) {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function statusLabel(status: string) {
  return status === "running" ? "Running" : status === "idle" ? "Idle" : status === "completed" ? "Completed" : "Unknown";
}

function ExecutionTree({ nodes, selected, onSelect }: { nodes: ExecutionNode[]; selected?: string; onSelect: (node: ExecutionNode) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(nodes.map((node) => node.id)));
  const children = useMemo(() => {
    const map = new Map<string | undefined, ExecutionNode[]>();
    nodes.forEach((node) => map.set(node.parentId, [...(map.get(node.parentId) ?? []), node]));
    return map;
  }, [nodes]);
  const renderNode = (node: ExecutionNode, depth = 0) => {
    const descendants = children.get(node.id) ?? [];
    const open = expanded.has(node.id);
    return <div key={node.id}>
      <button className={`tree-row ${selected === node.id ? "selected" : ""}`} style={{ paddingLeft: 16 + depth * 20 }} onClick={() => onSelect(node)}>
        {descendants.length > 0 ? <span className="twist" onClick={(event) => { event.stopPropagation(); setExpanded((value) => { const next = new Set(value); open ? next.delete(node.id) : next.add(node.id); return next; }); }}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span> : <span className="twist" />}
        <span className={`status-dot ${node.status}`} />
        <span className="tree-name">{node.label}</span>
        <span className="tree-meta">{node.tool}{node.model ? ` · ${node.model}` : ""}</span>
        <span className={`relation ${node.relationship}`}>{node.relationship}</span>
      </button>
      {open && descendants.map((child) => renderNode(child, depth + 1))}
    </div>;
  };
  return <>{(children.get(undefined) ?? []).map((node) => renderNode(node))}</>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [selected, setSelected] = useState<ExecutionNode>();
  const [loading, setLoading] = useState(true);

  const reload = async (force = false) => {
    setLoading(true);
    try { setSnapshot(force ? await refreshCollector() : await loadSnapshot()); }
    catch (error) { setSnapshot((current) => ({ ...current, collectorError: String(error) })); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);
  const running = snapshot.processes.filter((process) => process.status === "running").length;

  return <main>
    <header>
      <div><p className="eyebrow">LOCAL OBSERVABILITY</p><h1>Agent Monitor</h1></div>
      <button className="refresh" onClick={() => void reload(true)} disabled={loading}><RefreshCw size={16} className={loading ? "spinning" : ""} /> Refresh</button>
    </header>
    {snapshot.collectorError && <div className="notice"><ShieldCheck size={16} /> Collector: {snapshot.collectorError}</div>}
    <section className="metrics">
      <div><Activity size={18} /><span><b>{running}</b> active processes</span></div>
      <div><Database size={18} /><span><b>{snapshot.executions.length}</b> observed executions</span></div>
      <div><Clock3 size={18} /><span>Updated {snapshot.observedAt === emptySnapshot.observedAt ? "never" : new Date(snapshot.observedAt).toLocaleTimeString()}</span></div>
    </section>
    <section className="layout">
      <article className="panel explorer"><div className="panel-heading"><div><h2>Execution Explorer</h2><p>Relationships marked inferred are not confirmed delegation.</p></div></div>
        {snapshot.executions.length ? <ExecutionTree nodes={snapshot.executions} selected={selected?.id} onSelect={setSelected} /> : <div className="empty">No executions discovered yet. The collector only shows local data it can verify.</div>}
      </article>
      <article className="panel detail"><div className="panel-heading"><div><h2>Details</h2><p>Source-aware metadata</p></div></div>
        {selected ? <dl><dt>Tool</dt><dd>{selected.tool}</dd><dt>Status</dt><dd>{statusLabel(selected.status)}</dd><dt>Model</dt><dd>{selected.model ?? "Unavailable"}</dd><dt>Duration</dt><dd>{elapsed(selected.startedAt)}</dd><dt>Tokens</dt><dd>{selected.tokens?.toLocaleString() ?? "Unavailable"}</dd><dt>Relationship</dt><dd className={selected.relationship}>{selected.relationship}</dd></dl> : <div className="empty">Select an execution to inspect its verified metadata.</div>}
      </article>
    </section>
    <section className="panel processes"><div className="panel-heading"><div><h2>Observed Processes</h2><p>Read-only process discovery on this Mac.</p></div></div>
      {snapshot.processes.length ? <table><thead><tr><th>Tool</th><th>PID</th><th>Project</th><th>Duration</th><th>Status</th></tr></thead><tbody>{snapshot.processes.map((process: ObservedProcess) => <tr key={process.id}><td>{process.tool}</td><td>{process.pid}</td><td>{process.projectPath ?? "Unavailable"}</td><td>{elapsed(process.startedAt)}</td><td><span className={`pill ${process.status}`}>{statusLabel(process.status)}</span></td></tr>)}</tbody></table> : <div className="empty">No recognized CLI process is currently running.</div>}
    </section>
  </main>;
}
