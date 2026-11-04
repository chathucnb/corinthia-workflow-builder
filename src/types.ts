import type { Edge, Node } from '@xyflow/react';

export type NodeData = { label: string; [key: string]: any };
export type FlowNode = Node<NodeData>;
export type FlowEdge = Edge<{ [key: string]: unknown }>;

export type VariableType = 'string' | 'number' | 'boolean' | 'date' | 'list' | 'file';

export interface Variable {
  name: string;
  type: VariableType;
  /** A list variable may default to an array of values. */
  default: string | number | boolean | null | (string | number | boolean)[];
  description?: string;
}

/** Internal document saved to IndexedDB (React Flow shape). */
export interface WorkflowDoc {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  variables: Variable[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  nodeCount: number;
  /** Outcomes (End blocks) a caller can branch on. */
  outcomes: { id: string; label: string }[];
  /** Workflow ids this one links to. */
  refs: string[];
}

export type RuleOp =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'between'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isTrue'
  | 'isFalse';

export interface Rule {
  var: string;
  op: RuleOp;
  value?: unknown;
}

export interface RuleGroup {
  logic: 'AND' | 'OR';
  rules: Rule[];
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

export const uid = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

export const nowIso = () => new Date().toISOString();
