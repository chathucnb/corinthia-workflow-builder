import type { WorkflowDoc } from '../types';

/** One way a linked workflow can finish (one per End block). */
export interface Outcome {
  id: string;
  label: string;
}

/** Each End block of a workflow becomes an outcome a caller can branch on. */
export function endOutcomes(doc: WorkflowDoc): Outcome[] {
  return doc.nodes
    .filter((n) => n.type === 'end')
    .map((n) => ({ id: n.id, label: String(n.data.label || n.data.status || 'End') }));
}

/** Ids of the workflows this workflow links to through Sub-workflow blocks. */
export function workflowRefs(doc: Pick<WorkflowDoc, 'nodes'>): string[] {
  return [
    ...new Set(
      doc.nodes
        .filter((n) => n.type === 'subworkflow' && typeof n.data.workflowId === 'string' && n.data.workflowId)
        .map((n) => n.data.workflowId as string),
    ),
  ];
}

/** True when following links from `fromId` eventually comes back to `targetId`. */
export function reaches(fromId: string, targetId: string, refsOf: (id: string) => string[]): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...refsOf(id));
  }
  return false;
}

/** The workflow plus every workflow it links to, directly or indirectly. */
export function withDependencies(rootId: string, all: Map<string, WorkflowDoc>): WorkflowDoc[] {
  const out: WorkflowDoc[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const d = all.get(id);
    if (!d || seen.has(id)) return;
    seen.add(id);
    out.push(d);
    workflowRefs(d).forEach(visit);
  };
  visit(rootId);
  return out;
}

export const sameOutcomes = (a: Outcome[] = [], b: Outcome[] = []) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.label === b[i].label);
