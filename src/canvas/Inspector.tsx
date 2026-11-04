import { ArrowLeft, ArrowRight, ArrowUpRight, Columns3, Plus, Rows3, Trash2, Workflow } from 'lucide-react';
import { handoffs as findHandoffs, lanesOf, membership, moveLane } from './lanes';
import { useEffect, useState } from 'react';
import { FieldEditor, VAR_TYPES } from '../nodes/fields';
import { getDef } from '../nodes/registry';
import { useWorkflow } from '../store/workflowStore';
import type { FlowEdge, FlowNode, Issue, Variable, VariableType, WorkflowSummary } from '../types';

const REF_KEYS = new Set(['var', 'variable', 'collection']);

/** Stores a Set Variable value typed by its variable (e.g. "true" → true for a boolean). */
function typedValue(v: unknown, type?: string): unknown {
  if (typeof v !== 'string' || v.includes('{{')) return v;
  if (type === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  if (type === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (type === 'list' && v.trim()) return v.split(',').map((x) => x.trim());
  return v;
}

/** Rewrites every reference to a renamed variable inside node data. */
function renameRefs(value: unknown, from: string, to: string, key?: string): unknown {
  if (typeof value === 'string') {
    if (key && REF_KEYS.has(key) && value === from) return to;
    return value.replace(new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, 'g'), `{{${to}}}`);
  }
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, from, to));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameRefs(v, from, to, k)]));
  return value;
}

