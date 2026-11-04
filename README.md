# Corinthia Workflow Builder

A visual, drag-and-drop editor (FigJam / n8n style) for designing construction processes. Each workflow exports as versioned JSON for the main system.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (typecheck + production build into `dist/`), `npm test` (export/import and validation tests).

## Where data is saved

Everything stays on this computer. Nothing is sent anywhere.

| What | Where |
|---|---|
| Autosave (every change) | Browser IndexedDB (`corinthia-workflows`). Kept across restarts, per browser profile. |
| **Save file** (Ctrl+S) | A `.json` file on disk. In Chrome/Edge later saves overwrite the same file; Shift+Ctrl+S = Save As. |
| **Backup all** (home screen) | One bundle file with every workflow. Restore it with **Import JSON**. |

Clearing the browser's site data deletes the autosaves, so keep **Backup all** or the saved files somewhere safe.

## Using the editor

- **Add blocks**: drag them from the left palette, or double-click a palette item.
- **Connect**: drag from an output dot (right side of a block) to the input dot (left side) of another block. Each output has one connection. Use **Parallel Split** to fan out.
- **Edit**: select a block to edit it in the right panel. Click empty canvas to edit workflow settings and **variables**.
- **Conditions**: build rules visually (`variable / operator / value`, combined with AND/OR). They use the declared variables.
- **Notes & frames**: double-click a sticky note, text label or frame title to edit it inline. Blocks dropped inside a frame move with it.
- **Shortcuts**: Ctrl+Z / Ctrl+Y undo/redo, Ctrl+C / Ctrl+V copy/paste, Ctrl+D duplicate, Ctrl+A select all, Delete remove, Shift+drag box-select, scroll to pan, Ctrl+scroll to zoom.
- **Arrange** auto-lays out the flow. **Valid / N errors** opens the validation list. Click an issue to jump to its block.

## Creating flows from a prompt (AI)

Describe a process in plain words and Claude (`claude-opus-5-5`) draws it as a workflow.

- **Home → New from description**: creates a new workflow. Any assumptions Claude made appear on an orange sticky note to review.
- **Editor → Prompt**: changes the open workflow ("add a safety briefing before the pour", "if inspection fails twice escalate to the PM"). Blocks that don't change keep their place. **Ctrl+Z** undoes the whole change.
- Claude knows every block type, your declared variables and your saved workflows, so it can add Linked Workflow blocks.
- The result is validated. If anything is wrong, Claude gets one automatic chance to fix it, then remaining problems show in the Validation panel.

**Setup:** click the key icon in the prompt dialog and paste an Anthropic API key (from console.anthropic.com). The key is stored only in this browser's local storage.

**What leaves the computer:** only when you press Generate/Update, the description, the current workflow (when updating) and the names/outcomes of your saved workflows are sent to Anthropic's API. Saving still happens only on this computer.

Code: [src/ai/prompt.ts](src/ai/prompt.ts) builds the instructions from the block registry (new block types are picked up automatically), [src/ai/generate.ts](src/ai/generate.ts) calls the API, and [src/ai/apply.ts](src/ai/apply.ts) turns the answer into canvas blocks.

## Connecting workflows

Saved workflows appear under **Your workflows** at the bottom of the left panel.

- **Link**: drag one onto the canvas (or double-click it) to add a **Linked Workflow** block.
  - *Run it, then continue here*: the block gets one output per End block of the linked workflow (for example "Completed" / "Rejected"), so you can branch on how it finished.
  - *Hand off*: the process continues in the linked workflow and this one stops there.
  - Double-click the block (or use **Open** in the right panel) to jump into the linked workflow. Use the browser's Back button to return.
  - If the linked workflow's End blocks change, the outputs update the next time you open this workflow.
