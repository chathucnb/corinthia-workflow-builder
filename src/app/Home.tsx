import { Archive, Copy, FileUp, Pencil, Plus, Sparkles, Trash2, Wand2, Workflow } from 'lucide-react';
import { withAssumptionNote } from '../ai/apply';
import { PromptDialog } from '../ai/PromptDialog';
import { useEffect, useState } from 'react';
import { cloneDoc, parseImport, toBundle } from '../export/convert';
import {
  deleteWorkflow,
  downloadText,
  listWorkflows,
  loadAllWorkflows,
  loadWorkflow,
  pickTextFile,
  saveWorkflow,
} from '../store/persistence';
import { newWorkflow } from '../store/workflowStore';
import type { WorkflowSummary } from '../types';
import { sampleWorkflow } from './sample';

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function Home({ onOpen, toast }: { onOpen: (id: string) => void; toast: (m: string) => void }) {
  const [list, setList] = useState<WorkflowSummary[] | null>(null);
  const [prompting, setPrompting] = useState(false);
  const refresh = () => listWorkflows().then(setList);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const wf = newWorkflow();
    await saveWorkflow(wf);
    onOpen(wf.id);
  };
  const addSample = async () => {
    const wf = sampleWorkflow();
    await saveWorkflow(wf);
    onOpen(wf.id);
  };
  const importFiles = async () => {
    const text = await pickTextFile();
    if (!text) return;
    try {
      const docs = parseImport(text);
      const existing = new Set((await listWorkflows()).map((w) => w.id));
      for (const d of docs) {
        // Same id already here → keep both by importing as a copy.
        await saveWorkflow(existing.has(d.id) ? cloneDoc(d, `${d.name} (imported)`) : d);
      }
      toast(`Imported ${docs.length} workflow${docs.length > 1 ? 's' : ''}`);
      void refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const backup = async () => {
    const all = await loadAllWorkflows();
    downloadText(`corinthia-workflows-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(toBundle(all), null, 2));
  };
  const duplicate = async (id: string) => {
    const d = await loadWorkflow(id);
    if (!d) return;
    await saveWorkflow(cloneDoc(d, `${d.name} (copy)`));
    void refresh();
  };
  const rename = async (id: string, current: string) => {
    const name = prompt('Rename workflow', current);
    if (!name?.trim()) return;
    const d = await loadWorkflow(id);
    if (!d) return;
    await saveWorkflow({ ...d, name: name.trim(), updatedAt: new Date().toISOString() });
    void refresh();
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone. Consider "Backup all" first.`)) return;
    await deleteWorkflow(id);
    void refresh();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
            <Workflow size={22} />
          </div>
          <div className="mr-auto">
            <h1 className="text-2xl font-bold text-slate-900">Corinthia Workflow Builder</h1>
            <p className="text-sm text-slate-500">Design construction processes visually and export them as JSON. Everything is stored on this computer.</p>
          </div>
          <button className="btn" onClick={importFiles}>
            <FileUp size={15} /> Import JSON
          </button>
          <button className="btn" onClick={backup} disabled={!list?.length}>
            <Archive size={15} /> Backup all
          </button>
          <button className="btn" onClick={create}>
            <Plus size={15} /> New workflow
          </button>
          <button className="btn-primary" onClick={() => setPrompting(true)}>
            <Wand2 size={15} /> New from description
          </button>
        </div>

        {list && list.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="mb-4 text-slate-600">No workflows yet.</p>
            <div className="flex justify-center gap-2">
              <button className="btn-primary" onClick={() => setPrompting(true)}>
                <Wand2 size={15} /> Describe it in words
              </button>
              <button className="btn" onClick={create}>
                <Plus size={15} /> Start from scratch
              </button>
              <button className="btn" onClick={addSample}>
                <Sparkles size={15} /> Open example: Concrete Pour Approval
              </button>
            </div>
          </div>
        )}

        {list && list.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((w) => (
                <div
                  key={w.id}
                  onClick={() => onOpen(w.id)}
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-500 hover:shadow"
                >
                  <div className="mb-1 truncate font-semibold text-slate-900">{w.name}</div>
                  <div className="mb-3 line-clamp-2 min-h-[2.5em] text-sm text-slate-500">{w.description || 'No description'}</div>
                  <div className="flex items-center text-xs text-slate-400">
                    <span className="mr-auto">
                      {w.nodeCount} blocks
                      {w.refs.length > 0 && ` · links ${w.refs.length} workflow${w.refs.length > 1 ? 's' : ''}`} · {fmt(w.updatedAt)}
                    </span>
                    <span className="flex opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-icon h-7 w-7" title="Rename" onClick={() => rename(w.id, w.name)}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn-icon h-7 w-7" title="Duplicate" onClick={() => duplicate(w.id)}>
                        <Copy size={14} />
                      </button>
                      <button className="btn-icon h-7 w-7 hover:text-red-600" title="Delete" onClick={() => remove(w.id, w.name)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-6 text-sm text-teal-700 hover:underline" onClick={addSample}>
              + Add the example workflow
            </button>
          </>
        )}
      </div>
      {prompting && (
        <PromptDialog
          workflows={list ?? []}
          onClose={() => setPrompting(false)}
          onDone={async (r) => {
            const doc = withAssumptionNote(r.doc, r.assumptions);
            await saveWorkflow(doc);
            setPrompting(false);
            onOpen(doc.id);
          }}
        />
      )}
    </div>
  );
}
