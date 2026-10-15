import { useStore } from "../app/storeContext";
import { fmtDuration, fmtTokens } from "../model/format";
import { describe, isOrchestration, summarize, tokensByModel } from "../model/orchestration";
import { ROLE_LABEL } from "../model/status";
import { durationMs } from "../model/tree";
import { ModelBadge } from "./ModelBadge";
import { Val } from "./primitives";

const OUTCOME: Record<ReturnType<typeof summarize>["outcome"], string> = {
  running: "Running",
  "needs-input": "Needs input",
  failed: "Failed",
  finished: "Finished",
};

export function OutcomeChip({ outcome }: { outcome: ReturnType<typeof summarize>["outcome"] }) {
  return <span className={`orch-outcome orch-${outcome}`}>{OUTCOME[outcome]}</span>;
}

/** What the orchestration is and how it went, above its tree. */
export function OrchestrationSummary({ rootId }: { rootId: string }) {
  const { index, now } = useStore();
  const root = index.byId.get(rootId);
  if (!root || !isOrchestration(root)) return null;
  const s = summarize(index, rootId);
  const byModel = tokensByModel(index, rootId);
  const dur = durationMs(root, now);
  return (
    <div className="orch-summary" role="group" aria-label="Orchestration summary">
      <OutcomeChip outcome={s.outcome} />
      <span className="orch-meta">
        {ROLE_LABEL[root.level ?? "meta"]} <ModelBadge node={root} compact />
      </span>
      <span className="orch-counts">{describe(s) || "No delegated work recorded"}</span>
      <span className="grow" />
      <span className="mono">
        <Val m={s.tokens.tokens} fmt={fmtTokens} lowerBound={s.tokens.partial && s.tokens.tokens.reliability !== "unavailable"} /> tokens
      </span>
      <span className="mono">
        <Val m={dur} fmt={fmtDuration} />
      </span>
      <details className="orch-tokens-model">
        <summary>Tokens by model</summary>
        <div className="orch-tokens-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Nodes</th>
                <th>In</th>
                <th>Out</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {byModel.models.map((item) => (
                <tr key={item.modelId}>
                  <td>
                    <ModelBadge node={{ model: item.model, provider: root.provider, effort: undefined, tool: root.tool }} compact />
                  </td>
                  <td>{item.nodes}</td>
                  <td>
                    <Val m={item.tokensIn} fmt={fmtTokens} />
                  </td>
                  <td>
                    <Val m={item.tokensOut} fmt={fmtTokens} />
                  </td>
                  <td>
                    <Val m={item.total} fmt={fmtTokens} />
                  </td>
                </tr>
              ))}
              {byModel.models.length === 0 && (
                <tr>
                  <td colSpan={5}>No model token data available</td>
                </tr>
              )}
            </tbody>
          </table>
          {byModel.unavailableNodes > 0 && (
            <p>
              {byModel.unavailableNodes} {byModel.unavailableNodes === 1 ? "node" : "nodes"} with unavailable model or tokens
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
