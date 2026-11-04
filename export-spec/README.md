# Corinthia Workflow JSON: integration package (schemaVersion 1.0)

Workflows designed in the **Corinthia Workflow Builder** export as JSON files in this format. This package describes the format so the main system can import and run them.

## Files

| File | What it is |
|---|---|
| `workflow.schema.json` | JSON Schema (draft 2020-12) for **one workflow** file. Validate uploads against it. |
| `bundle.schema.json` | JSON Schema for a **bundle** (several workflows in one file: backups, or a workflow plus everything it links to). References `workflow.schema.json`. |
| `block-types.json` | Machine-readable list of every block type: outputs, data fields, defaults. |
| `examples/concrete-pour-approval.json` | A real single-workflow export (approvals, inspection, condition, loops back for rework). |
| `examples/slab-cycle-with-linked.bundle.json` | A real bundle: a parent workflow (parallel work, switch, approval, **linked workflow**) plus the workflow it links to. |
| `examples/package-procurement-swimlanes.json` | A **swimlane** workflow: five departments (lanes), a "Changes (VOs)" section, and the handoffs between departments. |

## How to tell the two file kinds apart

- Has `"kind": "corinthia-workflow-bundle"` → **bundle**, with a `workflows` array.
- Has `"schemaVersion": "1.0"` at the top level → **single workflow**.

## Workflow structure

```jsonc
{
  "schemaVersion": "1.0",       // reject files with a different major version
  "id": "wf_1a2b3c4d5e",          // stable id, use it as the key when upserting
  "name": "Concrete Pour Approval",
  "description": "",
  "version": 3,                   // +1 every time the designer saves the file
  "createdAt": "ISO-8601", "updatedAt": "ISO-8601",

  "variables": [ { "name": "pourVolume", "type": "number", "default": null, "description": "m³" } ],

  "nodes": [ {
    "id": "n6", "type": "condition", "category": "logic", "label": "Large pour?",
    "data": { "condition": { "logic": "AND", "rules": [ { "var": "pourVolume", "op": ">", "value": 50 } ] } },
    "outputs": [ { "id": "true", "label": "True" }, { "id": "false", "label": "False" } ]
  } ],

  "edges": [ { "id": "e10", "source": "n6", "sourceHandle": "true", "target": "n7", "label": "True" } ],

  "lanes":    [ { "id": "lane_design", "name": "Design", "color": "slate" } ],      // departments, left → right
  "sections": [ { "id": "band_changes_vos", "name": "Changes (VOs)" } ],           // optional rows across lanes
  "handoffs": [ { "edge": "e2", "from": "lane_design", "to": "lane_commercial" } ], // edges crossing lanes
  // each node may also carry  "lane": "<lane id>"  and  "section": "<section id>"

  "dependencies": [ { "id": "wf_…", "name": "…" } ],   // workflows linked via "subworkflow" nodes

  "annotations": [ … ],           // canvas-only: sticky notes, frames, text (ignore when executing)
  "layout": { "n6": { "x": 1540, "y": 200 } }          // canvas-only positions (ignore when executing)
}
```

**Only `variables`, `nodes`, `edges` and `dependencies` matter for execution.** `lanes`, `sections`, `handoffs` and `node.lane` / `node.section` say **which department owns each step** and where work changes hands. Use them for routing tasks, dashboards and responsibility reports. Keep `annotations` and `layout` if you want to send the file back to the designer unchanged; the builder's **Import** accepts the same format.

### Graph rules (a workflow that passes the builder's validation)

- Exactly one `start` node; at least one `end` node.
- Each edge leaves a node through one of its `outputs[].id` (`edge.sourceHandle`) and enters the target node. Every output has **exactly one** edge, so routing is never ambiguous.
- Cycles are allowed and expected (rework loops: rejected → revise → resubmit).
- Variables referenced by rules, switches, forms and `{{variable}}` placeholders are declared in `variables`.

The designer can still save files that fail validation (work in progress). Check for these rules on import if you need them.

## Running a workflow

```text
vars  = { v.name: v.default for v in variables }
next  = map (edge.source, edge.sourceHandle) → edge.target
node  = the start node
loop:
  port = execute(node, vars)            // returns one of node.outputs[].id
  if node.type == "end": finish with node.data.status ("completed" | "rejected" | "cancelled")
  node = nodes[ next[(node.id, port)] ]
```

What each block does and which output it takes:

