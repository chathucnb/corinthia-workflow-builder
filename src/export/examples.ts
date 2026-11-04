import { SAMPLE_JSON } from '../app/sample';
import { SWIMLANE_SAMPLE } from '../app/sampleLanes';
import { aiToDoc } from '../ai/apply';
import { getDef } from '../nodes/registry';
import { fromJson, toJson } from './convert';
import { endOutcomes } from './links';
import { SCHEMA_VERSION, type WorkflowBundle, type WorkflowExport } from './schema';

const STAMP = '2026-11-04T09:00:00.000Z';

/** The swimlane example (five departments + a Changes section), as the tool exports it. */
export function exampleSwimlanes(): WorkflowExport {
  const doc = aiToDoc(SWIMLANE_SAMPLE, { workflows: [] }).doc;
  // Stable ids so the published file doesn't change on every build.
  const ids = new Map<string, string>();
  doc.nodes.filter((n) => n.type === 'lane' || n.type === 'band').forEach((n) => ids.set(n.id, `${n.type}_${String(n.data.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`));
  doc.edges.forEach((e, i) => ids.set(e.id, `e${i + 1}`));
  const remap = JSON.stringify({ ...doc, id: 'wf_package_procurement', createdAt: STAMP, updatedAt: STAMP }).replace(/"(a_[0-9a-f]{10}|e_[0-9a-f]{10})"/g, (m, id) => (ids.has(id) ? `"${ids.get(id)}"` : m));
  return toJson(JSON.parse(remap));
}

/** The "Concrete Pour Approval" example, exactly as the tool exports it. */
export function exampleWorkflow(): WorkflowExport {
  return toJson(fromJson({ ...SAMPLE_JSON, id: 'wf_concrete_pour', createdAt: STAMP, updatedAt: STAMP }));
}

/**
 * A parent workflow that runs work in parallel, routes with a switch and
 * links to the concrete pour workflow, bundled with that workflow.
 */
export function exampleBundle(): WorkflowBundle {
  const pour = exampleWorkflow();
  const pourDoc = fromJson(pour);
  const outcomes = endOutcomes(pourDoc);
  const j = (id: string, type: string, label: string, data: Record<string, unknown>) => {
    const def = getDef(type)!;
    const full = { ...def.defaults(), ...data };
    return { id, type, category: def.category as 'logic' | 'data' | 'construction', label, data: full, outputs: def.outputs({ label, ...full }) };
  };
  const nodes = [
    j('s1', 'start', 'Slab cycle starts', { trigger: 'event', event: 'slab.formwork.ready' }),
    j('s2', 'form', 'Slab details', {
      assigneeRole: 'Site Engineer',
      fields: [
        { name: 'level', label: 'Level', type: 'string', required: true, variable: 'slabLevel' },
        { name: 'type', label: 'Slab type', type: 'string', required: true, variable: 'slabType' },
      ],
    }),
    j('s3', 'parallel', 'Prepare slab', { branches: 2 }),
    j('s4', 'assign', 'Fix rebar', { role: 'Foreman', department: 'Civil', task: 'Fix reinforcement to shop drawings', dueInDays: 2 }),
    j('s5', 'assign', 'Install MEP sleeves', { role: 'Subcontractor', department: 'MEP', task: 'Install sleeves and embeds', dueInDays: 2 }),
    j('s6', 'join', 'Ready for pour', { mode: 'all' }),
    j('s7', 'switch', 'Slab type?', {
      variable: 'slabType',
      cases: [
        { id: 'case_pt', value: 'post-tensioned', label: 'Post-tensioned' },
        { id: 'case_rc', value: 'rc', label: 'RC' },
      ],
      hasDefault: false,
    }),
    j('s8', 'approval', 'PT design check', { role: 'Structural Engineer', slaHours: 24, instructions: 'Check tendon profile for {{slabLevel}}' }),
    j('s9', 'subworkflow', 'Concrete Pour Approval', { workflowId: pour.id, workflowName: pour.name, mode: 'call', outcomes }),
    j('s10', 'end', 'Slab complete', { status: 'completed' }),
    j('s11', 'end', 'Design rejected', { status: 'rejected' }),
  ];
  const e = (id: string, source: string, sourceHandle: string, target: string, label = '') => ({ id, source, sourceHandle, target, label });
  const parent: WorkflowExport = {
    schemaVersion: SCHEMA_VERSION,
    id: 'wf_slab_cycle',
    name: 'Slab Construction Cycle',
    description: 'Rebar and MEP in parallel, a design check for post-tensioned slabs, then the concrete pour workflow.',
    version: 2,
    createdAt: STAMP,
    updatedAt: STAMP,
    variables: [
      { name: 'slabLevel', type: 'string', default: null },
      { name: 'slabType', type: 'string', default: 'rc', description: 'post-tensioned or rc' },
    ],
    nodes,
    edges: [
      e('e1', 's1', 'out', 's2'),
      e('e2', 's2', 'out', 's3'),
      e('e3', 's3', 'branch_1', 's4', 'Branch 1'),
      e('e4', 's3', 'branch_2', 's5', 'Branch 2'),
      e('e5', 's4', 'out', 's6'),
      e('e6', 's5', 'out', 's6'),
      e('e7', 's6', 'out', 's7'),
      e('e8', 's7', 'case_pt', 's8', 'Post-tensioned'),
      e('e9', 's7', 'case_rc', 's9', 'RC'),
      e('e10', 's8', 'approved', 's9', 'Approved'),
      e('e11', 's8', 'rejected', 's11', 'Rejected'),
      ...outcomes.map((o, i) => e(`e${12 + i}`, 's9', o.id, 's10', o.label)),
    ],
    lanes: [],
    sections: [],
    handoffs: [],
    dependencies: [{ id: pour.id, name: pour.name }],
    annotations: [],
    layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 280, y: 100 }])),
  };
  // Round-trip through the tool so the file is exactly what it would export.
  return { kind: 'corinthia-workflow-bundle', exportedAt: STAMP, workflows: [toJson(fromJson(parent)), pour] };
}
