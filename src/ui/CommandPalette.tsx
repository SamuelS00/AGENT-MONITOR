import { useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../app/store";
import { useStore } from "../app/storeContext";
import { NAV } from "./nav";
import { STATUS_LABEL } from "../model/status";
import { StatusGlyph, Kbd } from "./primitives";
import type { AgentStatus } from "../model/types";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  shortcut?: string;
  status?: AgentStatus;
  run: () => void;
}

export function CommandPalette() {
  const s = useStore();
  // Query and highlighted index move together: changing the query resets the index,
  // so they share one state object instead of an effect.
  const [sel, setSel] = useState({ q: "", i: 0 });
  const q = sel.q;
  const i = sel.i;
  const setQ = (value: string) => setSel({ q: value, i: 0 });
  const setI = (updater: number | ((prev: number) => number)) =>
    setSel((s) => ({ ...s, i: typeof updater === "function" ? updater(s.i) : updater }));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const close = () => s.setPaletteOpen(false);
    const act = (f: () => void) => () => {
      close();
      f();
    };
    const out: Cmd[] = [
      ...NAV.map((n) => ({
        id: `go-${n.view}`,
        group: "Navigate",
        label: `Go to ${n.label}`,
        shortcut: `⌘${n.key}`,
        run: act(() => s.go(n.view as View)),
      })),
      { id: "go-system", group: "Navigate", label: "Go to Design System", run: act(() => s.go("system")) },
      {
        id: "mode-tree",
        group: "Explorer",
        label: "Show hierarchy as tree",
        run: act(() => {
          s.setMode("tree");
          s.go("explorer");
        }),
      },
      {
        id: "mode-graph",
        group: "Explorer",
        label: "Show hierarchy as graph",
        run: act(() => {
          s.setMode("graph");
          s.go("explorer");
        }),
      },
      {
        id: "expand",
        group: "Explorer",
        label: "Expand all agents",
        run: act(() => s.setExpanded(() => new Set(s.data.nodes.filter((n) => s.index.children.has(n.id)).map((n) => n.id)))),
      },
      { id: "collapse", group: "Explorer", label: "Collapse all agents", run: act(() => s.setExpanded(() => new Set())) },
      { id: "refresh", group: "Actions", label: "Refresh observations", shortcut: "⌘R", run: act(s.refresh) },
      {
        id: "inspector",
        group: "Actions",
        label: s.inspectorOpen ? "Hide inspector" : "Show inspector",
        shortcut: "⌘I",
        run: act(() => s.setInspectorOpen(!s.inspectorOpen)),
      },
      { id: "theme-l", group: "Appearance", label: "Theme: Light", run: act(() => s.setTheme("light")) },
      { id: "theme-d", group: "Appearance", label: "Theme: Dark", run: act(() => s.setTheme("dark")) },
      { id: "theme-s", group: "Appearance", label: "Theme: Match system", run: act(() => s.setTheme("system")) },
      {
        id: "density",
        group: "Appearance",
        label: s.density === "compact" ? "Density: Regular" : "Density: Compact",
        run: act(() => s.setDensity(s.density === "compact" ? "regular" : "compact")),
      },
    ];
    for (const n of s.data.nodes) {
      const sess = s.data.sessions.find((x) => x.id === n.sessionId);
      const proj = s.data.projects.find((p) => p.id === sess?.projectId);
      out.push({
        id: `n-${n.id}`,
        group: "Agents",
        label: n.label,
        hint: `${proj?.name ?? "unknown project"} · ${n.tool} · ${STATUS_LABEL[n.status]}`,
        status: n.status,
        run: act(() => s.openInExplorer(n.id)),
      });
    }
    return out;
  }, [s]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cmds.filter((c) => c.group !== "Agents").concat(cmds.filter((c) => c.group === "Agents").slice(0, 5));
    const score = (c: Cmd) => {
      const label = c.label.toLowerCase();
      const at = label.indexOf(t);
      if (at >= 0) return 1000 - at;
      if (`${c.hint ?? ""} ${c.group}`.toLowerCase().includes(t)) return 500;
      let p = 0; // in-order subsequence, label only, so unrelated metadata cannot match
      for (const ch of t) {
        p = label.indexOf(ch, p) + 1;
        if (!p) return -1;
      }
      return t.length >= 3 ? 1 : -1;
    };
    return cmds
      .map((c) => [c, score(c)] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c)
      .slice(0, 40);
  }, [q, cmds]);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((v) => Math.min(results.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[i]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      s.setPaletteOpen(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={() => s.setPaletteOpen(false)}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={key}
      >
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agents, views and actions"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          spellCheck={false}
        />
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.length === 0 && <div className="palette-empty">No matches for “{q}”.</div>}
          {results.map((c, idx) => {
            const head = idx === 0 || results[idx - 1].group !== c.group ? <div className="palette-group">{c.group}</div> : null;
            return (
              <div key={c.id}>
                {head}
                <div
                  role="option"
                  aria-selected={idx === i}
                  data-i={idx}
                  className={`palette-item ${idx === i ? "on" : ""}`}
                  onMouseMove={() => setI(idx)}
                  onClick={c.run}
                >
                  {c.status && <StatusGlyph status={c.status} />}
                  <span className="trunc">{c.label}</span>
                  {c.hint && <span className="palette-hint trunc">{c.hint}</span>}
                  <span className="grow" />
                  {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
