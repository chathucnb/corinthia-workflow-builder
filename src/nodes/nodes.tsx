import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import { useWorkflow } from '../store/workflowStore';
import type { FlowNode } from '../types';
import { NODE_DEFS, NOTE_COLORS, getDef } from './registry';

/** nodeId → number of validation errors, provided by the editor. */
export const IssuesContext = createContext<Map<string, number>>(new Map());

const FlowBlock = memo(({ id, type, data }: NodeProps<FlowNode>) => {
  const def = getDef(type)!;
  const Icon = def.icon;
  const outputs = def.outputs(data);
  const errors = useContext(IssuesContext).get(id) ?? 0;
  const summary = def.summary?.(data);
  const single = outputs.length === 1;

  return (
    <div
      className={`wf-node w-60 rounded-lg border bg-white shadow-sm ${errors ? 'border-red-400' : 'border-slate-200'}`}
      style={{ borderTop: `4px solid ${def.color}` }}
    >
      {def.hasInput && (
        <Handle type="target" position={Position.Left} id="in" style={{ background: '#64748b' }} />
      )}
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: def.color + '1a', color: def.color }}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{def.label}</div>
          <div className="truncate text-sm font-semibold text-slate-800" title={data.label}>
            {data.label || <span className="italic text-slate-400">Unnamed</span>}
          </div>
          {summary && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{summary}</div>}
        </div>
        {errors > 0 && (
          <span title={`${errors} issue(s)`} className="text-red-500">
            <AlertTriangle size={14} />
          </span>
        )}
      </div>
      {single && <Handle type="source" position={Position.Right} id={outputs[0].id} style={{ background: def.color }} />}
      {outputs.length > 1 && (
        <div className="border-t border-slate-100 py-1">
          {outputs.map((p) => (
            <div key={p.id} className="relative flex h-6 items-center justify-end pr-3 text-xs text-slate-500">
              {p.label}
              <Handle type="source" position={Position.Right} id={p.id} style={{ background: def.color }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Double-click to edit a text field inline (FigJam style). */
function useInlineEdit(id: string, key: string, value: string) {
  const update = useWorkflow((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== value) update(id, { [key]: draft });
  };
  const props = {
    ref,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) commit();
      e.stopPropagation();
    },
    className: 'nodrag nowheel h-full w-full resize-none bg-transparent outline-none',
  };
  return { editing, start: () => setEditing(true), props };
}

const StickyBlock = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const c = NOTE_COLORS[data.color] ?? NOTE_COLORS.yellow;
  const { editing, start, props } = useInlineEdit(id, 'text', data.text ?? '');
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={80} color={c.border} />
      <div
        className="wf-node h-full w-full overflow-hidden rounded-sm p-3 text-sm shadow-md"
        style={{ background: c.bg, borderTop: `3px solid ${c.border}` }}
        onDoubleClick={start}
      >
        {editing ? (
          <textarea {...props} />
        ) : (
          <div className="h-full whitespace-pre-wrap break-words text-slate-700">
            {data.text || <span className="italic text-slate-400">Double-click to write…</span>}
          </div>
        )}
      </div>
    </>
  );
});

const FrameBlock = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const c = NOTE_COLORS[data.color] ?? NOTE_COLORS.slate;
  const { editing, start, props } = useInlineEdit(id, 'label', data.label ?? '');
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={200} minHeight={120} color={c.border} />
      <div
        className="h-full w-full rounded-xl border-2 border-dashed"
        style={{ borderColor: c.border, background: c.bg + '99' }}
      >
        <div className="absolute -top-7 left-1 h-6 text-sm font-semibold text-slate-600" onDoubleClick={start}>
          {editing ? <textarea {...props} rows={1} className={props.className + ' w-64 overflow-hidden'} /> : data.label || 'Group'}
        </div>
      </div>
    </>
  );
});

const TextBlock = memo(({ id, data }: NodeProps<FlowNode>) => {
  const { editing, start, props } = useInlineEdit(id, 'label', data.label ?? '');
  const size = Number(data.fontSize) || 24;
  return (
    <div className="wf-node rounded px-1 font-bold text-slate-800" style={{ fontSize: size, lineHeight: 1.2 }} onDoubleClick={start}>
      {editing ? (
        <textarea {...props} rows={1} style={{ fontSize: size, width: Math.max(200, (data.label?.length ?? 4) * size * 0.6) }} />
      ) : (
        <span className="whitespace-pre">{data.label || 'Text'}</span>
      )}
    </div>
  );
});

export const nodeTypes = Object.fromEntries(
  NODE_DEFS.map((d) => [d.type, d.type === 'sticky' ? StickyBlock : d.type === 'frame' ? FrameBlock : d.type === 'text' ? TextBlock : FlowBlock]),
);
