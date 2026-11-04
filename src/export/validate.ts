import { getDef, isAnnotation } from '../nodes/registry';
import type { Issue, RuleGroup, WorkflowDoc, WorkflowSummary } from '../types';
import { reaches, sameOutcomes } from './links';
import { membership } from '../canvas/lanes';

const NO_VALUE_OPS = new Set(['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse']);

/**
 * Static checks run before exporting a workflow. Pass the other saved
 * workflows to also check Linked Workflow blocks (missing / circular links).
 */
export function validate(doc: WorkflowDoc, workflows?: WorkflowSummary[]): Issue[] {
  const issues: Issue[] = [];
  const nodes = doc.nodes.filter((n) => !isAnnotation(n.type));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = doc.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
  const varNames = new Set(doc.variables.map((v) => v.name));
  const name = (id: string) => byId.get(id)?.data.label || byId.get(id)?.type || id;

  // Variables
  const seen = new Set<string>();
  for (const v of doc.variables) {
    if (!v.name.trim()) issues.push({ level: 'error', message: 'A variable has no name' });
    else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name))
      issues.push({ level: 'error', message: `Variable "${v.name}" must use letters, digits and _ only` });
    if (seen.has(v.name)) issues.push({ level: 'error', message: `Variable "${v.name}" is declared twice` });
    seen.add(v.name);
  }

  // Start / End
  const starts = nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) issues.push({ level: 'error', message: 'Workflow needs a Start block' });
  if (starts.length > 1) starts.slice(1).forEach((s) => issues.push({ level: 'error', nodeId: s.id, message: 'Only one Start block is allowed' }));
  if (!nodes.some((n) => n.type === 'end')) issues.push({ level: 'error', message: 'Workflow needs at least one End block' });

  // Reachability from Start
  if (starts.length) {
    const reach = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) if (e.source === id && !reach.has(e.target)) { reach.add(e.target); queue.push(e.target); }
    }
    nodes.forEach((n) => {
      if (!reach.has(n.id)) issues.push({ level: 'warning', nodeId: n.id, message: `"${name(n.id)}" cannot be reached from Start` });
    });
  }

  for (const n of nodes) {
    const def = getDef(n.type);
    if (!def) {
      issues.push({ level: 'error', nodeId: n.id, message: `Unknown block type "${n.type}"` });
      continue;
    }
    const d = n.data;
    const label = name(n.id);

    if (!String(d.label ?? '').trim()) issues.push({ level: 'warning', nodeId: n.id, message: `A ${def.label} block has no name` });

    // Connections
    if (def.hasInput && !edges.some((e) => e.target === n.id))
      issues.push({ level: 'error', nodeId: n.id, message: `"${label}" has no incoming connection` });
    for (const port of def.outputs(d)) {
      if (!edges.some((e) => e.source === n.id && (e.sourceHandle ?? 'out') === port.id)) {
        const which = port.label ? ` "${port.label}" output` : ' output';
        issues.push({ level: 'error', nodeId: n.id, message: `"${label}"${which} is not connected` });
      }
    }

    // Required fields
    for (const f of def.fields) {
      if (!f.required || (f.visible && !f.visible(d))) continue;
      const v = d[f.key];
      const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (f.kind === 'rules' && !(v as RuleGroup)?.rules?.length);
      if (empty) issues.push({ level: 'error', nodeId: n.id, message: `"${label}": ${f.label} is required` });
    }

    // Variable references
    const refVar = (v: unknown, where: string) => {
      if (typeof v === 'string' && v && !varNames.has(v))
        issues.push({ level: 'error', nodeId: n.id, message: `"${label}": ${where} uses undeclared variable "${v}"` });
    };
    for (const f of def.fields) {
      if (f.visible && !f.visible(d)) continue;
      if (f.kind === 'variable') refVar(d[f.key], f.label);
      if (f.kind === 'rules') {
        const g = d[f.key] as RuleGroup | undefined;
        g?.rules?.forEach((r, i) => {
          if (!r.var) issues.push({ level: 'error', nodeId: n.id, message: `"${label}": rule ${i + 1} has no variable` });
          else refVar(r.var, `rule ${i + 1}`);
          if (!NO_VALUE_OPS.has(r.op)) {
            const empty = r.op === 'between'
              ? !Array.isArray(r.value) || r.value.some((x) => x === '' || x === null || x === undefined)
              : r.value === '' || r.value === null || r.value === undefined;
            if (empty) issues.push({ level: 'warning', nodeId: n.id, message: `"${label}": rule ${i + 1} has no value` });
          }
        });
      }
      if (f.kind === 'formFields') {
        (d[f.key] as { name: string; variable?: string }[] | undefined)?.forEach((ff) => {
          if (!ff.name) issues.push({ level: 'error', nodeId: n.id, message: `"${label}": a form field has no name` });
          refVar(ff.variable, `field "${ff.name}"`);
        });
      }
      if (f.kind === 'cases') {
        const vals = (d[f.key] as { value: string }[] | undefined)?.map((c) => c.value) ?? [];
        if (!vals.length) issues.push({ level: 'error', nodeId: n.id, message: `"${label}" needs at least one case` });
        if (new Set(vals).size !== vals.length) issues.push({ level: 'error', nodeId: n.id, message: `"${label}" has duplicate case values` });
      }
    }
    // Links to other workflows
    if (n.type === 'subworkflow' && d.workflowId && workflows) {
      const target = workflows.find((w) => w.id === d.workflowId);
      if (d.workflowId === doc.id) {
        issues.push({ level: 'error', nodeId: n.id, message: `"${label}" links to this same workflow` });
      } else if (!target) {
        issues.push({ level: 'error', nodeId: n.id, message: `"${label}" links to a workflow that no longer exists (${d.workflowName || d.workflowId})` });
      } else {
        const refsOf = (id: string) => workflows.find((w) => w.id === id)?.refs ?? [];
        if (reaches(target.id, doc.id, refsOf))
          issues.push({ level: 'warning', nodeId: n.id, message: `"${label}": "${target.name}" links back to this workflow (circular)` });
        if (d.mode !== 'handoff' && !sameOutcomes(d.outcomes, target.outcomes))
          issues.push({ level: 'warning', nodeId: n.id, message: `"${label}": outcomes of "${target.name}" have changed. Reopen this workflow to refresh` });
        if (!target.outcomes.length && d.mode !== 'handoff')
          issues.push({ level: 'warning', nodeId: n.id, message: `"${target.name}" has no End block, so it never returns here` });
      }
    }

    // {{var}} templates in free text
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string' || k === 'label') continue;
      for (const m of v.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
        const isLoopItem = nodes.some((x) => x.type === 'loop' && x.data.itemVariable === m[1]);
        if (!varNames.has(m[1]) && !isLoopItem)
          issues.push({ level: 'warning', nodeId: n.id, message: `"${label}" references unknown variable {{${m[1]}}}` });
      }
    }
  }

  // Swimlanes: every block should belong to a department.
  const areas = membership(doc.nodes);
  if (areas.lanes.length)
    for (const n of nodes)
      if (!areas.lane.has(n.id))
        issues.push({ level: 'warning', nodeId: n.id, message: `"${name(n.id)}" is outside every swimlane` });

  return issues;
}
