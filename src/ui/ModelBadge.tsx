import type { AgentNode } from "../model/types";
import { BRAND_PATHS } from "./brandIcons";
import { BRAND_COLOR, BRAND_NAME, brandOf, splitModel, type Brand } from "./brand";

function Logo({ brand, size }: { brand: Brand; size: number }) {
  const paths = brand === "unknown" ? undefined : BRAND_PATHS[brand];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor" fillRule="evenodd">
      {paths ? (
        paths.map((d, k) => <path key={k} d={d} />)
      ) : (
        <path d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 2v14h14V5H5zm3 6h8v2H8v-2z" />
      )}
    </svg>
  );
}

/** Provider-colored badge: logo, model name, version and reasoning effort. Unavailable parts are omitted, never invented. */
export function ModelBadge({
  node,
  compact = false,
}: {
  node: Pick<AgentNode, "model" | "provider" | "effort" | "tool">;
  compact?: boolean;
}) {
  const model = node.model.reliability !== "unavailable" ? node.model.value : undefined;
  if (!model)
    return (
      <span
        className="val val-na"
        title={`Unavailable${node.model.source ? ` · ${node.model.source}` : ""}`}
        aria-label="Model unavailable"
      >
        —
      </span>
    );
  const brand = brandOf(node.provider?.value, model, node.tool);
  const { name, version } = splitModel(model);
  const effort = node.effort?.reliability !== "unavailable" ? node.effort?.value : undefined;
  const estimated = node.model.reliability === "inferred";
  const title = `${model}${node.provider?.value ? ` · provider ${node.provider.value}` : ` · ${BRAND_NAME[brand]} (from model name)`}${effort ? ` · effort ${effort}` : ""}${estimated ? " · inferred" : ""}${node.model.source ? ` · ${node.model.source}` : ""}`;
  return (
    <span className={`mbadge ${compact ? "mbadge-compact" : ""}`} style={{ ["--brand" as string]: BRAND_COLOR[brand] }} title={title}>
      <Logo brand={brand} size={compact ? 11 : 12} />
      {estimated && <span aria-hidden>≈</span>}
      <span className="mbadge-name">{name}</span>
      {version && <span className="mbadge-ver">v{version}</span>}
      {effort && <span className="mbadge-eff">{effort}</span>}
    </span>
  );
}