- **Insert a copy**: the copy icon next to a saved workflow pastes its blocks into this canvas, without its Start block, plus any variables you don't have yet. That copy is independent of the original.
- The workflow panel (click empty canvas) lists **This workflow links to** and **Linked from**.
- Validation flags links to deleted workflows and circular links (A → B → A).
- **JSON → With N linked** downloads one bundle file containing this workflow and every workflow it links to, directly or indirectly.

## Package for the main system

```bash
npm run spec
```

This regenerates [export-spec/](export-spec/): the JSON Schemas, a block-type catalog, real example exports and an integration guide, all built from the block registry. [corinthia-workflow-json-spec.zip](corinthia-workflow-json-spec.zip) is the same folder zipped for upload. Re-run after adding block types.

## JSON format (schemaVersion 1.0)

Defined in [src/export/schema.ts](src/export/schema.ts) (zod). The example is in [src/app/sample.ts](src/app/sample.ts).

```jsonc
{
  "schemaVersion": "1.0",
  "id": "wf_…", "name": "…", "description": "…",
  "version": 3,                       // +1 on every Save file
  "createdAt": "ISO", "updatedAt": "ISO",
  "variables": [{ "name": "pourVolume", "type": "number", "default": null }],
  "nodes": [{
    "id": "n6", "type": "condition", "category": "logic|data|construction",
    "label": "Large pour?",
    "data": { "condition": { "logic": "AND", "rules": [{ "var": "pourVolume", "op": ">", "value": 50 }] } },
    "outputs": [{ "id": "true", "label": "True" }, { "id": "false", "label": "False" }]
  }],
  "edges": [{ "id": "e10", "source": "n6", "sourceHandle": "true", "target": "n7", "label": "True" }],
  "dependencies": [{ "id": "wf_…", "name": "Concrete Pour Approval" }], // workflows linked from this one
  "annotations": [ /* sticky / frame / text: canvas-only, safe to ignore */ ],
  "layout": { "n6": { "x": 1540, "y": 200 } } // canvas positions only
}
```

The main system only needs `variables`, `nodes` and `edges`. Follow an edge by matching `edges[].source + sourceHandle` to `nodes[].outputs[].id`.

### Block types and `data` fields

| type | outputs | data |
|---|---|---|
| `start` | out | trigger (`manual`/`form`/`schedule`/`event`), event, schedule |
| `task` | out | assigneeRole, description, durationHours |
| `condition` | true, false | condition: `{logic, rules[]}` |
| `switch` | one per case + `default` | variable, cases `[{id,value,label}]`, hasDefault |
| `loop` | body, done | mode (`forEach`/`while`/`count`), collection, itemVariable, condition, maxIterations |
| `parallel` | branch_1…branch_n | branches |
| `join` | out | mode (`all`/`any`) |
| `delay` | out | amount, unit |
| `end` | — | status (`completed`/`rejected`/`cancelled`) |
| `setVariable` | out | variable, value |
| `form` | out | assigneeRole, fields `[{name,label,type,required,variable}]` |
| `expression` | out | variable, expression (`{{var}}` syntax) |
| `approval` | approved, rejected | role, slaHours, instructions, requireComment |
| `inspection` | pass, fail | assigneeRole, checklist[], photosRequired |
| `document` | out | docType, action (`upload`/`review`/`generate`/`sign`), required, description |
| `assign` | out | role, department, task, dueInDays |
| `notification` | out | recipientRole, channel (`email`/`sms`/`inApp`/`whatsapp`), message |
| `subworkflow` (Linked Workflow) | one per End block of the linked workflow (`id` = that End block's id); none in `handoff` mode | workflowId, workflowName, mode (`call`/`handoff`), outcomes `[{id,label}]` |

Rule operators: `== != > >= < <= between contains isEmpty isNotEmpty isTrue isFalse`. `between` takes `[min, max]`.

## Adding a new block type

Add one entry to `DEFS` in [src/nodes/registry.ts](src/nodes/registry.ts) (label, icon, colour, outputs, default data, inspector fields). The palette, inspector, validation and export pick it up automatically.
