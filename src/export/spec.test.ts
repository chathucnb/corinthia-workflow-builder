import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { fromJson } from './convert';
import { exampleBundle, exampleWorkflow } from './examples';
import { bundleJsonSchema, workflowJsonSchema } from './spec';
import { validate } from './validate';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(workflowJsonSchema(), 'workflow.schema.json');
const checkWorkflow = ajv.getSchema('workflow.schema.json')!;
const checkBundle = ajv.compile(bundleJsonSchema());

describe('published JSON Schema', () => {
  it('accepts the example workflow', () => {
    expect(checkWorkflow(exampleWorkflow()), JSON.stringify(checkWorkflow.errors)).toBe(true);
  });

  it('accepts the example bundle', () => {
    expect(checkBundle(exampleBundle()), JSON.stringify(checkBundle.errors)).toBe(true);
  });

  it('accepts list defaults and typed Set Variable values', () => {
    const wf = exampleWorkflow() as any;
    wf.variables.push({ name: 'floors', type: 'list', default: ['B', 'G'] }, { name: 'ready', type: 'boolean', default: false });
    wf.nodes.push({ id: 'sv', type: 'setVariable', category: 'data', label: 'Ready', data: { variable: 'ready', value: true }, outputs: [{ id: 'out', label: '' }] });
    expect(checkWorkflow(wf), JSON.stringify(checkWorkflow.errors)).toBe(true);
  });

  it('rejects a wrong option value for a block', () => {
    const wf = exampleWorkflow();
    (wf.nodes.find((n) => n.type === 'end')!.data as Record<string, unknown>).status = 'exploded';
    expect(checkWorkflow(wf)).toBe(false);
  });

  it('rejects unknown block types and missing edge ports', () => {
    const wf = exampleWorkflow() as any;
    wf.nodes[0].type = 'teleport';
    delete wf.edges[0].sourceHandle;
    expect(checkWorkflow(wf)).toBe(false);
  });

  it('example workflows are valid in the tool too', () => {
    const [slab, pour] = exampleBundle().workflows.map(fromJson);
    const summaries = [slab, pour].map((d) => ({
      id: d.id, name: d.name, description: '', updatedAt: d.updatedAt, nodeCount: d.nodes.length,
      outcomes: d.nodes.filter((n) => n.type === 'end').map((n) => ({ id: n.id, label: String(n.data.label) })),
      refs: d.nodes.filter((n) => n.type === 'subworkflow').map((n) => String(n.data.workflowId)),
    }));
    expect(validate(slab, summaries).filter((i) => i.level === 'error')).toEqual([]);
    expect(validate(pour, summaries).filter((i) => i.level === 'error')).toEqual([]);
  });
});
