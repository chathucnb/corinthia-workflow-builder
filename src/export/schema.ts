import { z } from 'zod';

/** Public, versioned export format consumed by the large system. */
export const SCHEMA_VERSION = '1.0';

const position = z.object({ x: z.number(), y: z.number() });

export const variableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'list', 'file']),
  default: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]).default(null),
  description: z.string().optional(),
});

export const exportNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: z.enum(['logic', 'data', 'construction']),
  label: z.string(),
  data: z.record(z.any()),
  outputs: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Swimlane (department) the block sits in, if any. */
  lane: z.string().optional(),
  /** Section band the block sits in, if any. */
  section: z.string().optional(),
});

const namedArea = z.object({ id: z.string(), name: z.string(), color: z.string().optional() });

export const exportEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  label: z.string().default(''),
});

export const annotationSchema = z.object({
  id: z.string(),
  type: z.enum(['sticky', 'frame', 'text', 'lane', 'band']),
  label: z.string().default(''),
  data: z.record(z.any()),
  position,
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  parentId: z.string().optional(),
});

export const layoutEntrySchema = position.extend({ parentId: z.string().optional() });

export const workflowExportSchema = z.object({
  // Any 1.x file is readable; 1 / "1" are accepted as "1.0".
  schemaVersion: z.preprocess(
    (v) => (v === 1 || v === '1' ? '1.0' : v),
    z.string().regex(/^1\.\d+$/, 'must be "1.0" (this tool reads format version 1)'),
  ),
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  version: z.number().int().nonnegative(),
  createdAt: z.string().optional(),
  updatedAt: z.string(),
  variables: z.array(variableSchema),
  nodes: z.array(exportNodeSchema),
  edges: z.array(exportEdgeSchema),
  /** Swimlanes, left to right (derived from the "lane" annotations). */
  lanes: z.array(namedArea).default([]),
  /** Section bands, top to bottom (derived from the "band" annotations). */
  sections: z.array(namedArea).default([]),
  /** Connections that hand work from one lane to another (derived). */
  handoffs: z.array(z.object({ edge: z.string(), from: z.string(), to: z.string() })).default([]),
  /** Canvas direction (canvas-only). */
  direction: z.enum(['LR', 'TB']).optional(),
  /** Other workflows this one links to (via Linked Workflow blocks). */
  dependencies: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  annotations: z.array(annotationSchema).default([]),
  layout: z.record(layoutEntrySchema).default({}),
});

export const bundleSchema = z.object({
  kind: z.literal('corinthia-workflow-bundle'),
  exportedAt: z.string(),
  workflows: z.array(workflowExportSchema),
});

export type WorkflowExport = z.infer<typeof workflowExportSchema>;
export type WorkflowBundle = z.infer<typeof bundleSchema>;
