import { DEFAULT_LANE_WIDTH, arrangeInLanes, bandsOf, isStructural, lanesOf, layoutLanes, membership } from '../canvas/lanes';
import { autoLayout } from '../canvas/layout';
import { sortNodes } from '../export/convert';
import { getDef, isAnnotation } from '../nodes/registry';
import type { FlowEdge, FlowNode, Variable, VariableType, WorkflowDoc, WorkflowSummary } from '../types';
import { nowIso, uid } from '../types';

export interface AiWorkflow {
  name: string;
  description: string;
  /** Swimlanes (departments), left to right. */
  lanes?: string[];
  /** Section bands across all lanes, top to bottom. */
  sections?: string[];
  variables: { name: string; type: VariableType; description: string }[];
  nodes: { id: string; type: string; label: string; lane?: string; section?: string; dataJson: string }[];
  edges: { source: string; sourceHandle: string; target: string; label: string }[];
  assumptions: string[];
}

const parseData = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Rough block size before React Flow measures it, used for auto-layout. */
const estimate = (n: FlowNode) => {
  const outs = getDef(n.type)?.outputs(n.data).length ?? 1;
  return { width: 240, height: 72 + (outs > 1 ? outs * 24 + 8 : 0) };
};

/**
 * Turns the model's answer into a workflow document. Unknown block types,
 * dangling edges and edges from non-existent outputs are dropped and
 * reported, so the result always loads cleanly into the editor.
 * When `base` is given, blocks that keep their id keep their position.
 */
export function aiToDoc(ai: AiWorkflow, opts: { base?: WorkflowDoc; workflows: WorkflowSummary[] }): { doc: WorkflowDoc; dropped: string[] } {
  const dropped: string[] = [];
  const base = opts.base;
  const baseById = new Map((base?.nodes ?? []).map((n) => [n.id, n]));
  const annotations = (base?.nodes ?? []).filter((n) => isAnnotation(n.type));
  const taken = new Set(annotations.map((n) => n.id));

  // ── Blocks ──
  const idMap = new Map<string, string>();
  const nodes: FlowNode[] = [];
  for (const n of ai.nodes) {
    const def = getDef(n.type);
    if (!def || def.category === 'annotation') {
      dropped.push(`Unknown block type "${n.type}" (${n.label})`);
      continue;
    }
    let id = n.id && !taken.has(n.id) ? n.id : uid('n');
    if (idMap.has(n.id)) id = uid('n');
    taken.add(id);
    idMap.set(n.id, id);

    const raw = parseData(n.dataJson);
    const known = new Set(def.fields.map((f) => f.key));
    const data: FlowNode['data'] = { label: n.label || def.label, ...def.defaults() };
    for (const [k, v] of Object.entries(raw)) if (known.has(k)) data[k] = v;

    if (n.type === 'subworkflow') {
      const target = opts.workflows.find((w) => w.id === data.workflowId);
      if (target) Object.assign(data, { workflowName: target.name, outcomes: target.outcomes });
      else if (data.workflowId) dropped.push(`"${n.label}" linked to an unknown workflow`);
      if (data.mode !== 'handoff') data.mode = 'call';
    }

    const prev = baseById.get(id);
    nodes.push({
      id,
      type: n.type,
      position: prev ? { ...prev.position } : { x: 0, y: 0 },
      ...(prev?.parentId && taken.has(prev.parentId) ? { parentId: prev.parentId } : {}),
      data,
    });
  }

  // ── Connections ──
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const used = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const e of ai.edges) {
    const s = byId.get(idMap.get(e.source) ?? '');
    const t = byId.get(idMap.get(e.target) ?? '');
    if (!s || !t) {
      dropped.push(`Connection ${e.source} → ${e.target} points to a missing block`);
      continue;
    }
    const ports = getDef(s.type)!.outputs(s.data);
    const handle = e.sourceHandle || 'out';
    const port = ports.find((p) => p.id === handle) ?? (ports.length === 1 ? ports[0] : undefined);
    if (!port) {
      dropped.push(`"${s.data.label}" has no output "${handle}"`);
      continue;
    }
    if (!getDef(t.type)!.hasInput) {
      dropped.push(`"${t.data.label}" cannot receive connections`);
      continue;
    }
    const key = `${s.id}:${port.id}`;
    if (used.has(key)) continue; // one connection per output
    used.add(key);
    edges.push({
      id: uid('e'),
      source: s.id,
      sourceHandle: port.id,
      target: t.id,
      targetHandle: 'in',
      label: e.label || (ports.length > 1 ? port.label : undefined) || undefined,
    });
  }

  // ── Variables ──
  const seen = new Set<string>();
  const variables: Variable[] = [];
  for (const v of ai.variables) {
    const name = v.name.trim().replace(/[^A-Za-z0-9_]/g, '_');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const prev = base?.variables.find((x) => x.name === name);
    variables.push({ name, type: v.type, default: prev?.default ?? null, ...(v.description ? { description: v.description } : {}) });
  }

  // ── Layout ──
  let laid = nodes;
  let annotationsOut = annotations;
  const laneNames = [...new Set((ai.lanes ?? []).map((l) => l.trim()).filter(Boolean))];
  if (laneNames.length) {
    // Swimlane diagram: build lanes/sections (reusing existing ones by name), then arrange inside them.
    const LANE_COLORS = ['slate', 'blue', 'green', 'yellow', 'pink', 'orange'];
    const oldLanes = new Map(annotations.filter((n) => n.type === 'lane').map((n) => [String(n.data.label), n]));
    const oldBands = new Map(annotations.filter((n) => n.type === 'band').map((n) => [String(n.data.label), n]));
    const origin = lanesOf(annotations)[0] ?? { x: 0 };
    let x = origin.x;
    const laneNodes: FlowNode[] = laneNames.map((name, i) => {
      const prev = oldLanes.get(name);
      const w = prev?.width ?? DEFAULT_LANE_WIDTH;
      const node: FlowNode = { id: prev?.id ?? uid('a'), type: 'lane', position: { x, y: 0 }, width: w, height: 400, data: { label: name, color: prev?.data.color ?? LANE_COLORS[i % LANE_COLORS.length] } };
      x += w;
      return node;
    });
    const sectionNames = [...new Set((ai.sections ?? []).map((s) => s.trim()).filter(Boolean))];
    const bandNodes: FlowNode[] = sectionNames.map((name, i) => {
      const prev = oldBands.get(name);
      return { id: prev?.id ?? uid('a'), type: 'band', position: { x: origin.x, y: 100000 + i * 10000 }, width: x - origin.x, height: 9000, data: { label: name, color: prev?.data.color ?? 'orange' } };
    });
    // Drop each block roughly into its lane / section so membership is clear, then arrange.
    const laneOf = new Map(ai.nodes.map((n) => [idMap.get(n.id), n.lane ?? '']));
    const sectionOf = new Map(ai.nodes.map((n) => [idMap.get(n.id), n.section ?? '']));
    const placed = nodes.map((n, i) => {
      const li = Math.max(0, laneNames.indexOf(laneOf.get(n.id) ?? ''));
      const bi = sectionNames.indexOf(sectionOf.get(n.id) ?? '');
      const lane = laneNodes[li];
      return {
        ...n,
        parentId: undefined,
        measured: estimate(n),
        position: { x: lane.position.x + (lane.width! - 240) / 2, y: bi >= 0 ? bandNodes[bi].position.y + 100 + i : 100 + i * 10 },
      };
    });
    const keepNotes = annotations.filter((n) => !isStructural(n));
    const arranged = arrangeInLanes([...laneNodes, ...bandNodes, ...placed], edges);
    const finalNodes = layoutLanes(arranged, arranged).map((n) => {
      const { measured: _m, ...rest } = n;
      return rest as FlowNode;
    });
    laid = finalNodes.filter((n) => !isStructural(n));
    annotationsOut = [...finalNodes.filter(isStructural), ...keepNotes];
  } else if (nodes.some((n) => !baseById.has(n.id))) {
    // Keep existing positions; lay everything out if new blocks appeared.
    const first = nodes.find((n) => n.type === 'start') ?? nodes[0];
    const origin = first && baseById.get(first.id)?.position;
    const withSize = nodes.map((n) => ({ ...n, parentId: undefined, measured: estimate(n) }));
    laid = autoLayout(withSize, edges).map((n) => {
      const { measured: _m, ...rest } = n;
      return rest as FlowNode;
    });
    if (origin && first) {
      const p = laid.find((n) => n.id === first.id)!.position;
      const dx = origin.x - p.x;
      const dy = origin.y - p.y;
      laid = laid.map((n) => ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }));
    }
  }

  const t = nowIso();
  const doc: WorkflowDoc = {
    id: base?.id ?? uid('wf'),
    name: base?.name && base.nodes.length > 2 ? base.name : ai.name || 'Generated workflow',
    description: base?.description || ai.description || '',
    version: base?.version ?? 1,
    createdAt: base?.createdAt ?? t,
    updatedAt: t,
    variables,
    nodes: sortNodes([...annotationsOut, ...laid]),
    edges,
    ...(laneNames.length ? { direction: 'TB' as const } : base?.direction ? { direction: base.direction } : {}),
  };
  return { doc, dropped };
}

