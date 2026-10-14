import { lazy, Suspense, useMemo, useRef } from "react";
import { nodeBrandColor } from "../ui/brand";
import { ROLE_LABEL } from "../model/status";
import { ModelBadge } from "../ui/ModelBadge";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Network, ListTree } from "lucide-react";
import { useStore } from "../app/storeContext";
import { descendants, durationMs, parallelIds, rollupTokens, visibleRows, type Row } from "../model/tree";
import { fmtDuration, fmtTokens } from "../model/format";
import { Banner, EmptyState, Segmented, SkeletonRows, StatusGlyph, Val } from "../ui/primitives";
import { copy } from "../ui/clipboard";
import { useMenu } from "../ui/useMenu";

const Graph = lazy(() => import("./Graph"));

export function SessionPicker() {
  const { data, index, sessionId, setSessionId, select } = useStore();
  const menu = useMenu();
  const cur = data.sessions.find((s) => s.id === sessionId);
  const proj = data.projects.find((p) => p.id === cur?.projectId);
  return (
    <>
      <button
        className="picker"
        disabled={!cur}
        onClick={(e) =>
          menu.openAt(
            e.currentTarget,
            data.sessions.map((s) => ({
              label: `${data.projects.find((p) => p.id === s.projectId)?.name ?? "unknown"} · ${s.title}`,
              checked: s.id === sessionId,
              onSelect: () => {
                setSessionId(s.id);
                select(s.rootId);
              },
            })),
          )
        }
        aria-haspopup="menu"
      >
        {cur ? (
          <>
            <StatusGlyph status={index.byId.get(cur.rootId)?.status ?? "unknown"} />
            <span className="picker-proj">{proj?.name}</span>
            <span className="picker-sep">/</span>
            <span className="trunc">{cur.title}</span>
          </>
        ) : (
          <span>No session</span>
        )}
        <ChevronDown size={13} />
      </button>
      {menu.node}
    </>
  );
}

export function ExplorerBar({ withModes = true }: { withModes?: boolean }) {
  const { mode, setMode, setExpanded, index, data, sessionId } = useStore();
  const rootId = data.sessions.find((s) => s.id === sessionId)?.rootId;
  const ids = rootId
    ? [rootId, ...descendants(index, rootId)]
        .filter((n) => index.children.has(typeof n === "string" ? n : n.id))
        .map((n) => (typeof n === "string" ? n : n.id))
    : [];
  return (
    <div className="subbar">
      <SessionPicker />
      <div className="grow" />
      <button className="icon-btn" title="Expand all" aria-label="Expand all" onClick={() => setExpanded((s) => new Set([...s, ...ids]))}>
        <ChevronsUpDown size={15} strokeWidth={1.6} />
      </button>
      <button
        className="icon-btn"
        title="Collapse all"
        aria-label="Collapse all"
        onClick={() =>
          setExpanded((s) => {
            const n = new Set(s);
            ids.forEach((i) => n.delete(i));
            return n;
          })
        }
      >
        <ChevronsDownUp size={15} strokeWidth={1.6} />
      </button>
      {withModes && (
        <Segmented
          label="Presentation"
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "tree",
              label: (
                <>
                  <ListTree size={13} strokeWidth={1.7} />
                  Tree
                </>
              ),
              title: "Compact hierarchical tree",
            },
            {
              value: "graph",
              label: (
                <>
                  <Network size={13} strokeWidth={1.7} />
                  Graph
                </>
              ),
              title: "Orchestration graph",
            },
          ]}
        />
      )}
    </div>
  );
}

export function Explorer() {
  const { mode, data, index, sessionId, loading } = useStore();
  const rootId = data.sessions.find((s) => s.id === sessionId)?.rootId;
  return (
    <div className="view">
      <ExplorerBar />
      {data.collectorError && <Banner tone="error">Collector error: {data.collectorError}</Banner>}
      {!rootId ? (
        loading ? (
          <SkeletonRows />
        ) : (
          <EmptyState title="No executions to explore">
            The Explorer shows the orchestrator → agent → subagent hierarchy once a session is observed.
          </EmptyState>
        )
      ) : mode === "tree" ? (
        <Tree rootId={rootId} />
      ) : (
        <Suspense fallback={<SkeletonRows />}>
          <Graph rootId={rootId} />
        </Suspense>
      )}
      <div className="statusbar">
        <span>
          <span className="legend-line" /> confirmed delegation
        </span>
        <span>
          <span className="legend-line dotted" /> inferred (process ancestry only)
        </span>
        <span>∥ ran concurrently with a sibling</span>
        <span className="grow" />
        <span>{index.byId.size} agents observed</span>
      </div>
    </div>
  );
}

