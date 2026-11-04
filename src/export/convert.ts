import { handoffs as findHandoffs, membership } from '../canvas/lanes';
import { getDef, isAnnotation } from '../nodes/registry';
import type { FlowEdge, FlowNode, WorkflowDoc } from '../types';
import { nowIso, uid } from '../types';
import {
  SCHEMA_VERSION,
  bundleSchema,
  workflowExportSchema,
  type WorkflowBundle,
  type WorkflowExport,
} from './schema';

const round = (n: number) => Math.round(n * 10) / 10;

/** Strip the label out of data so it lives at the top level only. */
const splitData = (n: FlowNode) => {
  const { label, ...rest } = n.data ?? { label: '' };
  return { label: label ?? '', data: rest };
};

/** Internal document → clean, versioned JSON for the large system. */
export function toJson(doc: WorkflowDoc): WorkflowExport {
  const flowNodes = doc.nodes.filter((n) => !isAnnotation(n.type));
  const annotations = doc.nodes.filter((n) => isAnnotation(n.type));
  const flowIds = new Set(flowNodes.map((n) => n.id));
  const areas = membership(doc.nodes);

  const layout: WorkflowExport['layout'] = {};
  for (const n of flowNodes) {
    layout[n.id] = { x: round(n.position.x), y: round(n.position.y), ...(n.parentId ? { parentId: n.parentId } : {}) };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    description: doc.description ?? '',
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    variables: doc.variables.map((v) => ({ ...v })),
    nodes: flowNodes.map((n) => {
      const def = getDef(n.type);
      const { label, data } = splitData(n);
      return {
        id: n.id,
        type: n.type!,
        category: (def?.category ?? 'logic') as 'logic' | 'data' | 'construction',
        label,
        data,
        outputs: def ? def.outputs(n.data).map((p) => ({ ...p })) : [],
        ...(areas.lane.has(n.id) ? { lane: areas.lane.get(n.id) } : {}),
        ...(areas.band.has(n.id) ? { section: areas.band.get(n.id) } : {}),
      };
    }),
    edges: doc.edges
      .filter((e) => flowIds.has(e.source) && flowIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? 'out',
        target: e.target,
        label: typeof e.label === 'string' ? e.label : '',
      })),
    lanes: areas.lanes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    sections: areas.bands.map((b) => ({ id: b.id, name: b.name, color: b.color })),
    handoffs: findHandoffs(doc.nodes, doc.edges.filter((e) => flowIds.has(e.source) && flowIds.has(e.target))).map((h) => ({
      edge: h.edge.id,
      from: h.from,
      to: h.to,
    })),
    ...(doc.direction ? { direction: doc.direction } : {}),
    dependencies: Object.values(
      Object.fromEntries(
        flowNodes
          .filter((n) => n.type === 'subworkflow' && n.data.workflowId)
          .map((n) => [n.data.workflowId as string, { id: n.data.workflowId as string, name: String(n.data.workflowName ?? '') }]),
      ),
    ),
    annotations: annotations.map((n) => {
      const { label, data } = splitData(n);
      const w = n.width ?? n.measured?.width;
      const h = n.height ?? n.measured?.height;
      return {
        id: n.id,
        type: n.type as 'sticky' | 'frame' | 'text' | 'lane' | 'band',
        label,
        data,
        position: { x: round(n.position.x), y: round(n.position.y) },
        ...(w && h ? { size: { width: round(w), height: round(h) } } : {}),
        ...(n.parentId ? { parentId: n.parentId } : {}),
      };
    }),
    layout,
  };
}

/** Frames must precede their children in the React Flow node array. */
export function sortNodes(nodes: FlowNode[]): FlowNode[] {
  const rank = (t?: string) => (t === 'lane' ? 0 : t === 'band' ? 1 : t === 'frame' ? 2 : 3);
  return [...nodes].sort((a, b) => rank(a.type) - rank(b.type));
}

/** Clean JSON → internal document. Throws a readable error on invalid input. */
const FIELD_TYPES = new Set(['string', 'number', 'boolean', 'date', 'list', 'file']);
const FIELD_TYPE_ALIASES: Record<string, string> = { text: 'string', textarea: 'string', int: 'number', integer: 'number', float: 'number', bool: 'boolean', datetime: 'date', array: 'list', upload: 'file' };