/** The part of a workflow the model needs to see when updating it. */
export function currentForModel(doc: WorkflowDoc) {
  const flow = doc.nodes.filter((n) => !isAnnotation(n.type));
  const areas = membership(doc.nodes);
  const laneName = new Map(areas.lanes.map((l) => [l.id, l.name]));
  const bandName = new Map(bandsOf(doc.nodes).map((b) => [b.id, b.name]));
  return {
    name: doc.name,
    description: doc.description,
    lanes: areas.lanes.map((l) => l.name),
    sections: areas.bands.map((b) => b.name),
    variables: doc.variables.map((v) => ({ name: v.name, type: v.type, description: v.description ?? '' })),
    nodes: flow.map((n) => {
      const { label, ...data } = n.data;
      delete data.outcomes;
      delete data.workflowName;
      return { id: n.id, type: n.type, label, lane: laneName.get(areas.lane.get(n.id) ?? '') ?? '', section: bandName.get(areas.band.get(n.id) ?? '') ?? '', data };
    }),
    edges: doc.edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? 'out', target: e.target, label: typeof e.label === 'string' ? e.label : '' })),
  };
}

/** Adds the model's assumptions as a sticky note above the flow, for review. */
export function withAssumptionNote(doc: WorkflowDoc, assumptions: string[]): WorkflowDoc {
  if (!assumptions.length) return doc;
  const flow = doc.nodes.filter((n) => !isAnnotation(n.type) && !n.parentId);
  const minX = Math.min(0, ...flow.map((n) => n.position.x));
  const minY = Math.min(0, ...flow.map((n) => n.position.y));
  const note: FlowNode = {
    id: uid('a'),
    type: 'sticky',
    position: { x: minX, y: minY - 220 },
    width: 360,
    height: 180,
    data: { label: '', color: 'orange', text: ['Check these assumptions:', ...assumptions.map((a) => `• ${a}`)].join('\n') },
  };
  return { ...doc, nodes: sortNodes([...doc.nodes, note]) };
}
