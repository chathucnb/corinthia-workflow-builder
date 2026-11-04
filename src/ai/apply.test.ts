import { describe, expect, it } from 'vitest';
import { SAMPLE_JSON } from '../app/sample';
import { fromJson } from '../export/convert';
import { validate } from '../export/validate';
import type { WorkflowSummary } from '../types';
import { aiToDoc, currentForModel, withAssumptionNote, type AiWorkflow } from './apply';
import { FLOW_DEFS, OUTPUT_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt';

const j = (o: unknown) => JSON.stringify(o);

const AI: AiWorkflow = {
  name: 'Material submittal',
  description: 'Submittal review',
  variables: [{ name: 'materialType', type: 'string', description: '' }],
  nodes: [
    { id: 's', type: 'start', label: 'Submittal received', dataJson: j({ trigger: 'form' }) },
    { id: 'd', type: 'document', label: 'Data sheets', dataJson: j({ docType: 'Material Data Sheet', bogus: 1 }) },
    { id: 'a', type: 'approval', label: 'Consultant review', dataJson: j({ role: 'Consultant', slaHours: 72 }) },
    { id: 'n', type: 'notification', label: 'Resubmit', dataJson: j({ recipientRole: 'Subcontractor', message: 'Please resubmit {{materialType}}' }) },
    { id: 'e', type: 'end', label: 'Approved', dataJson: j({ status: 'completed' }) },
    { id: 'x', type: 'teleport', label: 'Nonsense', dataJson: '{}' },
  ],
  edges: [
    { source: 's', sourceHandle: 'out', target: 'd', label: '' },
    { source: 'd', sourceHandle: 'out', target: 'a', label: '' },
    { source: 'a', sourceHandle: 'approved', target: 'e', label: 'Approved' },
    { source: 'a', sourceHandle: 'rejected', target: 'n', label: 'Rejected' },
    { source: 'a', sourceHandle: 'rejected', target: 'e', label: 'dup' },
    { source: 'n', sourceHandle: 'out', target: 'd', label: '' },
    { source: 'e', sourceHandle: 'out', target: 's', label: '' },
  ],
  assumptions: ['SLA of 3 days'],
};

describe('AI output → workflow', () => {
  it('builds a valid workflow and drops what does not fit', () => {
    const { doc, dropped } = aiToDoc(AI, { workflows: [] });
    expect(doc.nodes.map((n) => n.type)).toEqual(['start', 'document', 'approval', 'notification', 'end']);
    expect(dropped.join('\n')).toMatch(/Unknown block type "teleport"/);
    expect(dropped.join('\n')).toMatch(/"Approved" has no output "out"/);
    expect(doc.edges).toHaveLength(5); // duplicate output and edge from End removed
    expect(validate(doc).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('fills defaults and ignores unknown data keys', () => {
    const { doc } = aiToDoc(AI, { workflows: [] });
    const d = doc.nodes.find((n) => n.id === 'd')!;
    expect(d.data).toMatchObject({ label: 'Data sheets', docType: 'Material Data Sheet', action: 'upload', required: true });
    expect(d.data.bogus).toBeUndefined();
  });

  it('lays out new blocks left to right', () => {
    const { doc } = aiToDoc(AI, { workflows: [] });
    const x = (id: string) => doc.nodes.find((n) => n.id === id)!.position.x;
    expect(x('s')).toBeLessThan(x('d'));
    expect(x('d')).toBeLessThan(x('a'));
  });

  it('keeps positions, frames and notes when updating without new blocks', () => {
    const base = fromJson(SAMPLE_JSON);
    const current = currentForModel(base);
    const same: AiWorkflow = {
      ...current,
      variables: current.variables.map((v) => ({ ...v })),
      nodes: current.nodes.map((n) => ({ id: n.id, type: n.type!, label: n.label, dataJson: j(n.data) })),
      assumptions: [],
    };
    const { doc } = aiToDoc(same, { base, workflows: [] });
    expect(doc.id).toBe(base.id);
    expect(doc.nodes.find((n) => n.id === 'n5')!.position).toEqual(base.nodes.find((n) => n.id === 'n5')!.position);
    expect(doc.nodes.find((n) => n.id === 'n3')!.parentId).toBe('a2');
    expect(doc.nodes.filter((n) => n.type === 'sticky')).toHaveLength(1);
    expect(doc.edges).toHaveLength(base.edges.length);
  });

  it('fills linked workflow outcomes from the saved workflow', () => {
    const wf: WorkflowSummary = { id: 'wf_x', name: 'Pour', description: '', updatedAt: '', nodeCount: 3, refs: [], outcomes: [{ id: 'end1', label: 'Done' }] };
    const ai: AiWorkflow = {
      ...AI,
      nodes: [
        { id: 's', type: 'start', label: 'Start', dataJson: '{}' },
        { id: 'l', type: 'subworkflow', label: 'Pour', dataJson: j({ workflowId: 'wf_x', mode: 'call' }) },
        { id: 'e', type: 'end', label: 'End', dataJson: '{}' },
      ],
      edges: [
        { source: 's', sourceHandle: 'out', target: 'l', label: '' },
        { source: 'l', sourceHandle: 'end1', target: 'e', label: '' },
      ],
    };
    const { doc, dropped } = aiToDoc(ai, { workflows: [wf] });
    expect(dropped).toEqual([]);
    expect(doc.nodes.find((n) => n.id === 'l')!.data).toMatchObject({ workflowName: 'Pour', outcomes: [{ id: 'end1', label: 'Done' }] });
  });

  it('adds assumptions as a sticky note', () => {
    const { doc } = aiToDoc(AI, { workflows: [] });
    const withNote = withAssumptionNote(doc, ['A', 'B']);
    expect(withNote.nodes.find((n) => n.type === 'sticky')!.data.text).toBe('Check these assumptions:\n• A\n• B');
  });
});

describe('prompt', () => {
  it('describes every block type', () => {
    for (const d of FLOW_DEFS) expect(SYSTEM_PROMPT).toContain(`type "${d.type}"`);
  });

  it('uses a strict-compatible schema (every object closed, every property required)', () => {
    const walk = (s: any) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(walk);
      }
      if (s.type === 'array') walk(s.items);
    };
    walk(OUTPUT_SCHEMA);
  });

  it('includes the current workflow only when updating', () => {
    expect(buildUserMessage({ request: 'x', workflows: [] })).not.toContain('<current_workflow>');
    expect(buildUserMessage({ request: 'x', workflows: [], current: { a: 1 } })).toContain('<current_workflow>');
  });
});
