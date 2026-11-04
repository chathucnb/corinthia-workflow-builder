import { NODE_DEFS, ROLES, type FieldDef, type NodeDef } from '../nodes/registry';
import type { WorkflowSummary } from '../types';

export const FLOW_DEFS = NODE_DEFS.filter((d) => d.category !== 'annotation');
const VAR_TYPES = ['string', 'number', 'boolean', 'date', 'list', 'file'];

/** JSON schema the model's answer must follow (structured outputs). */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'lanes', 'sections', 'variables', 'nodes', 'edges', 'assumptions'],
  properties: {
    name: { type: 'string', description: 'Short workflow name' },
    description: { type: 'string', description: 'One or two sentences' },
    lanes: { type: 'array', items: { type: 'string' }, description: 'Swimlanes (departments / roles), left to right; [] for a single-team process' },
    sections: { type: 'array', items: { type: 'string' }, description: 'Optional horizontal sections across all lanes, top to bottom; usually []' },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'description'],
        properties: {
          name: { type: 'string', description: 'camelCase identifier' },
          type: { type: 'string', enum: VAR_TYPES },
          description: { type: 'string' },
        },
      },
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'label', 'lane', 'section', 'dataJson'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: FLOW_DEFS.map((d) => d.type) },
          label: { type: 'string', description: 'Short name shown on the block' },
          lane: { type: 'string', description: 'One of "lanes", or "" when lanes is empty' },
          section: { type: 'string', description: 'One of "sections", or ""' },
          dataJson: { type: 'string', description: 'The block data object, JSON-encoded as a string' },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'sourceHandle', 'target', 'label'],
        properties: {
          source: { type: 'string' },
          sourceHandle: { type: 'string', description: 'Output id on the source block' },
          target: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything you assumed or that the user should check (max 5, short)',
    },
  },
} as const;

const FIELD_FORMAT: Partial<Record<FieldDef['kind'], string>> = {
  text: 'string',
  textarea: 'string',
  number: 'number or null',
  checkbox: 'boolean',
  stringList: 'array of strings',
  variable: 'name of a declared variable',
  workflowRef: 'id of a saved workflow (from the list in the request)',
  rules:
    '{"logic":"AND"|"OR","rules":[{"var":"<variable>","op":"=="|"!="|">"|">="|"<"|"<="|"contains"|"between"|"isEmpty"|"isNotEmpty"|"isTrue"|"isFalse","value":<value>}]} (between takes [min,max]; omit value for isEmpty/isNotEmpty/isTrue/isFalse; numbers as numbers)',
  cases: '[{"id":"case_1","value":"<value>","label":"<short label>"}] (ids must be unique; each case id becomes an output id)',
  formFields: '[{"name":"<field>","label":"<shown to user>","type":"string|number|boolean|date|list|file","required":true,"variable":"<variable to store answer, or empty>"}]',
};

function outputsText(def: NodeDef): string {
  switch (def.type) {
    case 'switch':
      return 'one output per case (output id = case id), plus "default" when hasDefault is true';
    case 'parallel':
      return '"branch_1" … "branch_N" where N = branches (2–8)';
    case 'subworkflow':
      return 'mode "call": one output per outcome of the linked workflow (output id = outcome id, listed with the saved workflows), or "out" if it has none; mode "handoff": no outputs';
    default: {
      const ports = def.outputs({ label: '', ...def.defaults() });
      return ports.length ? ports.map((p) => `"${p.id}"`).join(', ') : 'none (terminal)';
    }
  }
}

function catalog(): string {
  return FLOW_DEFS.map((def) => {
    const fields = def.fields
      .map((f) => {
        const fmt = f.kind === 'select' ? f.options!.map((o) => `"${o.value}"`).join(' | ') : FIELD_FORMAT[f.kind] ?? 'string';
        return `    - ${f.key}${f.required ? ' (required)' : ''}: ${fmt}`;
      })
      .join('\n');
    return `- type "${def.type}" (${def.label}): ${def.description}. Input: ${def.hasInput ? 'yes' : 'no'}. Outputs: ${outputsText(def)}.\n  data:\n${fields || '    (none)'}`;
  }).join('\n');
}

/** Stable system prompt (no per-request content, so it can be cached). */
export const SYSTEM_PROMPT = `You design construction-process workflows for Corinthia, a construction company. The user describes a process in plain words; you return it as a workflow graph that a visual editor will draw and that a larger system will later execute.

# Blocks you can use
${catalog()}

Common roles (use these names when they fit, otherwise any sensible role): ${ROLES.join(', ')}.

# How to build the graph
- Exactly one "start" block and at least one "end" block. Use separate "end" blocks for different outcomes (completed / rejected / cancelled) when the process can finish in different ways.
- Every output of every block must be connected to exactly one target, using the output ids listed above as sourceHandle. Single-output blocks use "out". Never connect an output twice; use "parallel" + "join" when work genuinely happens at the same time.
- Every block except "start" must have at least one incoming edge. Loops back to an earlier block are fine and expected for rework (e.g. rejected → revise → resubmit, failed inspection → rectify → re-inspect).
- Prefer the construction blocks (approval, inspection, document, assign, notification) over a generic "task" when they fit. Approvals and inspections must handle both outcomes.
- Declare every variable you reference in rules, switches, forms, set-variable or expression blocks, and in {{variable}} placeholders inside text. Collect data with a "form" block (fields store answers in variables) before conditions use it.
- Keep labels short (2–5 words) and specific. Fill in the useful data fields (roles, checklists, document types, SLAs, messages) with realistic construction content.
- Use a "subworkflow" block only for saved workflows listed in the request, with their exact id.
- Edge labels: use the branch name for multi-output blocks ("Approved", "Fail", case labels), otherwise "".
- dataJson must be a JSON object string with only the data keys listed for that block type.
- Keep it as simple as the described process allows; do not invent steps the user would not expect. Note anything you assumed in "assumptions".

# Swimlanes
- When work moves between departments or roles (e.g. Design, Procurement, Commercial, PM / Site, Accounts), list them in "lanes" in a sensible left-to-right order (usually the order work first reaches them) and set every block's "lane". Handoffs between lanes are what the diagram is for, so put each block in the department that does it.
- Use "sections" only for a clearly separate part of the process that runs across departments (e.g. "Changes (VOs)"), and set "section" on its blocks. Otherwise sections is [] and section is "".
- For a process done by one team, lanes is [] and lane is "".

# Updating an existing workflow
When the request includes a current workflow, return the complete updated workflow (not a diff). Keep the ids, labels, lanes and data of blocks that do not need to change, change only what the request asks for, and use new ids for new blocks. Keep the existing lanes and sections unless the request changes them.`;

/** Per-request user message: the description plus saved workflows and (optionally) the current flow. */
export function buildUserMessage(opts: {
  request: string;
  workflows: WorkflowSummary[];
  current?: unknown;
}): string {
  const parts: string[] = [];
  if (opts.workflows.length) {
    parts.push(
      '<saved_workflows>\n' +
        opts.workflows
          .map((w) => `- id "${w.id}": ${w.name}. Outcomes: ${w.outcomes.length ? w.outcomes.map((o) => `"${o.id}" (${o.label})`).join(', ') : 'none'}`)
          .join('\n') +
        '\n</saved_workflows>',
    );
  }
  if (opts.current) {
    parts.push(`<current_workflow>\n${JSON.stringify(opts.current)}\n</current_workflow>`);
    parts.push(`Change the current workflow as follows:\n${opts.request}`);
  } else {
    parts.push(`Create a workflow for this process:\n${opts.request}`);
  }
  return parts.join('\n\n');
}