function VariableRow({ v, onChange, onRename, onRemove }: { v: Variable; onChange: (p: Partial<Variable>) => void; onRename: (n: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(v.name);
  useEffect(() => setName(v.name), [v.name]);
  return (
    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex gap-1">
        <input
          className="input font-mono"
          placeholder="variableName"
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\s+/g, '_'))}
          onBlur={() => name !== v.name && onRename(name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn-icon" title="Remove variable" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex gap-1">
        <select className="input" value={v.type} onChange={(e) => onChange({ type: e.target.value as VariableType, default: null })}>
          {VAR_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          className="input"
          placeholder={v.type === 'list' ? 'default: a, b, c' : 'default'}
          title={v.type === 'list' ? 'Comma-separated values' : undefined}
          value={v.default === null || v.default === undefined ? '' : Array.isArray(v.default) ? v.default.join(', ') : String(v.default)}
          onChange={(e) => {
            const raw = e.target.value;
            const val =
              raw === ''
                ? null
                : v.type === 'list'
                  ? raw.split(',').map((x) => x.trim())
                  : v.type === 'number' && !Number.isNaN(Number(raw))
                    ? Number(raw)
                    : v.type === 'boolean'
                      ? raw === 'true'
                      : raw;
            onChange({ default: val });
          }}
        />
      </div>
      <input className="input text-xs" placeholder="description (optional)" value={v.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
    </div>
  );
}

function LinkList({ title, items, onOpen }: { title: string; items: WorkflowSummary[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">None</p>
      ) : (
        items.map((w) => (
          <button key={w.id} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm text-teal-800 hover:bg-teal-50" onClick={() => onOpen(w.id)}>
            <Workflow size={13} className="shrink-0" />
            <span className="truncate">{w.name}</span>
            <ArrowUpRight size={13} className="ml-auto shrink-0" />
          </button>
        ))
      )}
    </div>
  );
}

/** "Design → Commercial: Release package → Set budget" lines for cross-lane connections. */
function HandoffList({ nodes, edges, laneId, onSelect }: { nodes: FlowNode[]; edges: FlowEdge[]; laneId?: string; onSelect: (id: string) => void }) {
  const lanes = new Map(lanesOf(nodes).map((l) => [l.id, l.name || 'Lane']));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const list = findHandoffs(nodes, edges).filter((h) => !laneId || h.from === laneId || h.to === laneId);
  if (!list.length) return <p className="text-xs text-slate-400">No connections cross between lanes yet.</p>;
  return (
    <ul className="space-y-1">
      {list.map(({ edge, from, to }) => (
        <li key={edge.id}>
          <button className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-orange-50" onClick={() => onSelect(edge.target)}>
            <span className="font-semibold text-orange-800">
              {lanes.get(from)} → {lanes.get(to)}
            </span>
            <span className="block truncate text-slate-500">
              {byId.get(edge.source)?.data.label} → {byId.get(edge.target)?.data.label}
              {typeof edge.label === 'string' && edge.label ? ` (${edge.label})` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WorkflowPanel({ issues, workflows, onOpenWorkflow }: { issues: Issue[]; workflows: WorkflowSummary[]; onOpenWorkflow: (id: string) => void }) {
  const doc = useWorkflow((s) => s.doc)!;
  const { setMeta, setVariables, setNodes } = useWorkflow.getState();
  const vars = doc.variables;
  const errors = issues.filter((i) => i.level === 'error').length;
  const lanes = lanesOf(doc.nodes);
  const self = workflows.find((w) => w.id === doc.id);
  const uses = workflows.filter((w) => self?.refs.includes(w.id));
  const usedBy = workflows.filter((w) => w.id !== doc.id && w.refs.includes(doc.id));

  const rename = (i: number, to: string) => {
    const from = vars[i].name;
    setVariables(vars.map((v, j) => (j === i ? { ...v, name: to } : v)));
    if (from && to)
      setNodes(
        useWorkflow.getState().doc!.nodes.map((n) => ({ ...n, data: renameRefs(n.data, from, to) as FlowNode['data'] })),
        false,
      );
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Workflow name</span>
        <input className="input" value={doc.name} onChange={(e) => setMeta({ name: e.target.value })} />
      </div>
      <div>
        <span className="label">Description</span>
        <textarea className="input min-h-[60px]" value={doc.description} onChange={(e) => setMeta({ description: e.target.value })} />
      </div>
      <div className="flex gap-4 text-xs text-slate-500">
        <span>Version {doc.version}</span>
        <span className={errors ? 'text-red-600' : 'text-emerald-600'}>{errors ? `${errors} error(s)` : 'Valid'}</span>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Variables</span>
          <button
            className="btn py-0.5"
            onClick={() => {
              let n = vars.length + 1;
              while (vars.some((v) => v.name === `var${n}`)) n++;
              setVariables([...vars, { name: `var${n}`, type: 'string', default: null }]);
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-400">Data the workflow carries, used by conditions, forms and expressions. Reference in text as {'{{name}}'}.</p>
        <div className="space-y-2">
          {vars.length === 0 && <p className="text-xs text-slate-400">No variables yet.</p>}
          {vars.map((v, i) => (
            <VariableRow
              key={i}
              v={v}
              onChange={(p) => setVariables(vars.map((x, j) => (j === i ? { ...x, ...p } : x)))}
              onRename={(n) => rename(i, n)}
              onRemove={() => setVariables(vars.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      </div>
      <div className="space-y-2 border-t pt-3">
        <span className="label mb-0">Layout</span>
        <select className="input" value={doc.direction ?? 'LR'} onChange={(e) => setMeta({ direction: e.target.value as 'LR' | 'TB' })}>
          <option value="LR">Flow left → right</option>
          <option value="TB">Flow top → bottom (swimlanes)</option>
        </select>
        <div className="flex gap-1.5">
          <button className="btn flex-1 justify-center" onClick={() => useWorkflow.getState().addNode('lane', { x: 0, y: 0 })}>
            <Columns3 size={14} /> Add swimlane
          </button>
          <button
            className="btn flex-1 justify-center"
            onClick={() => {
              const lanes = doc.nodes.filter((n) => n.type === 'lane');
              const bottom = Math.max(0, ...lanes.map((l) => l.position.y + (l.height ?? 600)));
              useWorkflow.getState().addNode('band', { x: 0, y: bottom + 40 });
            }}
          >
            <Rows3 size={14} /> Add section
          </button>
        </div>
        {lanes.length > 0 && (
          <div>
            <div className="mb-1 mt-2 text-xs font-medium text-slate-500">
              {lanes.length} lanes · {findHandoffs(doc.nodes, doc.edges).length} handoffs between them
            </div>
            <HandoffList nodes={doc.nodes} edges={doc.edges} onSelect={(id) => useWorkflow.getState().selectOnly(id)} />
          </div>
        )}
      </div>
      <div className="space-y-3 border-t pt-3">
        <span className="label mb-0">Linked workflows</span>
        <LinkList title="This workflow links to" items={uses} onOpen={onOpenWorkflow} />
        <LinkList title="Linked from" items={usedBy} onOpen={onOpenWorkflow} />
      </div>
    </div>
  );
}

export function Inspector({ workflows, issues, onOpenWorkflow }: { workflows: WorkflowSummary[]; issues: Issue[]; onOpenWorkflow: (id: string) => void }) {
  const doc = useWorkflow((s) => s.doc)!;
  const updateNodeData = useWorkflow((s) => s.updateNodeData);
  const updateEdge = useWorkflow((s) => s.updateEdge);
  const selectedNodes = doc.nodes.filter((n) => n.selected);
  const selectedEdges = doc.edges.filter((e) => e.selected);

  let body: React.ReactNode;
  let title = 'Workflow';

  if (selectedNodes.length === 1) {
    const node = selectedNodes[0];
    const def = getDef(node.type)!;
    title = def.label;
    const nodeIssues = issues.filter((i) => i.nodeId === node.id);
    const showLabel = node.type !== 'sticky';
    body = (
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-400">{def.description}</p>
        {showLabel && (
          <div>
            <span className="label">{node.type === 'text' ? 'Text' : 'Name'}</span>
            <input className="input" value={node.data.label ?? ''} onChange={(e) => updateNodeData(node.id, { label: e.target.value })} />
          </div>
        )}
        {def.fields
          .filter((f) => !f.visible || f.visible(node.data))
          .map((f) => (
            <FieldEditor
              key={f.key}
              field={f}
              value={node.data[f.key]}
              variables={doc.variables}
              workflows={workflows.filter((w) => w.id !== doc.id)}
              onChange={(v) => updateNodeData(node.id, { [f.key]: node.type === 'setVariable' && f.key === 'value' ? typedValue(v, doc.variables.find((x) => x.name === node.data.variable)?.type) : v })}
              onWorkflowPick={(w) => {
                const oldName = node.data.workflowName;
                const keepLabel = node.data.label && node.data.label !== def.label && node.data.label !== oldName;
                updateNodeData(node.id, {
                  workflowName: w?.name ?? '',
                  outcomes: w?.outcomes ?? [],
                  ...(keepLabel ? {} : { label: w?.name ?? def.label }),
                });
              }}
            />
          ))}
        {node.type === 'subworkflow' && node.data.workflowId && workflows.some((w) => w.id === node.data.workflowId) && (
          <div className="space-y-2 rounded-md bg-slate-50 p-2">
            {node.data.mode !== 'handoff' && (
              <div className="text-xs text-slate-500">
                Continues on:{' '}
                {(node.data.outcomes ?? []).length
                  ? (node.data.outcomes as { label: string }[]).map((o) => o.label).join(', ')
                  : 'a single output (the linked workflow has no End block)'}
              </div>
            )}
            <button className="btn w-full justify-center" onClick={() => onOpenWorkflow(node.data.workflowId)}>
              <ArrowUpRight size={14} /> Open “{node.data.workflowName}”
            </button>
          </div>
        )}
        {nodeIssues.length > 0 && (
          <div className="space-y-1 rounded-md bg-red-50 p-2 text-xs">
            {nodeIssues.map((i, k) => (
              <div key={k} className={i.level === 'error' ? 'text-red-700' : 'text-amber-700'}>
                • {i.message}
              </div>
            ))}
          </div>
        )}
        {node.type === 'lane' && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex gap-1.5">
              <button className="btn flex-1 justify-center" title="Move this lane (and its blocks) left" onClick={() => useWorkflow.getState().setNodes(moveLane(doc.nodes, node.id, -1))}>
                <ArrowLeft size={14} /> Move left
              </button>
              <button className="btn flex-1 justify-center" title="Move this lane (and its blocks) right" onClick={() => useWorkflow.getState().setNodes(moveLane(doc.nodes, node.id, 1))}>
                Move right <ArrowRight size={14} />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {[...membership(doc.nodes).lane.values()].filter((l) => l === node.id).length} items in this lane. Drag the lane's right edge to resize it. Deleting a lane keeps its blocks.
            </p>
            <span className="label mb-0">Handoffs in and out</span>
            <HandoffList nodes={doc.nodes} edges={doc.edges} laneId={node.id} onSelect={(id) => useWorkflow.getState().selectOnly(id)} />
          </div>
        )}
        {node.type === 'band' && (
          <p className="border-t pt-3 text-xs text-slate-500">
            A section across all lanes. Blocks inside it are exported with this section. Drag its title to move it, and its top or bottom edge to resize.
          </p>
        )}
        <div className="border-t pt-2 font-mono text-[10px] text-slate-400">id: {node.id}</div>
      </div>
    );
  } else if (selectedNodes.length > 1) {
    title = `${selectedNodes.length} selected`;
    body = <p className="text-sm text-slate-500">Ctrl+C / Ctrl+V to duplicate, Delete to remove, or drag them into a frame.</p>;
  } else if (selectedEdges.length === 1) {
    const e = selectedEdges[0];
    title = 'Connection';
    body = (
      <div className="space-y-3">
        <div>
          <span className="label">Label</span>
          <input className="input" value={typeof e.label === 'string' ? e.label : ''} onChange={(ev) => updateEdge(e.id, { label: ev.target.value })} />
        </div>
        <p className="text-xs text-slate-500">
          From output <b>{e.sourceHandle ?? 'out'}</b>. Press Delete to remove.
        </p>
      </div>
    );
  } else {
    body = <WorkflowPanel issues={issues} workflows={workflows} onOpenWorkflow={onOpenWorkflow} />;
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="flex-1 overflow-y-auto p-4">{body}</div>
    </aside>
  );
}
