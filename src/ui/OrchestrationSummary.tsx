import { useStore } from "../app/storeContext";
import { fmtDuration, fmtTokens } from "../model/format";
import { describe, isOrchestration, summarize } from "../model/orchestration";
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

/** What the orchestration is and how it went, above its tree. */
export function OrchestrationSummary({ rootId }: { rootId: string }) {
  const { index, now } = useStore();
  const root = index.byId.get(rootId);
  if (!root || !isOrchestration(root)) return null;
  const s = summarize(index, rootId);
  const dur = durationMs(root, now);
  return (
    <div className="orch-summary" role="group" aria-label="Orchestration summary">
      <span className={`orch-outcome orch-${s.outcome}`}>{OUTCOME[s.outcome]}</span>
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
    </div>
  );
}
