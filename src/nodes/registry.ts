import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  Bell,
  CircleStop,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Frame,
  GitBranch,
  GitFork,
  GitMerge,
  ListTodo,
  Play,
  Repeat,
  Sigma,
  Split,
  StickyNote,
  Timer,
  Type,
  UserCheck,
  Variable,
  Workflow,
} from 'lucide-react';
import type { NodeData, RuleGroup } from '../types';

export type Category = 'logic' | 'data' | 'construction' | 'annotation';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'stringList'
  | 'rules'
  | 'cases'
  | 'formFields'
  | 'variable'
  | 'workflowRef'
  | 'color';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /** Autocomplete suggestions for text fields. */
  suggestions?: string[];
  /** Only show this field when the predicate holds. */
  visible?: (data: NodeData) => boolean;
}

export interface Port {
  id: string;
  label: string;
}

export interface NodeDef {
  type: string;
  category: Category;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string; // hex accent
  hasInput: boolean;
  outputs: (data: NodeData) => Port[];
  defaults: () => Omit<NodeData, 'label'>;
  fields: FieldDef[];
  summary?: (data: NodeData) => string | undefined;
}

const OUT: Port[] = [{ id: 'out', label: '' }];
const single = () => OUT;

export const ROLES = [
  'Project Manager',
  'Site Engineer',
  'QA/QC Engineer',
  'Safety Officer',
  'Structural Engineer',
  'Architect',
  'Consultant',
  'Client Representative',
  'Procurement Officer',
  'Foreman',
  'Subcontractor',
  'Quantity Surveyor',
  'Document Controller',
];

const roleField = (key: string, label: string, required = true): FieldDef => ({
  key,
  label,
  kind: 'text',
  required,
  placeholder: 'e.g. QA/QC Engineer',
  suggestions: ROLES,
});