/** Accepts common variations from hand-written or AI-written files. */
function normalizeNodeData(type: string, data: Record<string, any>): Record<string, any> {
  if (type === 'form' && Array.isArray(data.fields)) {
    data = {
      ...data,
      fields: data.fields.map((f: Record<string, any>) => {
        const t = String(f.type ?? 'string');
        const type = FIELD_TYPES.has(t) ? t : FIELD_TYPE_ALIASES[t] ?? 'string';
        const { id, ...rest } = f;
        return { ...rest, name: f.name ?? id ?? '', type, required: !!f.required, variable: f.variable ?? '' };
      }),
    };
  }
  return data;
}

/** "variables[3] (floors) → default" style location for an error. */
function describePath(input: any, path: (string | number)[]): string {
  let out = '';
  let cur = input;
  for (const p of path) {
    cur = cur?.[p];
    if (typeof p === 'number') {
      const name = cur && typeof cur === 'object' ? cur.name ?? cur.label ?? cur.id : undefined;
      out += `[${p}]${name ? ` "${name}"` : ''}`;
    } else out += out ? ` → ${p}` : p;
  }
  return out || 'the file';
}

/** Turns zod issues into short, readable lines (max 5). */
export function describeIssues(input: unknown, issues: import('zod').ZodIssue[]): string {
  const lines = issues.slice(0, 5).map((i) => {
    const deepest = i.code === 'invalid_union' ? i.unionErrors[0]?.issues[0] : undefined;
    const path = deepest?.path ?? i.path;
    const msg =
      i.code === 'invalid_union'
        ? 'has a value of the wrong kind'
        : i.code === 'invalid_type' && i.received === 'undefined'
          ? 'is missing'
          : i.message;
    return `• ${describePath(input, path)}: ${msg}`;
  });
  const more = issues.length > 5 ? `\n…and ${issues.length - 5} more` : '';
  return lines.join('\n') + more;
}

export function fromJson(input: unknown): WorkflowDoc {
  const parsed = workflowExportSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`This file doesn't match the workflow format:\n${describeIssues(input, parsed.error.issues)}`);
  }
  const wf = parsed.data;
  wf.nodes = wf.nodes.map((n) => ({ ...n, data: normalizeNodeData(n.type, n.data) }));

  const nodes: FlowNode[] = [];
  wf.annotations.forEach((a) => {
    nodes.push({
      id: a.id,
      type: a.type,
      position: { ...a.position },
      data: { label: a.label, ...a.data },
      ...(a.size ? { width: a.size.width, height: a.size.height } : {}),
      ...(a.parentId ? { parentId: a.parentId } : {}),
    });
  });
  wf.nodes.forEach((n, i) => {
    const l = wf.layout[n.id];
    nodes.push({
      id: n.id,
      type: n.type,
      position: l ? { x: l.x, y: l.y } : { x: i * 260, y: 0 },
      data: { label: n.label, ...n.data },
      ...(l?.parentId ? { parentId: l.parentId } : {}),
    });
  });

  const edges: FlowEdge[] = wf.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: 'in',
    label: e.label || undefined,
  }));

  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    version: wf.version,
    createdAt: wf.createdAt ?? wf.updatedAt,
    updatedAt: wf.updatedAt,
    variables: wf.variables.map((v) => ({ ...v, default: v.default ?? null })),
    nodes: sortNodes(nodes),
    edges,
    ...(wf.direction ? { direction: wf.direction } : {}),
  };
}

export const toBundle = (docs: WorkflowDoc[]): WorkflowBundle => ({
  kind: 'corinthia-workflow-bundle',
  exportedAt: nowIso(),
  workflows: docs.map(toJson),
});

/** Accepts either a single workflow or a backup bundle. */
export function parseImport(text: string): WorkflowDoc[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (raw && typeof raw === 'object' && (raw as { kind?: string }).kind === 'corinthia-workflow-bundle') {
    const b = bundleSchema.safeParse(raw);
    if (!b.success) throw new Error(`This bundle file doesn't match the format:\n${describeIssues(raw, b.error.issues)}`);
    return b.data.workflows.map(fromJson);
  }
  return [fromJson(raw)];
}

/** Gives a document fresh ids (used when duplicating or importing a copy). */
export function cloneDoc(doc: WorkflowDoc, name?: string): WorkflowDoc {
  const t = nowIso();
  return {
    ...structuredClone(doc),
    id: uid('wf'),
    name: name ?? doc.name,
    version: 1,
    createdAt: t,
    updatedAt: t,
  };
}
