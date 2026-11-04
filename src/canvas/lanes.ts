import dagre from '@dagrejs/dagre';
import { isAnnotation } from '../nodes/registry';
import type { FlowEdge, FlowNode } from '../types';

/**
 * Swimlanes (vertical columns, one per department) and section bands
 * (horizontal rows across all lanes). Blocks are not parented to lanes:
 * a block belongs to the lane its centre sits in, so moving it is enough
 * to hand it to another department.
 */

export const LANE_HEADER = 52;
export const DEFAULT_LANE_WIDTH = 300;
const MIN_HEIGHT = 600;

export const isLane = (n: Pick<FlowNode, 'type'>) => n.type === 'lane';
export const isBand = (n: Pick<FlowNode, 'type'>) => n.type === 'band';
export const isStructural = (n: Pick<FlowNode, 'type'>) => isLane(n) || isBand(n);

export const nodeW = (n: FlowNode) => n.width ?? n.measured?.width ?? (isLane(n) ? DEFAULT_LANE_WIDTH : isBand(n) ? 600 : 240);
export const nodeH = (n: FlowNode) => n.height ?? n.measured?.height ?? (isBand(n) ? 260 : 80);

export interface LaneRect {
  id: string;
  name: string;
  color: string;
  x: number;
  w: number;
}
export interface BandRect {
  id: string;
  name: string;
  color: string;
  y: number;
  h: number;
}

