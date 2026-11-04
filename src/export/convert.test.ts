import { describe, expect, it } from 'vitest';
import { SAMPLE_JSON } from '../app/sample';
import type { WorkflowDoc } from '../types';
import { fromJson, parseImport, toBundle, toJson } from './convert';
import { workflowExportSchema } from './schema';
import { validate } from './validate';

const sample = () => fromJson(SAMPLE_JSON);

describe('export / import', () => {
  it('produces JSON that matches the published schema', () => {
    const out = toJson(sample());
    expect(workflowExportSchema.safeParse(out).success).toBe(true);
    expect(out.nodes.every((n) => n.category !== ('annotation' as never))).toBe(true);
    expect(out.annotations.map((a) => a.type).sort()).toEqual(['frame', 'sticky', 'text']);
  });

  it('round-trips without losing anything', () => {
    const first = toJson(sample());
    const second = toJson(fromJson(JSON.parse(JSON.stringify(first))));
    expect(second).toEqual(first);
  });

  it('lists each node’s output ports', () => {
    const out = toJson(sample());
    expect(out.nodes.find((n) => n.id === 'n4')!.outputs.map((o) => o.id)).toEqual(['approved', 'rejected']);
    expect(out.nodes.find((n) => n.id === 'n9')!.outputs).toEqual([]);
  });

  it('keeps frame membership in layout', () => {
    const out = toJson(sample());
    expect(out.layout.n3.parentId).toBe('a2');
  });

  it('imports a backup bundle', () => {
    const docs = parseImport(JSON.stringify(toBundle([sample(), sample()])));
    expect(docs).toHaveLength(2);
  });

  it('rejects invalid files with a readable error', () => {
    expect(() => parseImport('{"name": 1}')).toThrow(/doesn't match the workflow format/);
    expect(() => parseImport('not json')).toThrow(/not valid JSON/);
  });
});

describe('validate', () => {
  it('passes the sample workflow', () => {
    expect(validate(sample()).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('flags missing start/end, unconnected branches, undeclared variables and empty required fields', () => {
    const doc: WorkflowDoc = {
      ...sample(),
      variables: [],
      nodes: [
        { id: 'c', type: 'condition', position: { x: 0, y: 0 }, data: { label: 'Check', condition: { logic: 'AND', rules: [{ var: 'x', op: '>', value: 1 }] } } },
        { id: 'a', type: 'approval', position: { x: 0, y: 0 }, data: { label: 'Approve', role: '' } },
      ],
      edges: [{ id: 'e', source: 'c', sourceHandle: 'true', target: 'a' }],
    };
    const msgs = validate(doc).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/needs a Start/);
    expect(msgs).toMatch(/at least one End/);
    expect(msgs).toMatch(/"Check" "False" output is not connected/);
    expect(msgs).toMatch(/undeclared variable "x"/);
    expect(msgs).toMatch(/Approver role is required/);
    expect(msgs).toMatch(/"Check" has no incoming connection/);
  });

  it('ignores annotations', () => {
    const d = sample();
    expect(validate(d).some((i) => i.nodeId?.startsWith('a'))).toBe(false);
  });
});

describe('lenient import', () => {
  const base = () => JSON.parse(JSON.stringify(toJson(sample())));

  it('accepts list variables with an array default', () => {
    const wf = base();
    wf.variables.push({ name: 'floors', type: 'list', default: ['B', 'G', '1', 'Roof'] });
    const [doc] = parseImport(JSON.stringify(wf));
    expect(doc.variables.find((v) => v.name === 'floors')!.default).toEqual(['B', 'G', '1', 'Roof']);
    expect(toJson(doc).variables.find((v) => v.name === 'floors')!.default).toEqual(['B', 'G', '1', 'Roof']);
  });

  it('accepts form fields written with "id" and "text"', () => {
    const wf = base();
    const form = wf.nodes.find((n: any) => n.type === 'form');
    form.data.fields = [{ id: 'notes', label: 'Notes', type: 'text', variable: '' }];
    const [doc] = parseImport(JSON.stringify(wf));
    expect(doc.nodes.find((n) => n.type === 'form')!.data.fields[0]).toMatchObject({ name: 'notes', type: 'string', required: false });
  });

  it('accepts schemaVersion 1 / "1" and rejects 2.0 with a clear message', () => {
    for (const v of [1, '1', '1.1']) {
      const wf = base();
      wf.schemaVersion = v;
      expect(() => parseImport(JSON.stringify(wf))).not.toThrow();
    }
    const wf = base();
    wf.schemaVersion = '2.0';
    expect(() => parseImport(JSON.stringify(wf))).toThrow(/schemaVersion: must be "1.0"/);
  });

  it('names the variable when a value has the wrong kind', () => {
    const wf = base();
    wf.variables[0].default = { nested: true };
    expect(() => parseImport(JSON.stringify(wf))).toThrow(/variables\[0\] "pourVolume" → default: has a value of the wrong kind/);
  });
});
