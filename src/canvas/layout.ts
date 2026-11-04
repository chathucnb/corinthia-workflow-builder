import dagre from '@dagrejs/dagre';
import { isAnnotation } from '../nodes/registry';
import type { FlowEdge, FlowNode } from '../types';

/** Left-to-right auto layout for top-level logic blocks (frames/notes untouched). */
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const movable = nodes.filter((n) => !isAnnotation(n.type) && !n.parentId);
  if (!movable.length) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(movable.map((n) => n.id));
  movable.forEach((n) => g.setNode(n.id, { width: n.measured?.width ?? 240, height: n.measured?.height ?? 80 }));
  edges.forEach((e) => ids.has(e.source) && ids.has(e.target) && g.setEdge(e.source, e.target));
  dagre.layout(g);

  // Keep the layout anchored where the first block already was.
  const first = movable[0];
  const p0 = g.node(first.id);
  const dx = first.position.x - (p0.x - p0.width / 2);
  const dy = first.position.y - (p0.y - p0.height / 2);

  return nodes.map((n) => {
    if (!ids.has(n.id)) return n;
    const p = g.node(n.id);
    return { ...n, position: { x: Math.round(p.x - p.width / 2 + dx), y: Math.round(p.y - p.height / 2 + dy) } };
  });
}
