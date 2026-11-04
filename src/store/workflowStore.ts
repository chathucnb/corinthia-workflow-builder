import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { create } from 'zustand';
import { DEFAULT_LANE_WIDTH, LANE_HEADER, isStructural, layoutLanes, lanesOf } from '../canvas/lanes';
import { sortNodes } from '../export/convert';
import { getDef } from '../nodes/registry';
import type { FlowEdge, FlowNode, NodeData, Variable, WorkflowDoc } from '../types';
import { nowIso, uid } from '../types';

interface Snapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: Variable[];
}

interface State {
  doc: WorkflowDoc | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: number; // bumps on every change → autosave trigger

  load: (doc: WorkflowDoc) => void;
  close: () => void;
  replaceDoc: (doc: WorkflowDoc) => void;

  snapshot: (coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;

  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  onConnect: (c: Connection) => void;

  addNode: (type: string, position: XYPosition, extra?: Partial<FlowNode>) => string;
  updateNodeData: (id: string, patch: Partial<NodeData>) => void;
  updateEdge: (id: string, patch: Partial<FlowEdge>) => void;
  setNodes: (nodes: FlowNode[], record?: boolean) => void;
  setMeta: (patch: Partial<Pick<WorkflowDoc, 'name' | 'description' | 'direction'>>) => void;
  setVariables: (vars: Variable[]) => void;
  bumpVersion: () => void;

  deleteSelected: () => void;
  copySelected: () => number;
  paste: (at?: XYPosition) => void;
  insertCopy: (src: WorkflowDoc, at: XYPosition) => void;
  selectOnly: (id: string) => void;
}

const HISTORY_LIMIT = 100;
let lastKey: string | undefined;
let lastAt = 0;
let clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null;

/**
 * Drop runtime-only fields. A stale `measured` size stops React Flow from
 * re-measuring the node, which leaves its handles (and edges) unrendered.
 */
const clean = (n: FlowNode): FlowNode => {
  const { measured: _m, dragging: _d, resizing: _r, ...rest } = n;
  return rest as FlowNode;
};

/** Sorts nodes and keeps swimlanes / bands aligned after any change. */
const finalize = (prev: FlowNode[], next: FlowNode[]) => layoutLanes(prev, sortNodes(next));

const touch = (doc: WorkflowDoc, patch: Partial<WorkflowDoc>): WorkflowDoc => ({ ...doc, ...patch, updatedAt: nowIso() });

/** Remove edges whose source handle no longer exists on the node (e.g. a deleted switch case). */
function pruneEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.filter((e) => {
    const s = byId.get(e.source);
    if (!s || !byId.has(e.target)) return false;
    const def = getDef(s.type);
    if (!def) return true;
    return def.outputs(s.data).some((p) => p.id === (e.sourceHandle ?? 'out'));
  });
}

