import { CopyPlus, Search, Workflow } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, NODE_DEFS } from '../nodes/registry';
import type { WorkflowSummary } from '../types';

export const DND_TYPE = 'application/x-corinthia-node';
/** Carries the id of a saved workflow dragged from the palette. */
export const DND_WF = 'application/x-corinthia-workflow';

export function Palette({
  onAdd,
  workflows,
  onLink,
  onInsertCopy,
}: {
  onAdd: (type: string) => void;
  workflows: WorkflowSummary[];
  onLink: (id: string) => void;
  onInsertCopy: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b p-2">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
          <input className="input pl-7" placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {CATEGORIES.map((c) => {
          const defs = NODE_DEFS.filter((d) => d.category === c.id && (match(d.label) || match(d.description)));
          if (!defs.length) return null;
          return (
            <div key={c.id}>
              <div className="label">{c.label}</div>
              <div className="space-y-1">
                {defs.map((d) => {
                  const Icon = d.icon;
                  return (
                    <div
                      key={d.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_TYPE, d.type);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDoubleClick={() => onAdd(d.type)}
                      title={`${d.description}\nDrag onto the canvas, or double-click to add`}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded" style={{ background: d.color + '1a', color: d.color }}>
                        <Icon size={14} />
                      </span>
                      <span className="font-medium text-slate-700">{d.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {(() => {
          const flows = workflows.filter((w) => match(w.name));
          return (
            <div>
              <div className="label">Your workflows</div>
              {!flows.length && <p className="px-2 text-xs text-slate-400">{workflows.length ? 'No match' : 'Other saved workflows appear here, ready to link.'}</p>}
              <div className="space-y-1">
                {flows.map((w) => (
                  <div
                    key={w.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, 'subworkflow');
                      e.dataTransfer.setData(DND_WF, w.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDoubleClick={() => onLink(w.id)}
                    title={`Drag in to link "${w.name}" into this flow (or double-click)`}
                    className="group flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600">
                      <Workflow size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{w.name}</span>
                    <button
                      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 group-hover:flex"
                      title="Insert a copy of its blocks instead of linking"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInsertCopy(w.id);
                      }}
                    >
                      <CopyPlus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
      <div className="border-t p-3 text-[11px] leading-relaxed text-slate-400">
        Drag blocks onto the canvas. Connect an output dot to an input dot. Click empty canvas for workflow settings &amp; variables.
      </div>
    </aside>
  );
}
