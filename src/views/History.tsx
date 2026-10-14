import { useMemo, useState } from "react";
import { useStore } from "../app/storeContext";
import { fmtAgo, fmtDate, fmtDuration, fmtShortClock, fmtTokens } from "../model/format";
import type { HistorySession } from "../model/types";
import { EmptyState, Segmented, StatusGlyph, Val } from "../ui/primitives";

type Group = "project" | "model" | "tool";
type SortKey = "startedAt" | "title" | "durationMs" | "tokens";
const PERIODS = { "7d": 7, "30d": 30, all: 3650 } as const;
const tok = (h: HistorySession) => (h.tokens.reliability === "unavailable" ? undefined : h.tokens.value);

export function History() {
  const { data, now, historyId, selectHistory, source, setSource, canLive } = useStore();
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<keyof typeof PERIODS>("30d");
  const [group, setGroup] = useState<Group>("project");
  const [tool, setTool] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "startedAt", dir: -1 });

  const base = data.history;
  const rows = useMemo(
    () =>
      base
        .filter((h) => h.startedAt >= now - PERIODS[period] * 86_400_000)
        .filter((h) => (!tool || h.tool === tool) && (!project || h.project === project) && (!status || h.status === status))
        .filter((h) => !q || `${h.title} ${h.project} ${h.tool} ${h.model.value ?? ""}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => {
          const va = sort.key === "tokens" ? (tok(a) ?? -1) : sort.key === "title" ? a.title : a[sort.key];
          const vb = sort.key === "tokens" ? (tok(b) ?? -1) : sort.key === "title" ? b.title : b[sort.key];
          return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        }),
    [base, now, period, tool, project, status, q, sort],
  );

  if (base.length === 0)
    return (
      <div className="view">
        <EmptyState
          title="No history yet"
          action={
            canLive && source === "live" ? (
              <button className="btn" onClick={() => setSource("sample")}>
                Preview with sample data
              </button>
            ) : undefined
          }
        >
          The collector does not expose persisted sessions yet. Analytics will appear here once completed sessions are stored locally.
        </EmptyState>
      </div>
    );

  const withTokens = rows.filter((h) => tok(h) !== undefined);
  const noTokens = rows.length - withTokens.length;
  const totalTokens = withTokens.reduce((s, h) => s + (tok(h) ?? 0), 0);
  const days = Math.min(PERIODS[period], 30);
  const perDay = Array.from({ length: days }, (_, i) => {
    const end = now - i * 86_400_000,
      start = end - 86_400_000;
    const inDay = rows.filter((h) => h.startedAt > start && h.startedAt <= end);
    return {
      end,
      tokens: inDay.reduce((s, h) => s + (tok(h) ?? 0), 0),
      sessions: inDay.length,
      missing: inDay.filter((h) => tok(h) === undefined).length,
    };
  }).reverse();
  const maxDay = Math.max(1, ...perDay.map((d) => d.tokens));

  const key = (h: HistorySession) => (group === "project" ? h.project : group === "tool" ? h.tool : (h.model.value ?? "Unavailable"));
  const agg = new Map<string, { n: number; tokens: number; withTok: number; dur: number; failed: number }>();
  for (const h of rows) {
    const a = agg.get(key(h)) ?? { n: 0, tokens: 0, withTok: 0, dur: 0, failed: 0 };
    a.n++;
    a.dur += h.durationMs;
    if (h.status === "failed") a.failed++;
    if (tok(h) !== undefined) {
      a.tokens += tok(h)!;
      a.withTok++;
    }
    agg.set(key(h), a);
  }
  const groups = [...agg.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  const maxG = Math.max(1, ...groups.map(([, a]) => a.tokens));
  const uniq = (f: (h: HistorySession) => string | undefined) => [...new Set(base.map(f).filter(Boolean) as string[])].sort();
  const th = (k: SortKey, label: string, cls = "") => (
    <button
      role="columnheader"
      className={`th-btn ${cls}`}
      aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }))}
    >
      {label}
      {sort.key === k && <span aria-hidden>{sort.dir === 1 ? " ↑" : " ↓"}</span>}
    </button>
  );

  return (
    <div className="view">
      <div className="subbar">
        <input
          className="field"
          type="search"
          placeholder="Search sessions, projects, models"
          aria-label="Search history"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 170 }}
        />
        <select className="field" aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {uniq((h) => h.project).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select className="field" aria-label="Tool" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="">All tools</option>
          {uniq((h) => h.tool).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select className="field" aria-label="Outcome" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any outcome</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="disconnected">Disconnected</option>
        </select>
        <div className="grow" />
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <div className="scroll">
        <section className="analytics">
          <div className="an-chart">
            <div className="an-head">
              <h3>Tokens per day</h3>
              <span className="muted">
                {rows.length} sessions · {withTokens.length ? fmtTokens(totalTokens) : "—"} tokens
                {noTokens > 0 && ` · ${noTokens} without usage data (not counted)`}
              </span>
            </div>
            <div className="bars" role="img" aria-label="Tokens per day, last 30 days">
              {perDay.map((d, i) => (
                <div
                  key={i}
                  className="bar-col"
                  title={`${fmtDate(d.end)} · ${d.sessions} sessions · ${d.tokens ? fmtTokens(d.tokens) : "no"} tokens${d.missing ? ` · ${d.missing} without usage data` : ""}`}
                >
                  <span className="bar-fill" style={{ height: `${(d.tokens / maxDay) * 100}%` }} />
                  {d.missing > 0 && <span className="bar-missing" aria-hidden />}
                </div>
              ))}
            </div>
            <div className="bar-axis mono">
              <span>{fmtDate(perDay[0].end)}</span>
              <span>{fmtDate(perDay[perDay.length - 1].end)}</span>
            </div>
          </div>
          <div className="an-table">
            <div className="an-head">
              <h3>Breakdown</h3>
              <Segmented
                label="Group by"
                value={group}
                onChange={setGroup}
                options={[
                  { value: "project", label: "Project" },
                  { value: "model", label: "Model" },
                  { value: "tool", label: "Tool" },
                ]}
              />
            </div>
            <div className="table" role="table">
              <div className="thead agg-grid" role="row">
                <span className="cap-first">{group}</span>
                <span className="num">Sessions</span>
                <span>Tokens</span>
                <span className="num">Avg dur.</span>
                <span className="num">Failed</span>
              </div>
              {groups.map(([name, a]) => (
                <div key={name} className="trow agg-grid" role="row">
                  <span className="trunc mono-ish">{name}</span>
                  <span className="num mono">{a.n}</span>
                  <span className="meter-cell">
                    <span className="meter">
                      <i style={{ width: `${(a.tokens / maxG) * 100}%` }} />
                    </span>
                    <span className="mono">
                      {a.withTok ? fmtTokens(a.tokens) : "—"}
                      {a.withTok < a.n && (
                        <span className="muted" title={`${a.n - a.withTok} sessions have no usage data`}>
                          {" "}
                          ≥
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="num mono">{fmtDuration(a.dur / a.n)}</span>
                  <span className="num mono">{a.failed ? `${a.failed} (${Math.round((a.failed / a.n) * 100)}%)` : "0"}</span>
                </div>
              ))}
              {groups.length === 0 && <div className="table-empty">No sessions match.</div>}
            </div>
          </div>
        </section>
        <div className="table sessions-table" role="table" aria-label="Sessions">
          <div className="thead hist-grid" role="row">
            <span /> {th("title", "Session")}
            <span role="columnheader">Project</span>
            <span role="columnheader">Tool</span>
            <span role="columnheader">Model</span>
            {th("durationMs", "Duration", "num")}
            {th("tokens", "Tokens", "num")}
            {th("startedAt", "Started", "num")}
          </div>
          {rows.map((h) => (
            <div
              key={h.id}
              role="row"
              className={`trow hist-grid ${historyId === h.id ? "selected" : ""}`}
              onClick={() => selectHistory(h.id)}
            >
              <span>
                <StatusGlyph status={h.status} />
              </span>
              <span className="trunc">{h.title}</span>
              <span className="trunc">{h.project}</span>
              <span className="trunc">{h.tool}</span>
              <span className="mono trunc">
                <Val m={h.model} fmt={String} />
              </span>
              <span className="num mono">{fmtDuration(h.durationMs)}</span>
              <span className="num mono">
                <Val m={h.tokens} fmt={fmtTokens} />
              </span>
              <span className="num mono" title={new Date(h.startedAt).toLocaleString()}>
                {fmtDate(h.startedAt)} {fmtShortClock(h.startedAt)} <span className="muted">· {fmtAgo(h.startedAt, now)}</span>
              </span>
            </div>
          ))}
          {rows.length === 0 && <EmptyState title="No sessions match these filters">Widen the period or clear a filter.</EmptyState>}
        </div>
      </div>
      <div className="statusbar">
        <span>Sessions without usage data are listed but never counted as zero tokens.</span>
      </div>
    </div>
  );
}