export const useWorkflow = create<State>()((set, get) => ({
  doc: null,
  past: [],
  future: [],
  dirty: 0,

  load: (doc) => {
    lastKey = undefined;
    const nodes = sortNodes(doc.nodes.map((n) => ({ ...clean(n), selected: false })));
    set({ doc: { ...doc, nodes: layoutLanes(nodes, nodes) }, past: [], future: [], dirty: 0 });
  },
  close: () => set({ doc: null, past: [], future: [] }),
  replaceDoc: (doc) => {
    get().snapshot();
    const nodes = sortNodes(doc.nodes.map(clean));
    set((s) => ({ doc: { ...doc, id: s.doc?.id ?? doc.id, nodes: layoutLanes(nodes, nodes) }, dirty: s.dirty + 1 }));
  },

  snapshot: (key) => {
    const { doc, past } = get();
    if (!doc) return;
    const now = Date.now();
    if (key && key === lastKey && now - lastAt < 1500) {
      lastAt = now;
      return;
    }
    lastKey = key;
    lastAt = now;
    const snap = { nodes: doc.nodes, edges: doc.edges, variables: doc.variables };
    set({ past: [...past, snap].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { doc, past, future } = get();
    if (!doc || !past.length) return;
    const prev = past[past.length - 1];
    lastKey = undefined;
    set((s) => ({
      past: past.slice(0, -1),
      future: [{ nodes: doc.nodes, edges: doc.edges, variables: doc.variables }, ...future],
      doc: touch(doc, prev),
      dirty: s.dirty + 1,
    }));
  },
  redo: () => {
    const { doc, past, future } = get();
    if (!doc || !future.length) return;
    const next = future[0];
    lastKey = undefined;
    set((s) => ({
      future: future.slice(1),
      past: [...past, { nodes: doc.nodes, edges: doc.edges, variables: doc.variables }],
      doc: touch(doc, next),
      dirty: s.dirty + 1,
    }));
  },

  onNodesChange: (changes) => {
    const { doc } = get();
    if (!doc) return;
    const meaningful = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || (c.type === 'position' && c.dragging === false) || (c.type === 'dimensions' && c.resizing),
    );
    if (changes.some((c) => c.type === 'remove')) get().snapshot();
    const applied = applyNodeChanges(changes, doc.nodes);
    const nodes = meaningful ? layoutLanes(doc.nodes, applied) : applied;
    set((s) => ({
      doc: meaningful ? touch(doc, { nodes }) : { ...doc, nodes },
      dirty: meaningful ? s.dirty + 1 : s.dirty,
    }));
  },
  onEdgesChange: (changes) => {
    const { doc } = get();
    if (!doc) return;
    const meaningful = changes.some((c) => c.type !== 'select');
    if (changes.some((c) => c.type === 'remove')) get().snapshot('edge-remove');
    const edges = applyEdgeChanges(changes, doc.edges);
    set((s) => ({ doc: meaningful ? touch(doc, { edges }) : { ...doc, edges }, dirty: meaningful ? s.dirty + 1 : s.dirty }));
  },
  onConnect: (c) => {
    const { doc } = get();
    if (!doc || !c.source || !c.target) return;
    get().snapshot();
    const handle = c.sourceHandle ?? 'out';
    const src = doc.nodes.find((n) => n.id === c.source);
    const ports = src ? getDef(src.type)?.outputs(src.data) ?? [] : [];
    const port = ports.find((p) => p.id === handle);
    // One connection per output keeps the exported logic unambiguous.
    const edges = doc.edges.filter((e) => !(e.source === c.source && (e.sourceHandle ?? 'out') === handle));
    edges.push({
      id: uid('e'),
      source: c.source,
      sourceHandle: handle,
      target: c.target,
      targetHandle: 'in',
      label: ports.length > 1 && port?.label ? port.label : undefined,
    });
    set((s) => ({ doc: touch(doc, { edges }), dirty: s.dirty + 1 }));
  },

  addNode: (type, position, extra) => {
    const { doc } = get();
    const def = getDef(type);
    if (!doc || !def) return '';
    get().snapshot();
    const id = uid(def.category === 'annotation' ? 'a' : 'n');
    const size =
      type === 'frame' ? { width: 480, height: 320 } : type === 'sticky' ? { width: 200, height: 160 } : type === 'band' ? { height: 260 } : {};
    const lanes = lanesOf(doc.nodes);
    let label = type === 'text' ? 'Heading' : type === 'frame' ? 'Group' : type === 'sticky' ? '' : def.label;
    if (type === 'lane') {
      // New lanes are added at the right end; the first one starts left of the flow.
      const content = doc.nodes.filter((n) => !isStructural(n));
      const last = lanes[lanes.length - 1];
      position = last
        ? { x: last.x + last.w, y: doc.nodes.find((n) => n.id === last.id)!.position.y }
        : {
            x: content.length ? Math.min(...content.map((n) => n.position.x)) - 40 : position.x,
            y: content.length ? Math.min(...content.map((n) => n.position.y)) - LANE_HEADER - 24 : position.y,
          };
      label = `Department ${lanes.length + 1}`;
    }
    if (type === 'band') label = 'Section';
    const node: FlowNode = {
      id,
      type,
      position,
      data: { label, ...def.defaults() },
      selected: true,
      ...(type === 'lane' ? { width: DEFAULT_LANE_WIDTH } : {}),
      ...size,
      ...extra,
    };
    const nodes = finalize(doc.nodes, [...doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
    // Lane diagrams read top to bottom.
    const direction = type === 'lane' && !lanes.length ? 'TB' : doc.direction;
    set((s) => ({ doc: touch(doc, { nodes, direction }), dirty: s.dirty + 1 }));
    return id;
  },
  updateNodeData: (id, patch) => {
    const { doc } = get();
    if (!doc) return;
    get().snapshot(`data:${id}:${Object.keys(patch).join(',')}`);
    const nodes = doc.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
    set((s) => ({ doc: touch(doc, { nodes, edges: pruneEdges(nodes, doc.edges) }), dirty: s.dirty + 1 }));
  },
  updateEdge: (id, patch) => {
    const { doc } = get();
    if (!doc) return;
    get().snapshot(`edge:${id}`);
    const edges = doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e));
    set((s) => ({ doc: touch(doc, { edges }), dirty: s.dirty + 1 }));
  },
  setNodes: (nodes, record = true) => {
    const { doc } = get();
    if (!doc) return;
    if (record) get().snapshot();
    set((s) => ({ doc: touch(doc, { nodes: finalize(doc.nodes, nodes) }), dirty: s.dirty + 1 }));
  },
  setMeta: (patch) => {
    const { doc } = get();
    if (!doc) return;
    set((s) => ({ doc: touch(doc, patch), dirty: s.dirty + 1 }));
  },
  setVariables: (variables) => {
    const { doc } = get();
    if (!doc) return;
    get().snapshot('variables');
    set((s) => ({ doc: touch(doc, { variables }), dirty: s.dirty + 1 }));
  },
  bumpVersion: () => {
    const { doc } = get();
    if (!doc) return;
    set((s) => ({ doc: touch(doc, { version: doc.version + 1 }), dirty: s.dirty + 1 }));
  },

  deleteSelected: () => {
    const { doc } = get();
    if (!doc) return;
    const ids = new Set(doc.nodes.filter((n) => n.selected).map((n) => n.id));
    const edgeSel = doc.edges.some((e) => e.selected);
    if (!ids.size && !edgeSel) return;
    get().snapshot();
    // Children of a deleted frame stay, re-parented to the canvas.
    const nodes = doc.nodes
      .filter((n) => !ids.has(n.id))
      .map((n) => {
        if (n.parentId && ids.has(n.parentId)) {
          const p = doc.nodes.find((x) => x.id === n.parentId)!;
          return { ...n, parentId: undefined, position: { x: n.position.x + p.position.x, y: n.position.y + p.position.y } };
        }
        return n;
      });
    const edges = doc.edges.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target));
    set((s) => ({ doc: touch(doc, { nodes: finalize(doc.nodes, nodes), edges }), dirty: s.dirty + 1 }));
  },
  copySelected: () => {
    const { doc } = get();
    if (!doc) return 0;
    const nodes = doc.nodes.filter((n) => n.selected);
    const ids = new Set(nodes.map((n) => n.id));
    clipboard = { nodes: structuredClone(nodes), edges: structuredClone(doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target))) };
    return nodes.length;
  },
  paste: (at) => {
    const { doc } = get();
    if (!doc || !clipboard?.nodes.length) return;
    get().snapshot();
    const map = new Map<string, string>();
    clipboard.nodes.forEach((n) => map.set(n.id, uid(n.type === 'frame' || n.type === 'sticky' || n.type === 'text' ? 'a' : 'n')));
    const roots = clipboard.nodes.filter((n) => !n.parentId || !map.has(n.parentId));
    const minX = Math.min(...roots.map((n) => n.position.x));
    const minY = Math.min(...roots.map((n) => n.position.y));
    const dx = at ? at.x - minX : 40;
    const dy = at ? at.y - minY : 40;
    const pasted: FlowNode[] = clipboard.nodes.map((n) => {
      const keepParent = n.parentId && map.has(n.parentId);
      return {
        ...clean(structuredClone(n)),
        id: map.get(n.id)!,
        parentId: keepParent ? map.get(n.parentId!) : undefined,
        position: keepParent ? n.position : { x: n.position.x + dx, y: n.position.y + dy },
        selected: true,
      };
    });
    const edges: FlowEdge[] = clipboard.edges.map((e) => ({
      ...structuredClone(e),
      id: uid('e'),
      source: map.get(e.source)!,
      target: map.get(e.target)!,
      selected: false,
    }));
    const nodes = finalize(doc.nodes, [...doc.nodes.map((n) => ({ ...n, selected: false })), ...pasted]);
    set((s) => ({ doc: touch(doc, { nodes, edges: [...doc.edges, ...edges] }), dirty: s.dirty + 1 }));
  },
  insertCopy: (src, at) => {
    const { doc } = get();
    if (!doc) return;
    get().snapshot();
    // Start blocks are dropped so the copy can be wired into this flow.
    const nodes = src.nodes.filter((n) => n.type !== 'start').map(clean);
    const map = new Map(nodes.map((n) => [n.id, uid(n.type === 'frame' || n.type === 'sticky' || n.type === 'text' ? 'a' : 'n')]));
    const roots = nodes.filter((n) => !n.parentId || !map.has(n.parentId));
    const minX = Math.min(...roots.map((n) => n.position.x));
    const minY = Math.min(...roots.map((n) => n.position.y));
    const copied: FlowNode[] = nodes.map((n) => {
      const keepParent = !!n.parentId && map.has(n.parentId);
      return {
        ...structuredClone(n),
        id: map.get(n.id)!,
        parentId: keepParent ? map.get(n.parentId!) : undefined,
        position: keepParent ? n.position : { x: n.position.x - minX + at.x, y: n.position.y - minY + at.y },
        selected: true,
      };
    });
    const edges: FlowEdge[] = src.edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => ({ ...structuredClone(e), id: uid('e'), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
    const have = new Set(doc.variables.map((v) => v.name));
    const variables = [...doc.variables, ...src.variables.filter((v) => !have.has(v.name))];
    const all = finalize(doc.nodes, [...doc.nodes.map((n) => ({ ...n, selected: false })), ...copied]);
    set((s) => ({ doc: touch(doc, { nodes: all, edges: [...doc.edges, ...edges], variables }), dirty: s.dirty + 1 }));
  },
  selectOnly: (id) => {
    const { doc } = get();
    if (!doc) return;
    set({
      doc: {
        ...doc,
        nodes: doc.nodes.map((n) => ({ ...n, selected: n.id === id })),
        edges: doc.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      },
    });
  },
}));

export function newWorkflow(name = 'Untitled workflow'): WorkflowDoc {
  const t = nowIso();
  return {
    id: uid('wf'),
    name,
    description: '',
    version: 1,
    createdAt: t,
    updatedAt: t,
    variables: [],
    nodes: [
      { id: uid('n'), type: 'start', position: { x: 0, y: 120 }, data: { label: 'Start', trigger: 'manual' } },
      { id: uid('n'), type: 'end', position: { x: 600, y: 120 }, data: { label: 'End', status: 'completed' } },
    ],
    edges: [],
  };
}
