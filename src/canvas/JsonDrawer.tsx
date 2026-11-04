import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, Package } from 'lucide-react';
import type { Issue } from '../types';

export type DrawerTab = 'json' | 'issues';

export function JsonDrawer({
  tab,
  setTab,
  json,
  issues,
  onClose,
  onCopy,
  onDownload,
  onDownloadBundle,
  linkedCount,
  onIssueClick,
}: {
  tab: DrawerTab;
  setTab: (t: DrawerTab) => void;
  json: string;
  issues: Issue[];
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onDownloadBundle: () => void;
  linkedCount: number;
  onIssueClick: (i: Issue) => void;
}) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  return (
    <div className="flex h-72 shrink-0 flex-col border-t border-slate-200 bg-white">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {(['json', 'issues'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1 text-sm font-medium ${tab === t ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t === 'json' ? 'JSON output' : (
              <span className="flex items-center gap-1.5">
                Validation
                {errors > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700">{errors}</span>}
                {warnings > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{warnings}</span>}
                {!issues.length && <CheckCircle2 size={14} className="text-emerald-600" />}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        {tab === 'json' && (
          <>
            <button className="btn py-1" onClick={onCopy}>
              <Copy size={14} /> Copy
            </button>
            <button className="btn py-1" onClick={onDownload}>
              <Download size={14} /> Download
            </button>
            {linkedCount > 0 && (
              <button className="btn py-1" title="One file with this workflow and every workflow it links to" onClick={onDownloadBundle}>
                <Package size={14} /> With {linkedCount} linked
              </button>
            )}
          </>
        )}
        <button className="btn-icon" title="Close" onClick={onClose}>
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'json' ? (
          <pre className="p-3 font-mono text-xs leading-relaxed text-slate-700">{json}</pre>
        ) : issues.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={18} /> No problems found. This workflow is ready to export.
          </div>
        ) : (
          <ul className="divide-y">
            {issues.map((i, k) => (
              <li key={k}>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-default"
                  disabled={!i.nodeId}
                  onClick={() => onIssueClick(i)}
                >
                  {i.level === 'error' ? <AlertCircle size={14} className="shrink-0 text-red-600" /> : <AlertTriangle size={14} className="shrink-0 text-amber-500" />}
                  <span className="flex-1">{i.message}</span>
                  {i.nodeId && <span className="text-xs text-teal-700">Show →</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
