import { createStore, del, entries, get, set } from 'idb-keyval';
import { endOutcomes, workflowRefs } from '../export/links';
import type { WorkflowDoc, WorkflowSummary } from '../types';

/** All workflows live in the browser's IndexedDB on this machine. */
const db = createStore('corinthia-workflows', 'workflows');

export const loadWorkflow = (id: string) => get<WorkflowDoc>(id, db);

/** Persist without runtime-only React Flow fields. */
export const saveWorkflow = (doc: WorkflowDoc) =>
  set(
    doc.id,
    {
      ...doc,
      nodes: doc.nodes.map(({ measured: _m, dragging: _d, resizing: _r, selected: _s, ...n }) => n),
      edges: doc.edges.map(({ selected: _s, ...e }) => e),
    },
    db,
  );

export const deleteWorkflow = (id: string) => del(id, db);

export async function loadAllWorkflows(): Promise<WorkflowDoc[]> {
  const all = await entries<string, WorkflowDoc>(db);
  return all.map(([, v]) => v).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const summarize = (w: WorkflowDoc): WorkflowSummary => ({
  id: w.id,
  name: w.name,
  description: w.description,
  updatedAt: w.updatedAt,
  nodeCount: w.nodes.filter((n) => !['sticky', 'frame', 'text'].includes(n.type ?? '')).length,
  outcomes: endOutcomes(w),
  refs: workflowRefs(w),
});

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return (await loadAllWorkflows()).map(summarize);
}


// ───────────── Disk files ─────────────

type FileHandle = {
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  name: string;
};
const handles = new Map<string, FileHandle>();
const w = window as unknown as {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'workflow';
export const fileNameFor = (name: string) => `${slug(name)}.json`;

/**
 * Saves JSON to disk. In Chrome/Edge the chosen file is remembered per key
 * so later saves overwrite it in place; elsewhere it falls back to a download.
 * Returns the file name written, or null if the user cancelled.
 */
export async function saveToDisk(key: string, suggestedName: string, json: string, forcePicker = false): Promise<string | null> {
  if (w.showSaveFilePicker) {
    try {
      let h = forcePicker ? undefined : handles.get(key);
      if (!h) {
        h = await w.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Workflow JSON', accept: { 'application/json': ['.json'] } }],
        });
        handles.set(key, h);
      }
      const out = await h.createWritable();
      await out.write(json);
      await out.close();
      return h.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // fall through to download
    }
  }
  downloadText(suggestedName, json);
  return suggestedName;
}

export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    };
    input.click();
  });
}
