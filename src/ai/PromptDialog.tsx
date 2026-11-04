import { KeyRound, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowDoc, WorkflowSummary } from '../types';
import { explainError, generateWorkflow, getApiKey, MODEL, setApiKey, type GenerateResult, type Progress } from './generate';

const EXAMPLES = [
  'Concrete pour: site engineer submits a pour request with volume and location, consultant approves the method statement, QA/QC does a pre-pour inspection, then the pour happens. Pours over 50 m³ notify the safety officer.',
  'RFI process: site engineer raises an RFI, document controller logs it, the consultant responds within 3 days; if the answer changes design, the architect issues a revised drawing.',
  'Material submittal: subcontractor submits material data sheets, QA/QC reviews, consultant approves, approved with comments, or rejects for resubmission.',
  'Safety incident: anyone reports an incident, the safety officer investigates, serious incidents notify the project manager and client immediately, then corrective actions are assigned and closed out.',
  'Variation order: client requests a change, quantity surveyor prices it, project manager and client approve, then the change is assigned to the site team.',
];

const STAGE_TEXT: Record<Progress['stage'], string> = {
  thinking: 'Claude is planning the workflow…',
  writing: 'Drawing the blocks…',
  checking: 'Checking the result…',
  repairing: 'Fixing a few problems Claude left…',
};

export function PromptDialog({
  base,
  workflows,
  onDone,
  onClose,
}: {
  /** The current workflow when editing; omit to create a new one. */
  base?: WorkflowDoc;
  workflows: WorkflowSummary[];
  onDone: (r: GenerateResult) => void;
  onClose: () => void;
}) {
  const editing = !!base && base.nodes.some((n) => !['start', 'end', 'sticky', 'frame', 'text'].includes(n.type ?? ''));
  const [text, setText] = useState('');
  const [key, setKey] = useState(getApiKey);
  const [showKey, setShowKey] = useState(!getApiKey());
  const [busy, setBusy] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    return () => abort.current?.abort();
  }, []);

  const run = async () => {
    if (!text.trim()) return;
    if (!key.trim()) {
      setShowKey(true);
      setError('Add your Anthropic API key first.');
      return;
    }
    setApiKey(key);
    setError(null);
    abort.current = new AbortController();
    setBusy({ stage: 'thinking', chars: 0 });
    try {
      const r = await generateWorkflow({ request: text, workflows, base, apiKey: key.trim(), signal: abort.current.signal, onProgress: setBusy });
      onDone(r);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl" onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Sparkles size={18} className="text-teal-700" />
          <h2 className="flex-1 font-semibold">{editing ? 'Change this workflow with a prompt' : 'Describe the workflow'}</h2>
          <button className="btn-icon" title="API key" onClick={() => setShowKey((s) => !s)}>
            <KeyRound size={16} />
          </button>
          <button className="btn-icon" onClick={() => (busy ? abort.current?.abort() : onClose())} title={busy ? 'Cancel' : 'Close'}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {showKey && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <label className="label">Anthropic API key</label>
              <input
                className="input font-mono"
                type="password"
                placeholder="sk-ant-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={() => setApiKey(key)}
                autoComplete="off"
              />
              <p className="mt-1.5 text-xs text-amber-900">
                Get one at console.anthropic.com. It is stored only in this browser. When you generate, your description
                {editing ? ', the current workflow' : ''} and the names of your saved workflows are sent to Anthropic's API. Your workflows themselves stay saved on this computer.
              </p>
            </div>
          )}

          <textarea
            ref={area}
            className="input min-h-[140px] text-[15px] leading-relaxed"
            placeholder={
              editing
                ? 'e.g. "Add a safety briefing before the pour, and if the inspection fails twice, escalate to the project manager."'
                : 'Describe the process in your own words: who does what, what gets approved or inspected, and what happens when something is rejected.'
            }
            value={text}
            disabled={!!busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && run()}
          />

          {!editing && !busy && (
            <div>
              <div className="label">Examples</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-teal-500 hover:text-teal-800" onClick={() => setText(ex)} title={ex}>
                    {ex.split(':')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex items-center gap-3 border-t px-5 py-3">
          <span className="flex-1 text-xs text-slate-500">
            {busy ? (
              <span className="flex items-center gap-2 text-slate-700">
                <Loader2 size={14} className="animate-spin" /> {STAGE_TEXT[busy.stage]}
                {busy.chars > 0 && <span className="text-slate-400">{Math.round(busy.chars / 100) / 10}k chars</span>}
              </span>
            ) : editing ? (
              'Replaces the current blocks; Undo (Ctrl+Z) brings them back.'
            ) : (
              `Uses Claude (${MODEL}). Usually takes under a minute. Ctrl+Enter to start.`
            )}
          </span>
          {busy ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          ) : (
            <button className="btn-primary" disabled={!text.trim()} onClick={run}>
              <Sparkles size={15} /> {editing ? 'Update workflow' : 'Generate workflow'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
