import { NODE_DEFS, type FieldDef, type NodeDef } from '../nodes/registry';
import { SCHEMA_VERSION } from './schema';

/**
 * Builds the published JSON Schema (draft 2020-12) for the export format
 * straight from the block registry, so the spec always matches the tool.
 */

const BASE = 'https://corinthia.local/schemas/workflow';
const FLOW = NODE_DEFS.filter((d) => d.category !== 'annotation');
const VAR_TYPES = ['string', 'number', 'boolean', 'date', 'list', 'file'];
const OPS = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'between', 'isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'];

const fieldSchema = (f: FieldDef): Record<string, unknown> => {
  const d = { description: f.label + (f.required ? ' (required for a valid workflow)' : '') + (f.help ? `. ${f.help}` : '') };
  switch (f.kind) {
    case 'text':
    case 'textarea':
    case 'color':
      return { type: 'string', ...d };
    case 'number':
      return { type: ['number', 'null'], ...d };
    case 'checkbox':
      return { type: 'boolean', ...d };
    case 'select':
      return { enum: f.options!.map((o) => o.value), ...d };
    case 'stringList':
      return { type: 'array', items: { type: 'string' }, ...d };
    case 'variable':
      return { type: 'string', ...d, description: `${d.description}. Name of a declared variable, or "" if not set.` };
    case 'workflowRef':
      return { type: 'string', ...d, description: `${d.description}. Id of another workflow (see "dependencies").` };
    case 'rules':
      return { $ref: '#/$defs/ruleGroup', ...d };
    case 'cases':
      return { type: 'array', items: { $ref: '#/$defs/switchCase' }, ...d };
    case 'formFields':
      return { type: 'array', items: { $ref: '#/$defs/formField' }, ...d };
  }
};

const outputsDoc = (def: NodeDef) => {
  switch (def.type) {
    case 'switch':
      return 'One output per case (id = case id), plus "default" when hasDefault is true.';
    case 'parallel':
      return '"branch_1" … "branch_N" where N = branches.';
    case 'subworkflow':
      return 'mode "call": one output per outcome (id = End block id in the linked workflow), or "out" if it has none. mode "handoff": none.';
    default: {
      const p = def.outputs({ label: '', ...def.defaults() });
      return p.length ? p.map((x) => `"${x.id}"`).join(', ') : 'None (terminal block).';
    }
  }
};

const dataSchema = (def: NodeDef) => {
  const properties: Record<string, unknown> = Object.fromEntries(def.fields.map((f) => [f.key, fieldSchema(f)]));
  if (def.type === 'setVariable') {
    properties.value = {
      description: 'Value to assign: a typed value (number, true/false, list) or text, which may contain {{variable}} placeholders',
      anyOf: [{ type: ['string', 'number', 'boolean', 'null'] }, { type: 'array' }],
    };
  }
  if (def.type === 'subworkflow') {
    properties.workflowName = { type: 'string', description: 'Name of the linked workflow when it was linked' };
    properties.outcomes = { type: 'array', items: { $ref: '#/$defs/port' }, description: 'Outcomes of the linked workflow (its End blocks)' };
  }
  return { type: 'object', properties, additionalProperties: true };
};

