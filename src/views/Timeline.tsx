import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../app/storeContext";
import { concurrency, descendants, endOf, isLive, visibleRows } from "../model/tree";
import { fmtClock, fmtDate, fmtDuration, fmtShortClock } from "../model/format";
import { STATUS_LABEL } from "../model/status";
import { Banner, EmptyState, Segmented, StatusGlyph } from "../ui/primitives";
import { ExplorerBar } from "./Explorer";

type Range = "fit" | "15m" | "1h";
const HOUR = 3_600;
const STEPS = [
  10,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
  2 * 24 * HOUR,
  7 * 24 * HOUR,
].map((s) => s * 1000);
const MAX_TICKS = 8;

/** Axis label that stays unambiguous: seconds for tight ranges, a date once the range or step reaches a day. */
function tickLabel(t: number, step: number, spanMs: number) {
  if (step >= 24 * HOUR * 1000) return fmtDate(t);
  if (spanMs > 24 * HOUR * 1000) return `${fmtDate(t)} ${fmtShortClock(t)}`;
  return step < 60_000 ? fmtClock(t) : fmtShortClock(t);
}

export function Timeline() {
  const { index, data, sessionId, expanded, toggle, selectedId, select, now } = useStore();
  const [range, setRange] = useState<Range>("fit");
  const rootId = data.sessions.find((s) => s.id === sessionId)?.rootId;
  const rows = useMemo(() => (rootId ? visibleRows(index, rootId, expanded) : []), [index, rootId, expanded]);
  const all = useMemo(() => (rootId ? [index.byId.get(rootId)!, ...descendants(index, rootId)] : []), [index, rootId]);

  if (!rootId)
    return (
      <div className="view">
        <ExplorerBar withModes={false} />
        <EmptyState title="No session to chart">
          The timeline plots when each agent started, waited and finished once a session is observed.
        </EmptyState>
      </div>
    );

  const starts = all.map((n) => n.startedAt).filter((v): v is number => v !== undefined);
  const first = starts.length ? Math.min(...starts) : now - 15 * 60_000;
  const span = range === "fit" ? Math.max(60_000, now - first) : range === "15m" ? 15 * 60_000 : 60 * 60_000;
  const t0 = range === "fit" ? first - span * 0.02 : now - span;
  const t1 = now + span * 0.04;
  const pct = (t: number) => ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * 100;
  const step = STEPS.find((s) => (t1 - t0) / s <= MAX_TICKS) ?? STEPS[STEPS.length - 1];
  const ticks: number[] = [];
  // Align to local clock boundaries (not UTC) so "06:00" lands on 06:00 for the viewer.
  const tz = -new Date(t0).getTimezoneOffset() * 60_000;
  for (let k = Math.ceil((t0 + tz) / step); ticks.length < 24; k++) {
    const t = k * step - tz;
    if (t > t1) break;
    ticks.push(t);
  }

  const series = concurrency(all, now);
  const peak = Math.max(1, ...series.map((p) => p.n));
  const path = (() => {
    if (!series.length) return "";
    let d = `M0 100`;
    let prevN = 0;
    for (const p of series) {
      const x = pct(p.t) * 10;
      d += ` L${x} ${100 - (prevN / peak) * 100} L${x} ${100 - (p.n / peak) * 100}`;
      prevN = p.n;
    }
    return `${d} L${pct(now) * 10} ${100 - (prevN / peak) * 100} L${pct(now) * 10} 100 Z`;
  })();

  const onKey = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.node.id === selectedId);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      select(rows[Math.min(rows.length - 1, i + 1)]?.node.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      select(rows[Math.max(0, i - 1)]?.node.id);
    }
  };

  return (
    <div className="view">
      <ExplorerBar withModes={false} />
      <div className="subbar subbar-2">
        <Segmented
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: "fit", label: "Fit session" },
            { value: "15m", label: "Last 15m" },
            { value: "1h", label: "Last hour" },
          ]}
        />
      </div>
      {data.collectorError && <Banner tone="error">Collector error: {data.collectorError}</Banner>}
      <div className="scroll tl" tabIndex={0} onKeyDown={onKey} role="grid" aria-label="Agent timeline">
        <div className="tl-inner">
          <div className="tl-row tl-head">
            <div className="tl-label tl-corner">Agent</div>
            <div className="tl-canvas">
              {ticks.map((t) => (
                <span key={t} className="tick mono" style={{ left: `${pct(t)}%` }}>
                  {tickLabel(t, step, t1 - t0)}
                </span>
              ))}
            </div>
          </div>
          <div className="tl-row tl-conc">
            <div className="tl-label">
              <span>Concurrency</span>
              <span className="muted mono">peak {peak}</span>
            </div>
            <div className="tl-canvas">
              {ticks.map((t) => (
                <i key={t} className="grid" style={{ left: `${pct(t)}%` }} />
              ))}
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-label={`Concurrent running agents, peak ${peak}`}>
                <path d={path} />
              </svg>
            </div>
          </div>
          {rows.map(({ node: n, depth, hasChildren, open }) => {
            const end = endOf(n, now);
            const hasBar = n.startedAt !== undefined && end !== undefined && end >= t0 && n.startedAt <= t1;
            const live = n.endedAt === undefined && isLive(n.status);
            return (
              <div
                key={n.id}
                className={`tl-row trow ${selectedId === n.id ? "selected" : ""}`}
                onClick={() => select(n.id)}
                role="row"
                aria-selected={selectedId === n.id}
              >
                <div className="tl-label" style={{ paddingLeft: 8 + depth * 14 }}>
                  <button
                    className="twist"
                    tabIndex={-1}
                    style={{ visibility: hasChildren ? "visible" : "hidden" }}
                    aria-label={open ? "Collapse" : "Expand"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(n.id);
                    }}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <StatusGlyph status={n.status} />
                  <span className="trunc" title={n.activity ? `${n.label} · ${n.activity}` : n.label}>
                    {n.label}
                  </span>
                </div>
                <div className="tl-canvas">
                  {ticks.map((t) => (
                    <i key={t} className="grid" style={{ left: `${pct(t)}%` }} />
                  ))}
                  {hasBar && (
                    <span
                      className={`bar bar-${n.status} ${live ? "bar-live" : ""} ${n.startedAt! < t0 ? "clip-l" : ""}`}
                      style={{ left: `${pct(n.startedAt!)}%`, width: `${Math.max(0.35, pct(end!) - pct(n.startedAt!))}%` }}
                      title={`${n.label} · ${STATUS_LABEL[n.status]}\n${fmtClock(n.startedAt!)} → ${n.endedAt ? fmtClock(n.endedAt) : live ? "now" : `${fmtClock(end!)} (last activity)`} (${fmtDuration(end! - n.startedAt!)})`}
                    >
                      {n.waits.map((w, i) => (
                        <span
                          key={i}
                          className="wait"
                          style={{
                            left: `${((w.start - n.startedAt!) / Math.max(1, end! - n.startedAt!)) * 100}%`,
                            width: `${(((w.end ?? end!) - w.start) / Math.max(1, end! - n.startedAt!)) * 100}%`,
                          }}
                          title={w.reason}
                        />
                      ))}
                      {n.status === "failed" && (
                        <span className="bar-x" aria-hidden>
                          ✕
                        </span>
                      )}
                    </span>
                  )}
                  {n.startedAt === undefined && <span className="tl-na">No timing data from this source</span>}
                  {n.status === "disconnected" && n.endedAt !== undefined && (
                    <span
                      className="bar-lost"
                      style={{ left: `${pct(n.endedAt)}%`, width: `${pct(now) - pct(n.endedAt)}%` }}
                      title="Last seen here; final state unknown"
                    />
                  )}
                </div>
              </div>
            );
          })}
          <div className="tl-now" style={{ ["--p" as string]: pct(now) / 100 }} aria-hidden>
            <span>now</span>
          </div>
        </div>
      </div>
      <div className="statusbar">
        <span className="legend">
          <i className="sw sw-run" />
          running <i className="sw sw-wait" />
          waiting <i className="sw sw-done" />
          completed <i className="sw sw-fail" />
          failed <i className="sw sw-disc" />
          disconnected
        </span>
        <span>hatched = waiting</span>
        <span className="grow" />
        <span>↑↓ select</span>
      </div>
    </div>
  );
}
