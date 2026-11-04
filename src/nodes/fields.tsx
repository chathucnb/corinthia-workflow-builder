import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Rule, RuleGroup, RuleOp, Variable, VariableType, WorkflowSummary } from '../types';
import { uid } from '../types';
import { NOTE_COLORS, type FieldDef } from './registry';

export const VAR_TYPES: VariableType[] = ['string', 'number', 'boolean', 'date', 'list', 'file'];

const OPS: { value: RuleOp; label: string; arity: 0 | 1 | 2 }[] = [
  { value: '==', label: 'equals', arity: 1 },
  { value: '!=', label: 'not equals', arity: 1 },
  { value: '>', label: '>', arity: 1 },
  { value: '>=', label: '≥', arity: 1 },
  { value: '<', label: '<', arity: 1 },
  { value: '<=', label: '≤', arity: 1 },
  { value: 'between', label: 'between', arity: 2 },
  { value: 'contains', label: 'contains', arity: 1 },
  { value: 'isEmpty', label: 'is empty', arity: 0 },
  { value: 'isNotEmpty', label: 'is not empty', arity: 0 },
  { value: 'isTrue', label: 'is true', arity: 0 },
  { value: 'isFalse', label: 'is false', arity: 0 },
];

/** Converts typed text into the variable's type so the JSON is properly typed. */
const coerce = (raw: string, type?: VariableType): unknown => {
  if (type === 'number') return raw === '' ? '' : Number.isNaN(Number(raw)) ? raw : Number(raw);
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
};