export const ruleSummary = (g?: RuleGroup) => {
  if (!g || !g.rules?.length) return undefined;
  return g.rules
    .map((r) => {
      if (['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(r.op)) return `${r.var || '?'} ${r.op}`;
      if (r.op === 'between' && Array.isArray(r.value)) return `${r.var || '?'} between ${r.value[0]}–${r.value[1]}`;
      return `${r.var || '?'} ${r.op} ${String(r.value ?? '')}`;
    })
    .join(` ${g.logic} `);
};

const DEFS: NodeDef[] = [
  // ───────────── Logic ─────────────
  {
    type: 'start',
    category: 'logic',
    label: 'Start',
    description: 'Entry point of the workflow',
    icon: Play,
    color: '#16a34a',
    hasInput: false,
    outputs: single,
    defaults: () => ({ trigger: 'manual' }),
    fields: [
      {
        key: 'trigger',
        label: 'Trigger',
        kind: 'select',
        options: [
          { value: 'manual', label: 'Manual start' },
          { value: 'form', label: 'Form submitted' },
          { value: 'schedule', label: 'Scheduled' },
          { value: 'event', label: 'System event' },
        ],
      },
      { key: 'event', label: 'Event name', kind: 'text', visible: (d) => d.trigger === 'event' },
      { key: 'schedule', label: 'Schedule', kind: 'text', placeholder: 'e.g. every Monday 08:00', visible: (d) => d.trigger === 'schedule' },
    ],
    summary: (d) => d.trigger,
  },
  {
    type: 'task',
    category: 'logic',
    label: 'Task',
    description: 'A unit of work to be done',
    icon: ListTodo,
    color: '#2563eb',
    hasInput: true,
    outputs: single,
    defaults: () => ({ assigneeRole: '', description: '', durationHours: null }),
    fields: [
      roleField('assigneeRole', 'Assignee role', false),
      { key: 'description', label: 'Description', kind: 'textarea' },
      { key: 'durationHours', label: 'Est. duration (hours)', kind: 'number' },
    ],
    summary: (d) => d.assigneeRole,
  },
  {
    type: 'condition',
    category: 'logic',
    label: 'Condition',
    description: 'If / else branch based on rules',
    icon: GitBranch,
    color: '#d97706',
    hasInput: true,
    outputs: () => [
      { id: 'true', label: 'True' },
      { id: 'false', label: 'False' },
    ],
    defaults: () => ({ condition: { logic: 'AND', rules: [] } as RuleGroup }),
    fields: [{ key: 'condition', label: 'Rules', kind: 'rules', required: true }],
    summary: (d) => ruleSummary(d.condition),
  },
  {
    type: 'switch',
    category: 'logic',
    label: 'Switch',
    description: 'Route by the value of a variable',
    icon: Split,
    color: '#d97706',
    hasInput: true,
    outputs: (d) => [
      ...((d.cases as { id: string; value: string; label?: string }[]) ?? []).map((c) => ({
        id: c.id,
        label: c.label || c.value || '(empty)',
      })),
      ...(d.hasDefault ? [{ id: 'default', label: 'Default' }] : []),
    ],
    defaults: () => ({
      variable: '',
      cases: [
        { id: 'case_1', value: 'A', label: '' },
        { id: 'case_2', value: 'B', label: '' },
      ],
      hasDefault: true,
    }),
    fields: [
      { key: 'variable', label: 'Variable', kind: 'variable', required: true },
      { key: 'cases', label: 'Cases', kind: 'cases' },
      { key: 'hasDefault', label: 'Include default branch', kind: 'checkbox' },
    ],
    summary: (d) => (d.variable ? `on ${d.variable}` : undefined),
  },
  {
    type: 'loop',
    category: 'logic',
    label: 'Loop',
    description: 'Repeat the body branch',
    icon: Repeat,
    color: '#7c3aed',
    hasInput: true,
    outputs: () => [
      { id: 'body', label: 'Each' },
      { id: 'done', label: 'Done' },
    ],
    defaults: () => ({ mode: 'forEach', collection: '', itemVariable: 'item', condition: { logic: 'AND', rules: [] }, maxIterations: 100 }),
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        kind: 'select',
        options: [
          { value: 'forEach', label: 'For each item in list' },
          { value: 'while', label: 'While condition is true' },
          { value: 'count', label: 'Fixed number of times' },
        ],
      },
      { key: 'collection', label: 'List variable', kind: 'variable', required: true, visible: (d) => d.mode === 'forEach' },
      { key: 'itemVariable', label: 'Item name', kind: 'text', visible: (d) => d.mode === 'forEach' },
      { key: 'condition', label: 'While', kind: 'rules', visible: (d) => d.mode === 'while' },
      { key: 'maxIterations', label: 'Max iterations', kind: 'number' },
    ],
    summary: (d) => (d.mode === 'forEach' ? `each ${d.itemVariable || 'item'} in ${d.collection || '?'}` : d.mode === 'while' ? ruleSummary(d.condition) : `${d.maxIterations}×`),
  },
  {
    type: 'parallel',
    category: 'logic',
    label: 'Parallel Split',
    description: 'Run several branches at the same time',
    icon: GitFork,
    color: '#0891b2',
    hasInput: true,
    outputs: (d) =>
      Array.from({ length: Math.max(2, Math.min(8, Number(d.branches) || 2)) }, (_, i) => ({
        id: `branch_${i + 1}`,
        label: `Branch ${i + 1}`,
      })),
    defaults: () => ({ branches: 2 }),
    fields: [{ key: 'branches', label: 'Number of branches (2–8)', kind: 'number' }],
  },
  {
    type: 'join',
    category: 'logic',
    label: 'Join',
    description: 'Wait for parallel branches to finish',
    icon: GitMerge,
    color: '#0891b2',
    hasInput: true,
    outputs: single,
    defaults: () => ({ mode: 'all' }),
    fields: [
      {
        key: 'mode',
        label: 'Continue when',
        kind: 'select',
        options: [
          { value: 'all', label: 'All branches complete' },
          { value: 'any', label: 'Any branch completes' },
        ],
      },
    ],
    summary: (d) => (d.mode === 'all' ? 'wait for all' : 'wait for any'),
  },
  {
    type: 'delay',
    category: 'logic',
    label: 'Delay',
    description: 'Wait for a period of time',
    icon: Timer,
    color: '#64748b',
    hasInput: true,
    outputs: single,
    defaults: () => ({ amount: 1, unit: 'days' }),
    fields: [
      { key: 'amount', label: 'Amount', kind: 'number', required: true },
      {
        key: 'unit',
        label: 'Unit',
        kind: 'select',
        options: ['minutes', 'hours', 'days', 'weeks'].map((v) => ({ value: v, label: v })),
      },
    ],
    summary: (d) => `${d.amount} ${d.unit}`,
  },
  {
    type: 'end',
    category: 'logic',
    label: 'End',
    description: 'Workflow finishes here',
    icon: CircleStop,
    color: '#dc2626',
    hasInput: true,
    outputs: () => [],
    defaults: () => ({ status: 'completed' }),
    fields: [
      {
        key: 'status',
        label: 'Outcome',
        kind: 'select',
        options: [
          { value: 'completed', label: 'Completed' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
      },
    ],
    summary: (d) => d.status,
  },

  // ───────────── Data ─────────────
  {
    type: 'setVariable',
    category: 'data',
    label: 'Set Variable',
    description: 'Assign a value to a variable',
    icon: Variable,
    color: '#0d9488',
    hasInput: true,
    outputs: single,
    defaults: () => ({ variable: '', value: '' }),
    fields: [
      { key: 'variable', label: 'Variable', kind: 'variable', required: true },
      { key: 'value', label: 'Value', kind: 'text', placeholder: 'Literal value or {{otherVariable}}' },
    ],
    summary: (d) => (d.variable ? `${d.variable} = ${d.value}` : undefined),
  },
  {
    type: 'form',
    category: 'data',
    label: 'Input Form',
    description: 'Collect data from a person',
    icon: ClipboardList,
    color: '#0d9488',
    hasInput: true,
    outputs: single,
    defaults: () => ({ assigneeRole: '', fields: [{ name: 'notes', label: 'Notes', type: 'string', required: false, variable: '' }] }),
    fields: [
      roleField('assigneeRole', 'Filled in by', false),
      { key: 'fields', label: 'Form fields', kind: 'formFields' },
    ],
    summary: (d) => `${(d.fields ?? []).length} field(s)`,
  },
  {
    type: 'expression',
    category: 'data',
    label: 'Expression',
    description: 'Calculate a value into a variable',
    icon: Sigma,
    color: '#0d9488',
    hasInput: true,
    outputs: single,
    defaults: () => ({ variable: '', expression: '' }),
    fields: [
      { key: 'variable', label: 'Store result in', kind: 'variable', required: true },
      { key: 'expression', label: 'Expression', kind: 'textarea', required: true, placeholder: 'e.g. {{volume}} * {{unitRate}}', help: 'Reference variables as {{name}}' },
    ],
    summary: (d) => (d.variable ? `${d.variable} = ${d.expression}` : undefined),
  },

  // ───────────── Construction ─────────────
  {
    type: 'approval',
    category: 'construction',
    label: 'Approval',
    description: 'A role approves or rejects',
    icon: BadgeCheck,
    color: '#059669',
    hasInput: true,
    outputs: () => [
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ],
    defaults: () => ({ role: '', slaHours: 24, instructions: '', requireComment: false }),
    fields: [
      roleField('role', 'Approver role'),
      { key: 'slaHours', label: 'SLA (hours)', kind: 'number' },
      { key: 'instructions', label: 'Instructions', kind: 'textarea' },
      { key: 'requireComment', label: 'Comment required on reject', kind: 'checkbox' },
    ],
    summary: (d) => d.role,
  },
  {
    type: 'inspection',
    category: 'construction',
    label: 'Inspection',
    description: 'Checklist inspection with pass / fail',
    icon: ClipboardCheck,
    color: '#ea580c',
    hasInput: true,
    outputs: () => [
      { id: 'pass', label: 'Pass' },
      { id: 'fail', label: 'Fail' },
    ],
    defaults: () => ({ assigneeRole: '', checklist: [], photosRequired: false }),
    fields: [
      roleField('assigneeRole', 'Inspector role'),
      { key: 'checklist', label: 'Checklist items', kind: 'stringList', placeholder: 'Add item…' },
      { key: 'photosRequired', label: 'Photos required', kind: 'checkbox' },
    ],
    summary: (d) => [d.assigneeRole, d.checklist?.length ? `${d.checklist.length} checks` : ''].filter(Boolean).join(' · '),
  },
  {
    type: 'document',
    category: 'construction',
    label: 'Document',
    description: 'Submit or review a document',
    icon: FileText,
    color: '#4f46e5',
    hasInput: true,
    outputs: single,
    defaults: () => ({ docType: '', action: 'upload', required: true, description: '' }),
    fields: [
      {
        key: 'docType',
        label: 'Document type',
        kind: 'text',
        required: true,
        placeholder: 'e.g. Method Statement, RFI, Shop Drawing, NCR',
      },
      {
        key: 'action',
        label: 'Action',
        kind: 'select',
        options: [
          { value: 'upload', label: 'Upload' },
          { value: 'review', label: 'Review' },
          { value: 'generate', label: 'Generate' },
          { value: 'sign', label: 'Sign' },
        ],
      },
      { key: 'required', label: 'Mandatory', kind: 'checkbox' },
      { key: 'description', label: 'Notes', kind: 'textarea' },
    ],
    summary: (d) => (d.docType ? `${d.action} · ${d.docType}` : undefined),
  },
  {
    type: 'assign',
    category: 'construction',
    label: 'Assign to Role',
    description: 'Hand work over to a role / department',
    icon: UserCheck,
    color: '#9333ea',
    hasInput: true,
    outputs: single,
    defaults: () => ({ role: '', department: '', task: '', dueInDays: null }),
    fields: [
      roleField('role', 'Role'),
      { key: 'department', label: 'Department', kind: 'text', placeholder: 'e.g. MEP, Civil, HSE' },
      { key: 'task', label: 'Task', kind: 'textarea' },
      { key: 'dueInDays', label: 'Due in (days)', kind: 'number' },
    ],
    summary: (d) => [d.role, d.department].filter(Boolean).join(' · '),
  },
  {
    type: 'notification',
    category: 'construction',
    label: 'Notification',
    description: 'Notify a role',
    icon: Bell,
    color: '#db2777',
    hasInput: true,
    outputs: single,
    defaults: () => ({ recipientRole: '', channel: 'email', message: '' }),
    fields: [
      roleField('recipientRole', 'Recipient role'),
      {
        key: 'channel',
        label: 'Channel',
        kind: 'select',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'inApp', label: 'In-app' },
          { value: 'whatsapp', label: 'WhatsApp' },
        ],
      },
      { key: 'message', label: 'Message', kind: 'textarea', placeholder: 'Use {{variable}} to insert values' },
    ],
    summary: (d) => [d.channel, d.recipientRole].filter(Boolean).join(' → '),
  },
  {
    type: 'subworkflow',
    category: 'construction',
    label: 'Linked Workflow',
    description: 'Connect to another saved workflow',
    icon: Workflow,
    color: '#475569',
    hasInput: true,
    // "call": run it, then continue on one output per End block of the linked flow.
    // "handoff": continue in the linked flow; this flow stops here.
    outputs: (d) => {
      if (d.mode === 'handoff') return [];
      const outcomes = (d.outcomes as Port[] | undefined) ?? [];
      return outcomes.length ? outcomes.map((o) => ({ id: o.id, label: o.label })) : OUT;
    },
    defaults: () => ({ workflowId: '', workflowName: '', mode: 'call', outcomes: [] }),
    fields: [
      { key: 'workflowId', label: 'Workflow', kind: 'workflowRef', required: true },
      {
        key: 'mode',
        label: 'How to connect',
        kind: 'select',
        options: [
          { value: 'call', label: 'Run it, then continue here by its outcome' },
          { value: 'handoff', label: 'Hand off (continue in that workflow)' },
        ],
        help: 'Run: one output appears per End block of the linked workflow.',
      },
    ],
    summary: (d) => (d.workflowName ? `${d.mode === 'handoff' ? '→ hand off to' : '↻ runs'} ${d.workflowName}` : undefined),
  },

  // ───────────── Annotation ─────────────
  {
    type: 'sticky',
    category: 'annotation',
    label: 'Sticky Note',
    description: 'Free-form note',
    icon: StickyNote,
    color: '#eab308',
    hasInput: false,
    outputs: () => [],
    defaults: () => ({ text: '', color: 'yellow' }),
    fields: [
      { key: 'text', label: 'Text', kind: 'textarea' },
      { key: 'color', label: 'Colour', kind: 'color' },
    ],
  },
  {
    type: 'frame',
    category: 'annotation',
    label: 'Group Frame',
    description: 'Group blocks together',
    icon: Frame,
    color: '#64748b',
    hasInput: false,
    outputs: () => [],
    defaults: () => ({ color: 'slate' }),
    fields: [{ key: 'color', label: 'Colour', kind: 'color' }],
  },
  {
    type: 'text',
    category: 'annotation',
    label: 'Text Label',
    description: 'Heading or label on the canvas',
    icon: Type,
    color: '#334155',
    hasInput: false,
    outputs: () => [],
    defaults: () => ({ fontSize: 24 }),
    fields: [{ key: 'fontSize', label: 'Font size', kind: 'number' }],
  },
];

export const REGISTRY: Record<string, NodeDef> = Object.fromEntries(DEFS.map((d) => [d.type, d]));
export const NODE_DEFS = DEFS;

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'logic', label: 'Logic' },
  { id: 'data', label: 'Data' },
  { id: 'construction', label: 'Construction' },
  { id: 'annotation', label: 'Notes & Frames' },
];

export const isAnnotation = (type?: string) => !!type && REGISTRY[type]?.category === 'annotation';

export const getDef = (type?: string): NodeDef | undefined => (type ? REGISTRY[type] : undefined);

export const NOTE_COLORS: Record<string, { bg: string; border: string; swatch: string }> = {
  yellow: { bg: '#fef9c3', border: '#facc15', swatch: '#facc15' },
  green: { bg: '#dcfce7', border: '#4ade80', swatch: '#4ade80' },
  blue: { bg: '#dbeafe', border: '#60a5fa', swatch: '#60a5fa' },
  pink: { bg: '#fce7f3', border: '#f472b6', swatch: '#f472b6' },
  orange: { bg: '#ffedd5', border: '#fb923c', swatch: '#fb923c' },
  slate: { bg: '#f1f5f9', border: '#94a3b8', swatch: '#94a3b8' },
};
