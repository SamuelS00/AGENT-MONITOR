import type { ReactNode } from "react";
import { ModelBadge } from "./ModelBadge";
import { useStore } from "../app/storeContext";
import { ancestors, durationMs, parallelIds, rollupTokens } from "../model/tree";
import { fmtAgo, fmtClock, fmtDuration, fmtTokens } from "../model/format";
import { ROLE_LABEL, STATUS_HINT } from "../model/status";
import type { AgentEvent } from "../model/types";
import { copy } from "./clipboard";
import { EmptyState, StatusGlyph, Val } from "./primitives";

const Row = ({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) => (
  <div className="kv">
    <dt>{k}</dt>
    <dd className={mono ? "mono" : undefined}>{children}</dd>
  </div>
);
const Section = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="insp-section">
    <h3>
      {title}
      {aside && <span className="insp-aside">{aside}</span>}
    </h3>
    {children}
  </section>
);

const EVENT_GLYPH: Record<AgentEvent["kind"], string> = {
  start: "▸",
  tool: "·",
  spawn: "⑂",
  wait: "◐",
  resume: "▸",
  complete: "✓",
  error: "✕",
  disconnect: "⊘",
};

export function Inspector() {
  const { selectedId, historyId, index, data, now, select, openInExplorer, view } = useStore();
  if (view === "history")
    return historyId ? (
      <HistoryInspector />
    ) : (
      <div className="inspector-body">
        <EmptyState title="No session selected">Select a past session to see its summary.</EmptyState>
      </div>
    );
  const node = selectedId ? index.byId.get(selectedId) : undefined;
  if (!node)
    return (
      <div className="inspector-body">
        <EmptyState title="Nothing selected">
          Select an agent to see its model, usage, events and relationships. Unavailable values stay marked as unavailable.
        </EmptyState>
      </div>
    );

  const kids = index.children.get(node.id) ?? [];
  const par = parallelIds(kids, now);
  const chain = ancestors(index, node.id);
  const roll = rollupTokens(index, node.id);
  const dur = durationMs(node, now);
  const session = data.sessions.find((s) => s.id === node.sessionId);
  const project = data.projects.find((p) => p.id === session?.projectId);
  const parent = node.parentId ? index.byId.get(node.parentId) : undefined;

  return (
    <div className="inspector-body" key={node.id}>
      <header className="insp-head">
        <div className="insp-title">
          <StatusGlyph status={node.status} size={14} />
          <h2>{node.label}</h2>
        </div>
        <div className="insp-sub">
          {ROLE_LABEL[node.role]} · {STATUS_HINT[node.status]}
        </div>
        {node.activity && <div className="insp-activity">{node.activity}</div>}
        {chain.length > 0 && (
          <nav className="crumbs" aria-label="Ancestry">
            {chain.map((a) => (
              <button key={a.id} onClick={() => select(a.id)}>
                {a.label}
              </button>
            ))}
            <span aria-current="true">{node.label}</span>
          </nav>
        )}
      </header>

      <Section title="Overview">
        <dl>
          <Row k="Tool">{node.tool}</Row>
          <Row k="Model">
            <ModelBadge node={node} />
          </Row>
          {node.provider && (
            <Row k="Provider" mono>
              <Val m={node.provider} fmt={String} verbose />
            </Row>
          )}
          <Row k="Project">
            {project ? <span title={project.path}>{project.name}</span> : <span className="val val-na">Unavailable</span>}
          </Row>
          <Row k="Source">{node.source}</Row>
        </dl>
      </Section>

      <Section title="Usage" aside={roll.nodes > 1 && roll.partial ? "subtree is partial" : undefined}>
        <dl>
          <Row k="Duration" mono>
            {node.startedAt === undefined ? <span className="val val-na">Unavailable</span> : <Val m={dur} fmt={fmtDuration} verbose />}
          </Row>
          <Row k="Started" mono>
            {node.startedAt ? (
              `${fmtClock(node.startedAt)} · ${fmtAgo(node.startedAt, now)}`
            ) : (
              <span className="val val-na">Unavailable</span>
            )}
          </Row>
          {node.endedAt && (
            <Row k="Ended" mono>
              {fmtClock(node.endedAt)}
            </Row>
          )}
          {node.lastActivityAt && (
            <Row k="Last activity" mono>
              {fmtAgo(node.lastActivityAt, now)}
            </Row>
          )}
          <Row k="Tokens (own)" mono>
            <Val m={node.tokens} fmt={fmtTokens} verbose />
          </Row>
          {node.tokensIn && (
            <Row k="  input (incl. cache)" mono>
              <Val m={node.tokensIn} fmt={fmtTokens} verbose />
            </Row>
          )}
          {node.cacheReadTokens && (
            <Row k="    cache read" mono>
              <Val m={node.cacheReadTokens} fmt={fmtTokens} verbose />
            </Row>
          )}
          {node.cacheWriteTokens && (
            <Row k="    cache write" mono>
              <Val m={node.cacheWriteTokens} fmt={fmtTokens} verbose />
            </Row>
          )}
          {node.tokensOut && (
            <Row k="  output (incl. reasoning)" mono>
              <Val m={node.tokensOut} fmt={fmtTokens} verbose />
            </Row>
          )}
          {node.reasoningTokens && (
            <Row k="    reasoning" mono>
              <Val m={node.reasoningTokens} fmt={fmtTokens} verbose />
            </Row>
          )}
          {node.costUsd && (
            <Row k="Cost (reported by tool)" mono>
              <Val m={node.costUsd} fmt={(n) => `$${n.toFixed(n < 1 ? 4 : 2)}`} verbose />
            </Row>
          )}
          {kids.length > 0 && (
            <Row k="Tokens (subtree)" mono>
              <Val m={roll.tokens} fmt={fmtTokens} verbose lowerBound={roll.partial} />
            </Row>
          )}
        </dl>
        {kids.length > 0 && <p className="hint">Subtree sums each agent's own usage once. Parents do not include child usage.</p>}
      </Section>

      <Section title="Relationships">
        <dl>
          <Row k="Parent">
            {parent ? (
              <button className="link" onClick={() => select(parent.id)}>
                {parent.label}
              </button>
            ) : (
              <span className="val-quiet">None (session root)</span>
            )}
          </Row>
          <Row k="Link to parent">
            <span className={`rel rel-${node.relationship}`}>
              {node.relationship === "confirmed" ? "Confirmed delegation" : node.relationship === "inferred" ? "Inferred" : "Unavailable"}
            </span>
          </Row>
        </dl>
        {node.relationshipNote && <p className="hint">{node.relationshipNote}</p>}
        {kids.length > 0 && (
          <ul className="rel-list" aria-label="Children">
            {kids.map((k) => (
              <li key={k.id}>
                <button onClick={() => select(k.id)}>
                  <StatusGlyph status={k.status} />
                  <span className="grow trunc">{k.label}</span>
                  {par.has(k.id) && (
                    <span className="tag" title="Ran concurrently with a sibling">
                      ∥
                    </span>
                  )}
                  {k.relationship !== "confirmed" && (
                    <span className="tag" title="Relationship not confirmed">
                      inferred
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {node.waits.length > 0 && (
        <Section title="Waiting">
          <ul className="waits">
            {node.waits.map((w, i) => (
              <li key={i}>
                <span className="mono">
                  {fmtClock(w.start)}
                  {w.end ? ` → ${fmtClock(w.end)}` : " → now"}
                </span>
                <span>{w.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Events" aside={node.events.length ? `${node.events.length}` : undefined}>
        {node.events.length === 0 ? (
          <p className="hint">No events collected. This source does not expose a per-agent event stream.</p>
        ) : (
          <ol className="events">
            {[...node.events].reverse().map((e, i) => (
              <li key={i} className={`ev ev-${e.kind}`}>
                <span className="ev-g" aria-hidden>
                  {EVENT_GLYPH[e.kind]}
                </span>
                <span className="ev-t mono">{fmtClock(e.at)}</span>
                <span className="ev-s">{e.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <footer className="insp-foot">
        <button className="btn" onClick={() => copy(node.id)}>
          Copy ID
        </button>
        {view !== "explorer" && (
          <button className="btn" onClick={() => openInExplorer(node.id)}>
            Open in Explorer
          </button>
        )}
      </footer>
    </div>
  );
}

function HistoryInspector() {
  const { data, historyId, now } = useStore();
  const h = data.history.find((x) => x.id === historyId);
  if (!h) return null;
  return (
    <div className="inspector-body" key={h.id}>
      <header className="insp-head">
        <div className="insp-title">
          <StatusGlyph status={h.status} size={14} />
          <h2>{h.title}</h2>
        </div>
        <div className="insp-sub">
          {h.project} · {h.tool}
        </div>
      </header>
      <Section title="Session">
        <dl>
          <Row k="Model" mono>
            <Val m={h.model} fmt={String} verbose />
          </Row>
          <Row k="Started" mono>
            {new Date(h.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {fmtAgo(h.startedAt, now)}
          </Row>
          <Row k="Duration" mono>
            {fmtDuration(h.durationMs)}
          </Row>
          <Row k="Agents" mono>
            <Val m={h.agents} fmt={String} verbose />
          </Row>
          <Row k="Tokens" mono>
            <Val m={h.tokens} fmt={fmtTokens} verbose />
          </Row>
        </dl>
        <p className="hint">Past sessions show summary data only.</p>
      </Section>
    </div>
  );
}