export function VariableSelect({ value, onChange, variables }: { value: string; onChange: (v: string) => void; variables: Variable[] }) {
  const missing = value && !variables.some((v) => v.name === value);
  return (
    <select className={`input ${missing ? 'border-red-400' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select variable —</option>
      {missing && <option value={value}>{value} (not declared)</option>}
      {variables.map((v) => (
        <option key={v.name} value={v.name}>
          {v.name} : {v.type}
        </option>
      ))}
    </select>
  );
}

export function RuleBuilder({ value, onChange, variables }: { value?: RuleGroup; onChange: (g: RuleGroup) => void; variables: Variable[] }) {
  const g: RuleGroup = value ?? { logic: 'AND', rules: [] };
  const setRule = (i: number, patch: Partial<Rule>) => onChange({ ...g, rules: g.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2">
      {g.rules.length > 1 && (
        <div className="flex gap-1 text-xs">
          <span className="self-center text-slate-500">Match</span>
          {(['AND', 'OR'] as const).map((l) => (
            <button key={l} className={`rounded px-2 py-0.5 font-semibold ${g.logic === l ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => onChange({ ...g, logic: l })}>
              {l === 'AND' ? 'ALL (AND)' : 'ANY (OR)'}
            </button>
          ))}
        </div>
      )}
      {g.rules.map((r, i) => {
        const vtype = variables.find((v) => v.name === r.var)?.type;
        const arity = OPS.find((o) => o.value === r.op)?.arity ?? 1;
        const pair = Array.isArray(r.value) ? (r.value as unknown[]) : ['', ''];
        return (
          <div key={i} className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
            {i > 0 && <div className="text-[10px] font-bold text-amber-600">{g.logic}</div>}
            <div className="flex gap-1">
              <div className="flex-1">
                <VariableSelect value={r.var} variables={variables} onChange={(v) => setRule(i, { var: v })} />
              </div>
              <button className="btn-icon" title="Remove rule" onClick={() => onChange({ ...g, rules: g.rules.filter((_, j) => j !== i) })}>
                <X size={14} />
              </button>
            </div>
            <select
              className="input"
              value={r.op}
              onChange={(e) => {
                const op = e.target.value as RuleOp;
                const a = OPS.find((o) => o.value === op)!.arity;
                setRule(i, { op, value: a === 0 ? undefined : a === 2 ? ['', ''] : Array.isArray(r.value) ? '' : r.value ?? '' });
              }}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {arity === 1 &&
              (vtype === 'boolean' ? (
                <select className="input" value={String(r.value ?? '')} onChange={(e) => setRule(i, { value: coerce(e.target.value, vtype) })}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  className="input"
                  type={vtype === 'number' ? 'number' : vtype === 'date' ? 'date' : 'text'}
                  placeholder="value"
                  value={String(r.value ?? '')}
                  onChange={(e) => setRule(i, { value: coerce(e.target.value, vtype) })}
                />
              ))}
            {arity === 2 && (
              <div className="flex items-center gap-1">
                {[0, 1].map((k) => (
                  <input
                    key={k}
                    className="input"
                    type={vtype === 'number' ? 'number' : vtype === 'date' ? 'date' : 'text'}
                    placeholder={k ? 'max' : 'min'}
                    value={String(pair[k] ?? '')}
                    onChange={(e) => {
                      const next = [...pair];
                      next[k] = coerce(e.target.value, vtype);
                      setRule(i, { value: next });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button className="btn w-full justify-center" onClick={() => onChange({ ...g, rules: [...g.rules, { var: variables[0]?.name ?? '', op: '==', value: '' }] })}>
        <Plus size={14} /> Add rule
      </button>
      {!variables.length && <p className="text-xs text-amber-600">Declare variables in the Workflow panel (click empty canvas) to use them in rules.</p>}
    </div>
  );
}

function StringList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    onChange([...(value ?? []), draft.trim()]);
    setDraft('');
  };
  return (
    <div className="space-y-1">
      {(value ?? []).map((item, i) => (
        <div key={i} className="flex gap-1">
          <input className="input" value={item} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="btn-icon" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input className="input" placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

type Case = { id: string; value: string; label?: string };
function CasesEditor({ value, onChange }: { value: Case[]; onChange: (v: Case[]) => void }) {
  const cases = value ?? [];
  return (
    <div className="space-y-1">
      {cases.map((c, i) => (
        <div key={c.id} className="flex gap-1">
          <input className="input" placeholder="value" value={c.value} onChange={(e) => onChange(cases.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <input className="input" placeholder="label (optional)" value={c.label ?? ''} onChange={(e) => onChange(cases.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button className="btn-icon" onClick={() => onChange(cases.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button className="btn w-full justify-center" onClick={() => onChange([...cases, { id: uid('case'), value: '', label: '' }])}>
        <Plus size={14} /> Add case
      </button>
    </div>
  );
}

type FormField = { name: string; label?: string; type: VariableType; required: boolean; variable?: string };
function FormFieldsEditor({ value, onChange, variables }: { value: FormField[]; onChange: (v: FormField[]) => void; variables: Variable[] }) {
  const fields = value ?? [];
  const set = (i: number, patch: Partial<FormField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="flex gap-1">
            <input className="input" placeholder="field name" value={f.name} onChange={(e) => set(i, { name: e.target.value })} />
            <button className="btn-icon" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
          <input className="input" placeholder="label shown to user" value={f.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} />
          <div className="flex gap-1">
            <select className="input" value={f.type} onChange={(e) => set(i, { type: e.target.value as VariableType })}>
              {VAR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="flex shrink-0 items-center gap-1 text-xs">
              <input type="checkbox" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} /> required
            </label>
          </div>
          <div>
            <span className="text-[11px] text-slate-500">Save answer to variable</span>
            <VariableSelect value={f.variable ?? ''} variables={variables} onChange={(v) => set(i, { variable: v })} />
          </div>
        </div>
      ))}
      <button className="btn w-full justify-center" onClick={() => onChange([...fields, { name: '', label: '', type: 'string', required: false, variable: '' }])}>
        <Plus size={14} /> Add field
      </button>
    </div>
  );
}

export function FieldEditor({
  field: f,
  value,
  onChange,
  variables,
  workflows,
  onWorkflowPick,
}: {
  field: FieldDef;
  value: any;
  onChange: (v: unknown) => void;
  variables: Variable[];
  workflows: WorkflowSummary[];
  onWorkflowPick?: (w: WorkflowSummary | undefined) => void;
}) {
  const listId = f.suggestions ? `sugg-${f.key}` : undefined;
  let control: React.ReactNode;
  switch (f.kind) {
    case 'text':
      control = (
        <>
          <input
            className="input"
            list={listId}
            placeholder={f.placeholder}
            value={value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
          {listId && (
            <datalist id={listId}>
              {f.suggestions!.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      );
      break;
    case 'textarea':
      control = <textarea className="input min-h-[72px]" placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'number':
      control = (
        <input
          className="input"
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
      break;
    case 'select':
      control = (
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {f.label}
        </label>
      );
    case 'stringList':
      control = <StringList value={value} onChange={onChange} placeholder={f.placeholder} />;
      break;
    case 'rules':
      control = <RuleBuilder value={value} onChange={onChange} variables={variables} />;
      break;
    case 'cases':
      control = <CasesEditor value={value} onChange={onChange} />;
      break;
    case 'formFields':
      control = <FormFieldsEditor value={value} onChange={onChange} variables={variables} />;
      break;
    case 'variable':
      control = <VariableSelect value={value} onChange={onChange} variables={variables} />;
      break;
    case 'workflowRef':
      control = (
        <select
          className="input"
          value={value ?? ''}
          onChange={(e) => {
            onChange(e.target.value);
            onWorkflowPick?.(workflows.find((w) => w.id === e.target.value));
          }}
        >
          <option value="">— select workflow —</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      );
      break;
    case 'color':
      control = (
        <div className="flex gap-1.5">
          {Object.entries(NOTE_COLORS).map(([k, c]) => (
            <button
              key={k}
              title={k}
              onClick={() => onChange(k)}
              className={`h-6 w-6 rounded-full border-2 ${value === k ? 'border-slate-800' : 'border-white'}`}
              style={{ background: c.swatch }}
            />
          ))}
        </div>
      );
      break;
  }
  return (
    <div>
      <span className="label">
        {f.label}
        {f.required && <span className="text-red-500"> *</span>}
      </span>
      {control}
      {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
    </div>
  );
}
