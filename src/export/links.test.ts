import { describe, expect, it } from 'vitest';
import { getDef } from '../nodes/registry';
import { newWorkflow, useWorkflow } from '../store/workflowStore';
import type { WorkflowDoc, WorkflowSummary } from '../types';
import { toJson } from './convert';
import { endOutcomes, withDependencies, workflowRefs } from './links';
import { validate } from './validate';

const summary = (d: WorkflowDoc): WorkflowSummary => ({
  id: d.id,
  name: d.name,
  description: '',
  updatedAt: d.updatedAt,
  nodeCount: d.nodes.length,
  outcomes: endOutcomes(d),
  refs: workflowRefs(d),
});

/** Start → Linked Workflow(target) → End */
function caller(name: string, target: WorkflowDoc, mode: 'call' | 'handoff' = 'call'): WorkflowDoc {
  const wf = newWorkflow(name);
  const [start, end] = wf.nodes;
  wf.nodes.push({
    id: 'link',
    type: 'subworkflow',
    position: { x: 300, y: 0 },
    data: { label: target.name, workflowId: target.id, workflowName: target.name, mode, outcomes: endOutcomes(target) },
  });
  wf.edges.push({ id: 'e1', source: start.id, sourceHandle: 'out', target: 'link' });
  for (const o of getDef('subworkflow')!.outputs(wf.nodes[2].data))
    wf.edges.push({ id: `e_${o.id}`, source: 'link', sourceHandle: o.id, target: end.id });
  return wf;
}

describe('linked workflows', () => {
  const child = newWorkflow('Child');
  const [, childEnd] = child.nodes;
  child.nodes.push({ id: 'end2', type: 'end', position: { x: 0, y: 0 }, data: { label: 'Rejected', status: 'rejected' } });

  it('gives a Linked Workflow block one output per End block of the target', () => {
    const outs = getDef('subworkflow')!.outputs({ label: '', mode: 'call', outcomes: endOutcomes(child) });
    expect(outs.map((o) => o.id)).toEqual([childEnd.id, 'end2']);
    expect(getDef('subworkflow')!.outputs({ label: '', mode: 'handoff', outcomes: endOutcomes(child) })).toEqual([]);
  });

  it('lists linked workflows as dependencies in the export', () => {
    const parent = caller('Parent', child);
    expect(toJson(parent).dependencies).toEqual([{ id: child.id, name: 'Child' }]);
  });

  it('passes validation when the link is wired up', () => {
    const parent = caller('Parent', child);
    const issues = validate(parent, [summary(parent), summary(child)]);
    expect(issues.filter((i) => i.nodeId === 'link')).toEqual([]);
  });

  it('flags links to deleted workflows', () => {
    const parent = caller('Parent', child);
    const msgs = validate(parent, [summary(parent)]).map((i) => i.message);
    expect(msgs.some((m) => m.includes('no longer exists'))).toBe(true);
  });

  it('warns about circular links', () => {
    const a = newWorkflow('A');
    const b = caller('B', a);
    const a2 = caller('A', b);
    a2.id = a.id;
    const msgs = validate(a2, [summary(a2), summary(b)]).map((i) => i.message);
    expect(msgs.some((m) => m.includes('circular'))).toBe(true);
  });

  it('bundles a workflow with everything it links to', () => {
    const parent = caller('Parent', child);
    const top = caller('Top', parent);
    const all = new Map([top, parent, child].map((d) => [d.id, d]));
    expect(withDependencies(top.id, all).map((d) => d.name)).toEqual(['Top', 'Parent', 'Child']);
  });

  it('inserts a copy of another workflow without its Start block', () => {
    const host = newWorkflow('Host');
    useWorkflow.getState().load(host);
    const src = caller('Source', child);
    src.variables = [{ name: 'qty', type: 'number', default: null }];
    useWorkflow.getState().insertCopy(src, { x: 0, y: 500 });
    const doc = useWorkflow.getState().doc!;
    expect(doc.nodes.filter((n) => n.type === 'start')).toHaveLength(1);
    expect(doc.nodes).toHaveLength(2 + 2); // host start/end + copied link/end
    expect(doc.edges.length).toBeGreaterThan(0);
    expect(doc.variables.map((v) => v.name)).toEqual(['qty']);
  });
});
