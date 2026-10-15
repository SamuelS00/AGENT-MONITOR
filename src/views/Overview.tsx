import { useStore } from "../app/storeContext";
import { confirmed, fmtAgo, fmtDuration, fmtTokens, unavailable } from "../model/format";
import { describe, isOrchestration, lastActive, modelsUsed, summarize } from "../model/orchestration";
import { durationMs } from "../model/tree";
import { ModelBadge } from "../ui/ModelBadge";
import { OutcomeChip } from "../ui/OrchestrationSummary";
import { Val } from "../ui/primitives";

/** All recorded orchestration roots, independent of the selected project or session. */
export function Overview() {
  const { data, index, now, openInExplorer } = useStore();
  const roots = index.roots.filter(isOrchestration).sort((a, b) => lastActive(index, b.id, now) - lastActive(index, a.id, now));
  return (
    <div className="view overview">
      <div className="scroll">
        <div className="table overview-table" role="table" aria-label="Orchestrations">
          <div className="thead overview-grid" role="row">
            {["Orchestration", "Outcome", "Meta tool", "Models used", "Work", "Tokens", "Duration", "Last activity"].map((label) => (
              <span key={label} role="columnheader">
                {label}
              </span>
            ))}
          </div>
          {roots.map((root) => {
            const summary = summarize(index, root.id);
            const active = lastActive(index, root.id, now);
            const session = data.sessions.find((s) => s.rootId === root.id);
            const project = data.projects.find((p) => p.id === session?.projectId);
            return (
              <div
                key={root.id}
                role="row"
                tabIndex={0}
                className="trow overview-grid"
                aria-label={`Open ${root.activity ?? root.label} in Execution Explorer`}
                onClick={() => openInExplorer(root.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    openInExplorer(root.id);
                  }
                }}
              >
                <span role="cell" className="c-main">
                  <span className="title trunc">{root.activity ?? root.label}</span>
                  <span className="muted trunc" title={root.id}>
                    {project?.name ?? "No project"} · #{root.id.slice(-4)}
                  </span>
                </span>
                <span role="cell">
                  <OutcomeChip outcome={summary.outcome} />
                </span>
                <span role="cell" className="overview-badges">
                  <span>{root.tool}</span>
                  <ModelBadge node={root} compact />
                </span>
                <span role="cell" className="overview-badges">
                  {modelsUsed(index, root.id).map((node) => (
                    <ModelBadge key={node.id} node={node} compact />
                  ))}
                </span>
                <span role="cell">{describe(summary) || "No delegated work recorded"}</span>
                <span role="cell" className="mono num">
                  <Val m={summary.tokens.tokens} fmt={fmtTokens} lowerBound={summary.tokens.partial} />
                </span>
                <span role="cell" className="mono num">
                  <Val m={durationMs(root, now)} fmt={fmtDuration} />
                </span>
                <span role="cell" className="mono num">
                  <Val
                    m={
                      active > 0
                        ? confirmed(active, "Latest activity across orchestration tree")
                        : unavailable<number>("No recorded activity or start")
                    }
                    fmt={(at) => fmtAgo(at, now)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="statusbar">Select an orchestration to open its Execution Explorer. Partial token totals are lower bounds.</div>
    </div>
  );
}