| type | category | meaning | outputs | data fields (* = required) |
|---|---|---|---|---|
| `start` | logic | Entry point of the workflow | "out" | `trigger` (`manual` / `form` / `schedule` / `event`), `event`, `schedule` |
| `task` | logic | A unit of work to be done | "out" | `assigneeRole`, `description`, `durationHours` |
| `condition` | logic | If / else branch based on rules | "true", "false" | `condition`* |
| `switch` | logic | Route by the value of a variable | One output per case (id = case id), plus "default" when hasDefault is true. | `variable`*, `cases`, `hasDefault` |
| `loop` | logic | Repeat the body branch | "body", "done" | `mode` (`forEach` / `while` / `count`), `collection`*, `itemVariable`, `condition`, `maxIterations` |
| `parallel` | logic | Run several branches at the same time | "branch_1" … "branch_N" where N = branches. | `branches` |
| `join` | logic | Wait for parallel branches to finish | "out" | `mode` (`all` / `any`) |
| `delay` | logic | Wait for a period of time | "out" | `amount`*, `unit` (`minutes` / `hours` / `days` / `weeks`) |
| `end` | logic | Workflow finishes here | None (terminal block). | `status` (`completed` / `rejected` / `cancelled`) |
| `setVariable` | data | Assign a value to a variable | "out" | `variable`*, `value` |
| `form` | data | Collect data from a person | "out" | `assigneeRole`, `fields` |
| `expression` | data | Calculate a value into a variable | "out" | `variable`*, `expression`* |
| `approval` | construction | A role approves or rejects | "approved", "rejected" | `role`*, `slaHours`, `instructions`, `requireComment` |
| `inspection` | construction | Checklist inspection with pass / fail | "pass", "fail" | `assigneeRole`*, `checklist`, `photosRequired` |
| `document` | construction | Submit or review a document | "out" | `docType`*, `action` (`upload` / `review` / `generate` / `sign`), `required`, `description` |
| `assign` | construction | Hand work over to a role / department | "out" | `role`*, `department`, `task`, `dueInDays` |
| `notification` | construction | Notify a role | "out" | `recipientRole`*, `channel` (`email` / `sms` / `inApp` / `whatsapp`), `message` |
| `subworkflow` | construction | Connect to another saved workflow | mode "call": one output per outcome (id = End block id in the linked workflow), or "out" if it has none. mode "handoff": none. | `workflowId`*, `mode` (`call` / `handoff`) |

Notes on the logic blocks:

- **Rules** (`condition`, `loop` while): `{"logic":"AND"|"OR","rules":[{"var","op","value"}]}`. Operators: `== != > >= < <= contains between isEmpty isNotEmpty isTrue isFalse`. `between` takes `[min, max]` (inclusive). The no-value operators have no `value`. Values are typed (numbers as numbers).
- **switch**: compare `vars[data.variable]` with each `cases[].value` and leave through the matching case's `id`. Otherwise use `"default"` (present only when `hasDefault` is true).
- **parallel / join**: `parallel` starts all `branch_N` outputs at once. `join` continues once **all** incoming branches arrive (`mode: "all"`) or the first one does (`"any"`).
- **loop**: leave through `body` for each iteration. The body path connects back to the loop node. When finished, leave through `done`. `forEach` iterates the list variable `collection`, exposing each item as `itemVariable`. `count` runs `maxIterations` times. `while` repeats while `condition` holds (capped by `maxIterations`).
- **form**: show `fields` to `assigneeRole`, then store each answer in its `variable` (if set).
- **setVariable / expression**: assign `value` / evaluate `expression` into `variable`. `{{name}}` placeholders are replaced with variable values.
- **Text placeholders**: any text field (messages, instructions) may contain `{{variableName}}`.

Linked workflows (`subworkflow`):

- `data.workflowId` is the `id` of another workflow, also listed in `dependencies`. Bundles from **JSON → With N linked** contain all of them.
- `mode: "call"`: run the linked workflow to its end. Then continue through the output whose `id` equals the **id of the `end` node the linked workflow finished on** (listed in `data.outcomes`). If the linked workflow has no `end` node the output is `"out"`.
- `mode: "handoff"`: start the linked workflow; this workflow stops here (no outputs).
- Variables are not shared automatically between workflows.

## Validating an upload

Validate with any JSON Schema 2020-12 validator, e.g. Node + Ajv:

```js
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import workflowSchema from "./workflow.schema.json" with { type: "json" };
import bundleSchema from "./bundle.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(workflowSchema, "workflow.schema.json");
const isBundle = (f) => f.kind === "corinthia-workflow-bundle";
const check = (file) => (isBundle(file) ? ajv.compile(bundleSchema) : ajv.getSchema("workflow.schema.json"))(file);
```

Python: `jsonschema.Draft202012Validator(schema).validate(data)`. For bundles, register `workflow.schema.json` in a referencing registry under that name.

## Compatibility promise

- `schemaVersion` stays `"1.0"` while changes are backwards compatible (new optional fields, new block types). Ignore fields and `data` keys you don't know.
- A breaking change bumps it to `"2.0"`.
- New block types appear in `block-types.json`. Treat an unknown `type` as unsupported rather than guessing.
