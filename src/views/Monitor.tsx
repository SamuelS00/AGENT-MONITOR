import { useMemo, useRef, useState } from "react";
import { ModelBadge } from "../ui/ModelBadge";
import { nodeBrandColor } from "../ui/brand";
import { useStore } from "../app/storeContext";
import { descendants, durationMs, rollupTokens, sessionStatus } from "../model/tree";
import { fmtDuration, fmtTokens } from "../model/format";
import { STATUS_ORDER, isActive } from "../model/status";
import type { AgentStatus } from "../model/types";
import { Banner, EmptyState, SkeletonRows, StatusGlyph, Val } from "../ui/primitives";
import { copy } from "../ui/clipboard";
import { useMenu } from "../ui/useMenu";

type Scope = "active" | "attention" | "all";
const attention = (s: AgentStatus) => s === "waiting" || s === "failed" || s === "disconnected";

export function Monitor() {
  const st = useStore();
  const { data, index, now, projectFilter, selectedId, select, openInExplorer, loading, source, setSource, canLive } = st;
  const [scope, setScope] = useState<Scope>("active");
  const [q, setQ] = useState("");
  const menu = useMenu();
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () =>
      data.sessions
        .map((s) => {
          const root = index.byId.get(s.rootId)!;
          const status = sessionStatus(index, s.rootId);
          const all = [root, ...descendants(index, s.rootId)];
          return {
            s,
            root,
            status,
            agents: all.length,
            running: all.filter((n) => n.status === "running").length,
            waiting: all.filter((n) => n.status === "waiting").length,
            roll: rollupTokens(index, s.rootId),
          };
        })
        .filter((r) => r.root),
    [data.sessions, index],
  );

  const counts = {
    active: rows.filter((r) => isActive(r.status)).length,
    attention: rows.filter((r) => attention(r.status)).length,
    all: rows.length,
  };
  const visible = rows
    .filter((r) => !projectFilter || r.s.projectId === projectFilter)
    .filter((r) => scope === "all" || (scope === "active" ? isActive(r.status) : attention(r.status)))
    .filter((r) => !q || `${r.s.title} ${r.root.tool} ${r.root.model.value ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const groups = data.projects
    .filter((p) => !projectFilter || p.id === projectFilter)
    .map((p) => ({
      p,
      items: visible
        .filter((r) => r.s.projectId === p.id)
        .sort(
          (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.root.startedAt ?? 0) - (a.root.startedAt ?? 0),
        ),
    }))
    .filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);

  const onKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex((r) => r.root.id === selectedId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = flat[Math.min(flat.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        select(next.root.id);
        listRef.current?.querySelector<HTMLElement>(`[data-id="${next.root.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter" && i >= 0) openInExplorer(flat[i].root.id);
  };

  return (
    <div className="view">
      <div className="subbar">
        <div className="seg" role="radiogroup" aria-label="Scope">
          {(
            [
              ["active", "Active"],
              ["attention", "Needs attention"],
              ["all", "All"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={scope === v} className={scope === v ? "on" : ""} onClick={() => setScope(v)}>
              {label}
              <span className="seg-count">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <input
          className="field"
          type="search"
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {data.collectorError && <Banner tone="error">Collector error: {data.collectorError}</Banner>}
      <div className="scroll" ref={listRef} tabIndex={0} onKeyDown={onKey} aria-label="Sessions">
        {loading && data.sessions.length === 0 ? (
          <SkeletonRows />
        ) : groups.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              title="No agent processes observed"
              action={
                canLive && source === "live" ? (
                  <button className="btn" onClick={() => setSource("sample")}>
                    Preview with sample data
                  </button>
                ) : undefined
              }
            >
              Start Claude Code, Codex, OpenCode or Gemini CLI in a terminal. The collector only reports what it can verify locally.
            </EmptyState>
          ) : (
            <EmptyState title="Nothing matches this filter">
              {scope === "active"
                ? "No active sessions right now. Switch to All to see finished ones."
                : "Adjust the scope or the text filter."}
            </EmptyState>
          )
        ) : (
          <div className="table" role="table" aria-label="Sessions by project">
            <div className="thead" role="row">
              <span role="columnheader" />
              <span role="columnheader">Session</span>
              <span role="columnheader">Tool · model</span>
              <span role="columnheader" className="num">
                Agents
              </span>
              <span role="columnheader" className="num">
                Duration
              </span>
              <span role="columnheader" className="num">
                Tokens
              </span>
            </div>
            {groups.map(({ p, items }) => (
              <div key={p.id} role="rowgroup">
                <div className="group-head">
                  <span className="group-name">{p.name}</span>
                  {p.path && <span className="group-path mono">{p.path}</span>}
                  <span className="grow" />
                  <span className="group-meta">
                    {items.filter((r) => isActive(r.status)).length} active · {items.length} shown
                  </span>
                </div>
                {items.map(({ s, root, status, agents, running, waiting, roll }) => {
                  const dur = durationMs(root, now);
                  return (
                    <div
                      key={s.id}
                      role="row"
                      data-id={root.id}
                      className={`trow session ${selectedId === root.id ? "selected" : ""} st-${status} ${nodeBrandColor(root) ? "brand-row" : ""}`}
                      style={nodeBrandColor(root) ? { ["--brand" as string]: nodeBrandColor(root) } : undefined}
                      onClick={() => select(root.id)}
                      onDoubleClick={() => openInExplorer(root.id)}
                      onContextMenu={(e) => {
                        select(root.id);
                        menu.open(e, [
                          { label: "Open in Execution Explorer", shortcut: "↵", onSelect: () => openInExplorer(root.id) },
                          { label: "Copy session ID", onSelect: () => copy(s.id) },
                          { label: "Copy working directory", disabled: !p.path, onSelect: () => p.path && copy(p.path) },
                        ]);
                      }}
                    >
                      <span role="cell" className="c-status">
                        <StatusGlyph status={status} />
                      </span>
                      <span role="cell" className="c-main">
                        <span className="title trunc">{s.title}</span>
                        {(isActive(status) ? running > 0 || waiting > 0 || root.activity : root.activity) && (
                          <span className="sub trunc">
                            {[running > 0 && `${running} running`, waiting > 0 && `${waiting} waiting`].filter(Boolean).join(", ")}
                            {(running > 0 || waiting > 0) && root.activity ? " · " : ""}
                            {root.activity}
                          </span>
                        )}
                      </span>
                      <span role="cell" className="c-main c-tool">
                        <span className="trunc">{root.tool}</span>
                        <span className="sub trunc">
                          <ModelBadge node={root} compact />
                        </span>
                      </span>
                      <span role="cell" className="num mono">
                        {agents}
                      </span>
                      <span role="cell" className="num mono">
                        <Val m={dur} fmt={fmtDuration} />
                      </span>
                      <span role="cell" className="num mono">
                        <Val m={roll.tokens} fmt={fmtTokens} lowerBound={roll.partial && roll.tokens.reliability !== "unavailable"} />
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="statusbar">
        <span>≈ inferred or estimated · — unavailable · ≥ lower bound</span>
        <span className="grow" />
        <span>↑↓ select · ↵ open · right-click for actions</span>
      </div>
      {menu.node}
    </div>
  );
}
