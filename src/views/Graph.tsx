import { useMemo } from "react";
import { ModelBadge } from "../ui/ModelBadge";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../app/store";
import { parallelIds, rollupTokens, visibleRows } from "../model/tree";
import { fmtTokens } from "../model/format";
import type { AgentNode } from "../model/types";
import { StatusGlyph, Val } from "../ui/primitives";

interface Data extends Record<string, unknown> { node: AgentNode; selected: boolean; open: boolean; hasChildren: boolean; kids: number; par: boolean; tokens: ReturnType<typeof rollupTokens>; onToggle: () => void }

function AgentCard({ data }: NodeProps<Node<Data>>) {
  const { node: n, selected, open, hasChildren, kids, par, tokens, onToggle } = data;
  return (
    <div className={`gnode st-${n.status} ${selected ? "selected" : ""} ${n.relationship !== "confirmed" ? "inferred" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="gnode-top"><StatusGlyph status={n.status} /><span className="trunc gnode-label">{n.label}</span>{par && <span className="tag tag-par" title="Ran concurrently with a sibling">∥</span>}</div>
      <div className="gnode-meta"><ModelBadge node={n} compact /></div>
      <div className="gnode-meta"><span className="trunc">{n.tool}</span><span className="grow" /><span className="mono"><Val m={tokens.tokens} fmt={fmtTokens} lowerBound={tokens.partial && tokens.tokens.reliability !== "unavailable"} /></span></div>
      {hasChildren && <button className="gnode-toggle nodrag" aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{open ? <ChevronDown size={12} /> : <><ChevronRight size={12} />{kids}</>}</button>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { agent: AgentCard };

const W = 244, H = 74, GX = 52, GY = 14;

export default function Graph({ rootId }: { rootId: string }) {
  const { index, expanded, toggle, selectedId, select, resolvedTheme, now } = useStore();
  const { nodes, edges } = useMemo(() => {
    const rows = visibleRows(index, rootId, expanded);
    const shown = new Set(rows.map((r) => r.node.id));
    let leaf = 0;
    const y = new Map<string, number>();
    const place = (id: string): number => {
      const kids = (index.children.get(id) ?? []).filter((k) => shown.has(k.id));
      if (!kids.length) { const v = leaf++ * (H + GY); y.set(id, v); return v; }
      const ys = kids.map((k) => place(k.id));
      const v = (ys[0] + ys[ys.length - 1]) / 2; y.set(id, v); return v;
    };
    place(rootId);
    const nodes: Node<Data>[] = rows.map((r) => ({
      id: r.node.id, type: "agent", position: { x: r.depth * (W + GX), y: y.get(r.node.id) ?? 0 }, width: W, height: H, draggable: false, selectable: false,
      data: { node: r.node, selected: selectedId === r.node.id, open: r.open, hasChildren: r.hasChildren, kids: (index.children.get(r.node.id) ?? []).length,
        par: !!(r.node.parentId && parallelIds(index.children.get(r.node.parentId) ?? [], now).has(r.node.id)), tokens: rollupTokens(index, r.node.id), onToggle: () => toggle(r.node.id) },
    }));
    const edges: Edge[] = rows.filter((r) => r.node.parentId && shown.has(r.node.parentId)).map((r) => ({
      id: `${r.node.parentId}-${r.node.id}`, source: r.node.parentId!, target: r.node.id, type: "smoothstep",
      className: `${r.node.relationship !== "confirmed" ? "edge-inferred" : ""} ${r.node.status === "running" ? "edge-running" : ""}`,
      label: r.node.relationship !== "confirmed" ? "inferred" : undefined,
    }));
    return { nodes, edges };
  }, [index, rootId, expanded, selectedId, toggle, now]);

  return (
    <div className="graph" aria-label="Orchestration graph">
      <ReactFlow key={rootId} nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={resolvedTheme} fitView fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.3} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => select(n.id)} onPaneClick={() => select(undefined)}>
        <Background gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