function absolute(n: FlowNode, byId: Map<string, FlowNode>) {
  let { x, y } = n.position;
  let p = n.parentId ? byId.get(n.parentId) : undefined;
  while (p) {
    x += p.position.x;
    y += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return { x, y };
}

export const lanesOf = (nodes: FlowNode[]): LaneRect[] =>
  nodes
    .filter(isLane)
    .map((n) => ({ id: n.id, name: String(n.data.label ?? ''), color: String(n.data.color ?? 'slate'), x: n.position.x, w: nodeW(n) }))
    .sort((a, b) => a.x - b.x);

export const bandsOf = (nodes: FlowNode[]): BandRect[] =>
  nodes
    .filter(isBand)
    .map((n) => ({ id: n.id, name: String(n.data.label ?? ''), color: String(n.data.color ?? 'orange'), y: n.position.y, h: nodeH(n) }))
    .sort((a, b) => a.y - b.y);

/** Lane id and band id for every non-structural node, by the position of its centre. */
export function membership(nodes: FlowNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lanes = lanesOf(nodes);
  const bands = bandsOf(nodes);
  const lane = new Map<string, string>();
  const band = new Map<string, string>();
  for (const n of nodes) {
    if (isStructural(n)) continue;
    const p = absolute(n, byId);
    const cx = p.x + nodeW(n) / 2;
    const cy = p.y + nodeH(n) / 2;
    const l = lanes.find((r) => cx >= r.x && cx < r.x + r.w);
    if (l) lane.set(n.id, l.id);
    const b = bands.find((r) => cy >= r.y && cy < r.y + r.h);
    if (b) band.set(n.id, b.id);
  }
  return { lanes, bands, lane, band };
}

/** Edges whose two blocks sit in different lanes: work handed between departments. */
export function handoffs(nodes: FlowNode[], edges: FlowEdge[]) {
  const { lane } = membership(nodes);
  return edges
    .filter((e) => lane.has(e.source) && lane.has(e.target) && lane.get(e.source) !== lane.get(e.target))
    .map((e) => ({ edge: e, from: lane.get(e.source)!, to: lane.get(e.target)! }));
}

/**
 * Keeps lanes side by side (no gaps, ordered by x), tall enough for the
 * content, and bands as wide as all lanes. When a lane changes width,
 * blocks in the lanes to its right move along with their lane.
 * `prev` is the node list before the change.
 */
export function layoutLanes(prev: FlowNode[], next: FlowNode[]): FlowNode[] {
  const lanes = next.filter(isLane).sort((a, b) => a.position.x - b.position.x);
  const bands = next.filter(isBand);
  if (!lanes.length && !bands.length) return next;

  const prevById = new Map(prev.map((n) => [n.id, n]));
  const prevLanes = lanesOf(prev);
  const left = lanes.length ? lanes[0].position.x : 0;
  const newX = new Map<string, number>();
  let cursor = left;
  for (const l of lanes) {
    newX.set(l.id, cursor);
    cursor += nodeW(l);
  }
  const right = cursor;

  // Blocks that did not move themselves follow their lane.
  const deltas = new Map<string, number>();
  for (const r of prevLanes) {
    const x = newX.get(r.id);
    if (x !== undefined && x !== r.x) deltas.set(r.id, x - r.x);
  }
  let nodes = next;
  if (deltas.size) {
    nodes = next.map((n) => {
      if (isStructural(n) || n.parentId) return n;
      const before = prevById.get(n.id);
      if (!before || before.position.x !== n.position.x || before.position.y !== n.position.y) return n;
      const cx = n.position.x + nodeW(n) / 2;
      const lane = prevLanes.find((r) => cx >= r.x && cx < r.x + r.w);
      const d = lane && deltas.get(lane.id);
      return d ? { ...n, position: { x: n.position.x + d, y: n.position.y } } : n;
    });
  }

  // Lanes span from above the first block to below the last block / band.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const content = nodes.filter((n) => !isStructural(n)).map((n) => ({ p: absolute(n, byId), h: nodeH(n) }));
  const laneTop = lanes.length ? Math.min(...lanes.map((l) => l.position.y)) : 0;
  const top = content.length ? Math.min(laneTop, Math.min(...content.map((c) => c.p.y)) - LANE_HEADER - 24) : laneTop;
  const bottom = Math.max(
    top + MIN_HEIGHT,
    ...content.map((c) => c.p.y + c.h + 80),
    ...bands.map((b) => b.position.y + nodeH(b) + 40),
  );
  const height = Math.round(bottom - top);

  return nodes.map((n) => {
    if (isLane(n)) {
      const x = newX.get(n.id)!;
      return n.position.x === x && n.position.y === top && n.height === height ? n : { ...n, position: { x, y: top }, height };
    }
    if (isBand(n) && lanes.length) {
      const w = right - left;
      return n.position.x === left && n.width === w ? n : { ...n, position: { x: left, y: n.position.y }, width: w };
    }
    return n;
  });
}

/** Moves a lane one place left (-1) or right (+1), taking its blocks along. */
export function moveLane(nodes: FlowNode[], laneId: string, dir: -1 | 1): FlowNode[] {
  const lanes = lanesOf(nodes);
  const i = lanes.findIndex((l) => l.id === laneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lanes.length) return nodes;
  // Swap two neighbours: the left one moves right by the right one's width, and vice versa.
  const [L, R] = i < j ? [lanes[i], lanes[j]] : [lanes[j], lanes[i]];
  const shift = new Map([
    [L.id, R.w],
    [R.id, -L.w],
  ]);
  const { lane } = membership(nodes);
  return nodes.map((n) => {
    const by = isLane(n) ? shift.get(n.id) : !isStructural(n) && !n.parentId ? shift.get(lane.get(n.id) ?? '') : undefined;
    return by ? { ...n, position: { ...n.position, x: n.position.x + by } } : n;
  });
}

/**
 * Top-to-bottom arrangement inside lanes: each block stays in its lane,
 * rows follow the flow order, and each section band gets its own rows
 * below the main flow. Lanes widen when a row needs more room.
 */
export function arrangeInLanes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const { lanes, bands, lane, band } = membership(nodes);
  if (!lanes.length) return nodes;
  const flow = nodes.filter((n) => !isAnnotation(n.type) && !n.parentId && lane.has(n.id));
  const groups: { bandId?: string; items: FlowNode[] }[] = [
    { items: flow.filter((n) => !band.has(n.id)) },
    ...bands.map((b) => ({ bandId: b.id, items: flow.filter((n) => band.get(n.id) === b.id) })),
  ];

  // Rows per group from a top-to-bottom ranking of the flow.
  const rowsOf = (items: FlowNode[]) => {
    if (!items.length) return [] as FlowNode[][];
    const ids = new Set(items.map((n) => n.id));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    items.forEach((n) => g.setNode(n.id, { width: nodeW(n), height: nodeH(n) }));
    edges.forEach((e) => ids.has(e.source) && ids.has(e.target) && g.setEdge(e.source, e.target));
    dagre.layout(g);
    const byRank = new Map<number, FlowNode[]>();
    for (const n of items) {
      const y = Math.round(g.node(n.id).y);
      byRank.set(y, [...(byRank.get(y) ?? []), n]);
    }
    return [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((p, q) => g.node(p.id).x - g.node(q.id).x));
  };
  const rowSets = groups.map((grp) => rowsOf(grp.items));

  // Widen lanes that need room for side-by-side blocks.
  const GAP = 24;
  const need = new Map<string, number>();
  for (const rows of rowSets)
    for (const row of rows)
      for (const l of lanes) {
        const inLane = row.filter((n) => lane.get(n.id) === l.id);
        if (inLane.length) need.set(l.id, Math.max(need.get(l.id) ?? 0, inLane.reduce((s, n) => s + nodeW(n), 0) + GAP * (inLane.length + 1)));
      }
  const widths = new Map(lanes.map((l) => [l.id, Math.max(l.w, need.get(l.id) ?? 0)]));
  const laneX = new Map<string, number>();
  let cursor = lanes[0].x;
  for (const l of lanes) {
    laneX.set(l.id, cursor);
    cursor += widths.get(l.id)!;
  }

  const top = Math.min(...nodes.filter(isLane).map((l) => l.position.y));
  const pos = new Map<string, { x: number; y: number }>();
  const bandPos = new Map<string, { y: number; h: number }>();
  let y = top + LANE_HEADER + 36;
  groups.forEach((grp, gi) => {
    const rows = rowSets[gi];
    let startY = y;
    if (grp.bandId) {
      startY = y + 20;
      y = startY + 56; // room for the band title
    }
    for (const row of rows) {
      for (const l of lanes) {
        const inLane = row.filter((n) => lane.get(n.id) === l.id);
        const total = inLane.reduce((s, n) => s + nodeW(n), 0) + GAP * (inLane.length - 1);
        let x = laneX.get(l.id)! + (widths.get(l.id)! - total) / 2;
        for (const n of inLane) {
          pos.set(n.id, { x: Math.round(x), y: Math.round(y) });
          x += nodeW(n) + GAP;
        }
      }
      y += Math.max(...row.map(nodeH)) + 44;
    }
    if (grp.bandId) {
      const h = Math.max(160, y - startY);
      bandPos.set(grp.bandId, { y: startY, h });
      y = startY + h + 20;
    }
  });

  return nodes.map((n) => {
    if (isLane(n)) return { ...n, position: { x: laneX.get(n.id)!, y: top }, width: widths.get(n.id)! };
    if (isBand(n) && bandPos.has(n.id)) {
      const b = bandPos.get(n.id)!;
      return { ...n, position: { ...n.position, y: b.y }, height: b.h };
    }
    const p = pos.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
