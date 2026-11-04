import Anthropic from '@anthropic-ai/sdk';
import { validate } from '../export/validate';
import type { Issue, WorkflowDoc, WorkflowSummary } from '../types';
import { aiToDoc, currentForModel, type AiWorkflow } from './apply';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt';

export const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'corinthia.anthropicApiKey';

/** The API key lives only in this browser's local storage. */
export const getApiKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
};
export const setApiKey = (key: string) => {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
};

export interface GenerateResult {
  doc: WorkflowDoc;
  assumptions: string[];
  dropped: string[];
  issues: Issue[];
}

export type Progress = { stage: 'thinking' | 'writing' | 'checking' | 'repairing'; chars: number };

/** Turns SDK errors into messages a site user can act on. */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in the key settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use this model.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limit reached. Wait a minute and try again.';
  if (e instanceof Anthropic.APIUserAbortError) return 'Cancelled.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${e.message}`;
  return (e as Error)?.message ?? String(e);
}

/**
 * Asks Claude to create a workflow from a description, or to update `base`.
 * If the result fails validation, Claude gets one chance to fix it.
 */
export async function generateWorkflow(opts: {
  request: string;
  workflows: WorkflowSummary[];
  base?: WorkflowDoc;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}): Promise<GenerateResult> {
  // Browser use is intended here: the key is the user's own, kept on their machine.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const others = opts.workflows.filter((w) => w.id !== opts.base?.id);
  const hasFlow = !!opts.base && opts.base.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').length > 0;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: buildUserMessage({ request: opts.request, workflows: others, current: hasFlow ? currentForModel(opts.base!) : undefined }),
    },
  ];

  const ask = async (stage: Progress['stage']) => {
    let chars = 0;
    opts.onProgress?.({ stage: stage === 'repairing' ? 'repairing' : 'thinking', chars });
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages,
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => {
      chars += delta.length;
      opts.onProgress?.({ stage: stage === 'repairing' ? 'repairing' : 'writing', chars });
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing the description.');
    if (msg.stop_reason === 'max_tokens') throw new Error('The workflow was too large to finish. Try describing a smaller part of the process.');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    let ai: AiWorkflow;
    try {
      ai = JSON.parse(text) as AiWorkflow;
    } catch {
      throw new Error('Claude returned an unreadable answer. Please try again.');
    }
    // Keep the full assistant turn (including thinking) for a possible repair round.
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    return ai;
  };

  let ai = await ask('thinking');
  opts.onProgress?.({ stage: 'checking', chars: 0 });
  let { doc, dropped } = aiToDoc(ai, { base: opts.base, workflows: opts.workflows });
  let issues = validate(doc, opts.workflows);

  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length || dropped.length) {
    messages.push({
      role: 'user',
      content:
        'The editor found these problems in your workflow:\n' +
        [...dropped, ...errors.map((i) => i.message)].map((m) => `- ${m}`).join('\n') +
        '\n\nReturn the complete corrected workflow.',
    });
    ai = await ask('repairing');
    opts.onProgress?.({ stage: 'checking', chars: 0 });
    ({ doc, dropped } = aiToDoc(ai, { base: opts.base, workflows: opts.workflows }));
    issues = validate(doc, opts.workflows);
  }

  return { doc, assumptions: ai.assumptions ?? [], dropped, issues };
}