function Tree({ rootId }: { rootId: string }) {
  const { index, expanded, toggle, selectedId, select, now, setExpanded } = useStore();
  const rows = useMemo(() => visibleRows(index, rootId, expanded), [index, rootId, expanded]);
  const par = useMemo(() => {
    const m = new Map<string, Set<string>>();
    index.children.forEach((kids, pid) => m.set(pid, parallelIds(kids, now)));
    return m;
  }, [index, now]);
  const menu = useMenu();
  const ref = useRef<HTMLDivElement>(null);

  const subtreeToggle = (id: string, open: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      [id, ...descendants(index, id).map((d) => d.id)].forEach((x) => (open ? n.add(x) : n.delete(x)));
      return n;
    });

  const onKey = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.node.id === selectedId);
    const cur = rows[i];
    const go = (r?: Row) => {
      if (r) {
        select(r.node.id);
        ref.current?.querySelector<HTMLElement>(`[data-id="${r.node.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(rows[Math.min(rows.length - 1, i + 1)]);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(rows[Math.max(0, i - 1)]);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (cur?.hasChildren && !cur.open) toggle(cur.node.id);
        else if (cur?.open) go(rows[i + 1]);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur?.open) toggle(cur.node.id);
        else if (cur?.node.parentId) {
          select(cur.node.parentId);
        }
        break;
      case "*":
        if (cur) {
          e.preventDefault();
          subtreeToggle(cur.node.id, true);
        }
        break;
      case "Home":
        e.preventDefault();
        go(rows[0]);
        break;
      case "End":
        e.preventDefault();
        go(rows[rows.length - 1]);
        break;
    }
  };

  return (
    <div className="scroll" ref={ref} tabIndex={0} role="tree" aria-label="Execution hierarchy" onKeyDown={onKey}>
      <div className="thead tree-grid">
        <span>Agent</span>
        <span>Model</span>
        <span className="num" title="Sum of each agent's own usage in this subtree">
          Tokens
        </span>
        <span className="num">Duration</span>
      </div>
      {rows.map((r) => {
        const n = r.node;
        const sibs = n.parentId ? par.get(n.parentId) : undefined;
        const isPar = !!sibs?.has(n.id);
        const kids = index.children.get(n.id) ?? [];
        const runningKids = kids.filter((k) => k.status === "running").length;
        const roll = rollupTokens(index, n.id);
        const dur = durationMs(n, now);
        const brand = nodeBrandColor(n);
        return (
          <div
            key={n.id}
            data-id={n.id}
            role="treeitem"
            aria-level={r.depth + 1}
            aria-expanded={r.hasChildren ? r.open : undefined}
            aria-selected={selectedId === n.id}
            className={`trow tree-grid ${selectedId === n.id ? "selected" : ""} st-${n.status} ${brand ? "brand-row" : ""}`}
            style={brand ? { ["--brand" as string]: brand } : undefined}
            onClick={() => select(n.id)}
            onDoubleClick={() => r.hasChildren && toggle(n.id)}
            onContextMenu={(e) => {
              select(n.id);
              menu.open(e, [
                r.hasChildren
                  ? r.open
                    ? { label: "Collapse", shortcut: "←", onSelect: () => toggle(n.id) }
                    : { label: "Expand", shortcut: "→", onSelect: () => toggle(n.id) }
                  : { label: "Expand", disabled: true },
                { label: "Expand all below", shortcut: "*", disabled: !r.hasChildren, onSelect: () => subtreeToggle(n.id, true) },
                { label: "Collapse all below", disabled: !r.hasChildren, onSelect: () => subtreeToggle(n.id, false) },
                { separator: true, label: "" },
                { label: "Copy ID", onSelect: () => copy(n.id) },
                { label: "Copy label", onSelect: () => copy(n.label) },
              ]);
            }}
          >
            <span className="c-tree">
              {Array.from({ length: r.depth }, (_, d) => {
                const last = r.lastFlags[d];
                const own = d === r.depth - 1;
                return (
                  <i
                    key={d}
                    className={`guide ${own ? "elbow" : ""} ${own && last ? "end" : ""} ${!own && last ? "none" : ""} ${own && n.relationship !== "confirmed" ? "dotted" : ""}`}
                  />
                );
              })}
              <button
                className="twist"
                tabIndex={-1}
                aria-label={r.open ? "Collapse" : "Expand"}
                style={{ visibility: r.hasChildren ? "visible" : "hidden" }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id);
                }}
              >
                {r.open ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronRight size={13} strokeWidth={1.8} />}
              </button>
              <StatusGlyph status={n.status} />
              <span className="label trunc">{n.label}</span>
              {n.level && <span className={`tag tag-role tag-${n.level}`}>{ROLE_LABEL[n.level]}</span>}
              {(r.depth === 0 || n.tool !== index.byId.get(n.parentId ?? "")?.tool) && <span className="tool-tag">{n.tool}</span>}
              {isPar && (
                <span className="tag tag-par" title="Ran concurrently with a sibling">
                  ∥
                </span>
              )}
              {runningKids >= 2 && (
                <span className="tag" title={`${runningKids} children running at the same time`}>
                  {runningKids} parallel
                </span>
              )}
              {n.relationship !== "confirmed" && (
                <span className="tag tag-inf" title={n.relationshipNote ?? "Relationship not confirmed"}>
                  inferred
                </span>
              )}
              {!r.open && r.hasChildren && <span className="muted collapsed-n">{kids.length}</span>}
              {n.activity && <span className="sub trunc">{n.activity}</span>}
            </span>
            <span className="trunc">
              <ModelBadge node={n} compact />
            </span>
            <span className="num mono">
              <Val m={roll.tokens} fmt={fmtTokens} lowerBound={roll.partial && roll.tokens.reliability !== "unavailable"} />
            </span>
            <span className="num mono">
              <Val m={dur} fmt={fmtDuration} />
            </span>
          </div>
        );
      })}
      {menu.node}
    </div>
  );
}