export function workflowJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${BASE}/${SCHEMA_VERSION}/workflow.schema.json`,
    title: 'Corinthia Workflow',
    description:
      'One workflow exported by the Corinthia Workflow Builder. Execution logic is in variables, nodes and edges. annotations and layout are canvas-only and can be ignored by an execution engine.',
    type: 'object',
    required: ['schemaVersion', 'id', 'name', 'version', 'updatedAt', 'variables', 'nodes', 'edges'],
    additionalProperties: false,
    properties: {
      schemaVersion: { const: SCHEMA_VERSION, description: 'Format version. Breaking changes bump the major number.' },
      id: { type: 'string', description: 'Stable workflow id (e.g. "wf_1a2b3c4d5e"). Use it as the key in the target system.' },
      name: { type: 'string' },
      description: { type: 'string', default: '' },
      version: { type: 'integer', minimum: 0, description: 'Increases by 1 every time the workflow is saved to a file.' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      variables: { type: 'array', items: { $ref: '#/$defs/variable' } },
      nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
      edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
      lanes: {
        type: 'array',
        default: [],
        description: 'Swimlanes (departments / roles), left to right. Each node.lane refers to one of these ids.',
        items: { $ref: '#/$defs/area' },
      },
      sections: {
        type: 'array',
        default: [],
        description: 'Section bands across all lanes (e.g. "Changes"), top to bottom. node.section refers to one of these ids.',
        items: { $ref: '#/$defs/area' },
      },
      handoffs: {
        type: 'array',
        default: [],
        description: 'Edges where work moves from one lane to another (derived from node lanes, for convenience).',
        items: {
          type: 'object',
          required: ['edge', 'from', 'to'],
          additionalProperties: false,
          properties: { edge: { type: 'string', description: 'Edge id' }, from: { type: 'string', description: 'Lane id' }, to: { type: 'string', description: 'Lane id' } },
        },
      },
      direction: { enum: ['LR', 'TB'], description: 'Canvas direction (canvas-only).' },
      dependencies: {
        type: 'array',
        default: [],
        description: 'Other workflows this one links to through "subworkflow" nodes.',
        items: { type: 'object', required: ['id', 'name'], additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' } } },
      },
      annotations: { type: 'array', default: [], items: { $ref: '#/$defs/annotation' }, description: 'Canvas-only notes, frames and labels.' },
      layout: {
        type: 'object',
        default: {},
        description: 'Canvas position per node id (canvas-only).',
        additionalProperties: { $ref: '#/$defs/layoutEntry' },
      },
    },
    $defs: {
      variable: {
        type: 'object',
        required: ['name', 'type'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          type: { enum: VAR_TYPES },
          default: {
            default: null,
            description: 'Initial value. A "list" variable may default to an array.',
            anyOf: [{ type: ['string', 'number', 'boolean', 'null'] }, { type: 'array', items: { type: ['string', 'number', 'boolean'] } }],
          },
          description: { type: 'string' },
        },
      },
      area: {
        type: 'object',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } },
      },
      port: {
        type: 'object',
        required: ['id', 'label'],
        additionalProperties: false,
        properties: { id: { type: 'string' }, label: { type: 'string' } },
      },
      node: {
        type: 'object',
        required: ['id', 'type', 'category', 'label', 'data', 'outputs'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { enum: FLOW.map((d) => d.type) },
          category: { enum: ['logic', 'data', 'construction'] },
          label: { type: 'string' },
          data: { type: 'object' },
          lane: { type: 'string', description: 'Id of the swimlane (department) the block sits in; absent if none' },
          section: { type: 'string', description: 'Id of the section band the block sits in; absent if none' },
          outputs: {
            type: 'array',
            items: { $ref: '#/$defs/port' },
            description: 'The node\'s output ports. Edges leave a node through one of these ids (edge.sourceHandle).',
          },
        },
        allOf: FLOW.map((def) => ({
          if: { properties: { type: { const: def.type } }, required: ['type'] },
          then: { properties: { category: { const: def.category }, data: { $ref: `#/$defs/data_${def.type}` } } },
        })),
      },
      ...Object.fromEntries(
        FLOW.map((def) => [
          `data_${def.type}`,
          { title: `${def.label} data`, description: `${def.description}. Outputs: ${outputsDoc(def)}`, ...dataSchema(def) },
        ]),
      ),
      edge: {
        type: 'object',
        required: ['id', 'source', 'sourceHandle', 'target'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          source: { type: 'string', description: 'Source node id' },
          sourceHandle: { type: 'string', description: 'Output port id on the source node (one of its outputs[].id)' },
          target: { type: 'string', description: 'Target node id' },
          label: { type: 'string', default: '' },
        },
      },
      ruleGroup: {
        type: 'object',
        required: ['logic', 'rules'],
        additionalProperties: false,
        properties: {
          logic: { enum: ['AND', 'OR'] },
          rules: { type: 'array', items: { $ref: '#/$defs/rule' } },
        },
      },
      rule: {
        type: 'object',
        required: ['var', 'op'],
        additionalProperties: false,
        description: '"between" takes value [min, max]; isEmpty/isNotEmpty/isTrue/isFalse take no value.',
        properties: {
          var: { type: 'string', description: 'Variable name' },
          op: { enum: OPS },
          value: {},
        },
      },
      switchCase: {
        type: 'object',
        required: ['id', 'value'],
        additionalProperties: false,
        properties: { id: { type: 'string', description: 'Also the output port id' }, value: { type: 'string' }, label: { type: 'string' } },
      },
      formField: {
        type: 'object',
        required: ['name', 'type'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          type: { enum: VAR_TYPES },
          required: { type: 'boolean' },
          variable: { type: 'string', description: 'Variable that receives the answer ("" = none)' },
        },
      },
      annotation: {
        type: 'object',
        required: ['id', 'type', 'data', 'position'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { enum: ['sticky', 'frame', 'text', 'lane', 'band'] },
          label: { type: 'string' },
          data: { type: 'object' },
          position: { $ref: '#/$defs/xy' },
          size: {
            type: 'object',
            required: ['width', 'height'],
            additionalProperties: false,
            properties: { width: { type: 'number' }, height: { type: 'number' } },
          },
          parentId: { type: 'string' },
        },
      },
      xy: {
        type: 'object',
        required: ['x', 'y'],
        additionalProperties: false,
        properties: { x: { type: 'number' }, y: { type: 'number' } },
      },
      layoutEntry: {
        type: 'object',
        required: ['x', 'y'],
        additionalProperties: false,
        properties: { x: { type: 'number' }, y: { type: 'number' }, parentId: { type: 'string', description: 'Frame the node sits in; x/y are then relative to it' } },
      },
    },
  };
}

export function bundleJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${BASE}/${SCHEMA_VERSION}/bundle.schema.json`,
    title: 'Corinthia Workflow Bundle',
    description: 'Several workflows in one file: "Backup all" from the home screen, or "With N linked" from the JSON panel.',
    type: 'object',
    required: ['kind', 'exportedAt', 'workflows'],
    additionalProperties: false,
    properties: {
      kind: { const: 'corinthia-workflow-bundle' },
      exportedAt: { type: 'string', format: 'date-time' },
      workflows: { type: 'array', items: { $ref: 'workflow.schema.json' } },
    },
  };
}

/** Machine-readable catalog of block types, for building an execution engine. */
export function blockCatalog() {
  return {
    schemaVersion: SCHEMA_VERSION,
    blocks: FLOW.map((def) => ({
      type: def.type,
      category: def.category,
      label: def.label,
      description: def.description,
      hasInput: def.hasInput,
      outputs: outputsDoc(def),
      defaultOutputs: def.type === 'subworkflow' ? [] : def.outputs({ label: '', ...def.defaults() }),
      defaults: def.defaults(),
      fields: def.fields.map((f) => ({
        key: f.key,
        label: f.label,
        kind: f.kind,
        required: !!f.required,
        ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
      })),
    })),
  };
}
