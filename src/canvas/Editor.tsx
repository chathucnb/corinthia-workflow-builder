import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  ArrowLeft,
  ArrowLeftRight,
  Braces,
  CheckCircle2,
  Cloud,
  FileUp,
  LayoutDashboard,
  Redo2,
  Save,
  ShieldCheck,
  Sparkles,
  X,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PromptDialog } from '../ai/PromptDialog';
import { parseImport, toBundle, toJson } from '../export/convert';
import { endOutcomes, sameOutcomes, withDependencies } from '../export/links';
import { validate } from '../export/validate';
import { DirectionContext, IssuesContext, LaneStatsContext, nodeTypes } from '../nodes/nodes';
import { getDef, isAnnotation } from '../nodes/registry';
import { downloadText, fileNameFor, loadAllWorkflows, pickTextFile, saveToDisk, saveWorkflow, summarize } from '../store/persistence';
import { useWorkflow } from '../store/workflowStore';
import type { FlowNode, Issue, WorkflowDoc } from '../types';
import { Inspector } from './Inspector';
import { JsonDrawer, type DrawerTab } from './JsonDrawer';
import { arrangeInLanes, handoffs as findHandoffs, isStructural, lanesOf, membership } from './lanes';
import { autoLayout } from './layout';
import { DND_TYPE, DND_WF, Palette } from './Palette';

const BRANCH_COLORS: Record<string, string> = {
  true: '#16a34a',
  approved: '#16a34a',
  pass: '#16a34a',
  false: '#dc2626',
  rejected: '#dc2626',
  fail: '#dc2626',
};

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

function EditorInner({ onBack, toast }: { onBack: () => void; toast: (m: string) => void }) {
  const doc = useWorkflow((s) => s.doc)!;
  const dirty = useWorkflow((s) => s.dirty);
  const canUndo = useWorkflow((s) => s.past.length > 0);
  const canRedo = useWorkflow((s) => s.future.length > 0);
  const store = useWorkflow.getState;
  const rf = useReactFlow<FlowNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [saved, setSaved] = useState(true);
  const [prompting, setPrompting] = useState(false);
  const [aiNotes, setAiNotes] = useState<string[] | null>(null);
  const [others, setOthers] = useState<Map<string, WorkflowDoc>>(new Map());

  // Load the other saved workflows (for linking), and refresh the outcomes of
  // Linked Workflow blocks in case those workflows changed since last time.
  useEffect(() => {
    loadAllWorkflows().then((all) => {
      const map = new Map(all.filter((w) => w.id !== store().doc?.id).map((w) => [w.id, w]));
      setOthers(map);
      const cur = store().doc;
      if (!cur) return;
      let changed = false;
      const nodes = cur.nodes.map((n) => {
        const t = n.type === 'subworkflow' ? map.get(n.data.workflowId) : undefined;
        if (!t) return n;
        const outcomes = endOutcomes(t);
        if (sameOutcomes(n.data.outcomes, outcomes) && n.data.workflowName === t.name) return n;
        changed = true;
        return { ...n, data: { ...n.data, outcomes, workflowName: t.name } };
      });
      if (changed) store().setNodes(nodes, false);
    });
  }, [store]);
  // Every workflow including this one (live), for validation and linking.
  const workflows = useMemo(() => [summarize(doc), ...[...others.values()].map(summarize)], [others, doc]);
  const otherSummaries = useMemo(() => workflows.slice(1), [workflows]);
  const openWorkflow = useCallback((id: string) => (location.hash = `#/w/${encodeURIComponent(id)}`), []);

  // ── Autosave to IndexedDB (debounced) ──
  useEffect(() => {
    if (!dirty) return;
    setSaved(false);
    const t = setTimeout(async () => {
      const d = store().doc;
      if (d) await saveWorkflow(d);
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [dirty, store]);
  useEffect(() => {
    const flush = () => {
      const d = store().doc;
      if (d) void saveWorkflow(d);
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [store]);

  // ── Validation & JSON ──
  const logicKey = useMemo(
    () => JSON.stringify([doc.variables, doc.nodes.map((n) => [n.id, n.type, n.data]), doc.edges.map((e) => [e.source, e.sourceHandle, e.target])]),
    [doc.variables, doc.nodes, doc.edges],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = useMemo(() => validate(doc, workflows), [logicKey, others]);
  const issueMap = useMemo(() => {
    const m = new Map<string, number>();
    issues.forEach((i) => i.level === 'error' && i.nodeId && m.set(i.nodeId, (m.get(i.nodeId) ?? 0) + 1));
    return m;
  }, [issues]);
  const json = useMemo(() => (drawer === 'json' ? JSON.stringify(toJson(doc), null, 2) : ''), [drawer, doc]);

  // ── Swimlanes: which blocks hand work to another lane ──
  const [showHandoffs, setShowHandoffs] = useState(false);
  const hasLanes = useMemo(() => doc.nodes.some((n) => n.type === 'lane'), [doc.nodes]);
  const laneInfo = useMemo(() => {
    if (!hasLanes) return { cross: new Set<string>(), stats: new Map<string, { blocks: number; handoffs: number }>() };
    const { lanes, lane } = membership(doc.nodes);
    const list = findHandoffs(doc.nodes, doc.edges);
    const stats = new Map(lanes.map((l) => [l.id, { blocks: 0, handoffs: 0 }]));
    doc.nodes.forEach((n) => !isAnnotation(n.type) && lane.has(n.id) && stats.get(lane.get(n.id)!)!.blocks++);
    list.forEach((h) => {
      stats.get(h.from)!.handoffs++;
      stats.get(h.to)!.handoffs++;
    });
    return { cross: new Set(list.map((h) => h.edge.id)), stats };
  }, [hasLanes, doc.nodes, doc.edges]);
  const flowNodes = useMemo(() => doc.nodes.map((n) => (n.type === 'lane' && n.draggable !== false ? { ...n, draggable: false } : n)), [doc.nodes]);

  // ── Edges rendering ──
  const edges = useMemo<Edge[]>(
    () =>
      doc.edges.map((e) => {
        const cross = laneInfo.cross.has(e.id);
        const color = showHandoffs && cross ? '#ea580c' : BRANCH_COLORS[e.sourceHandle ?? ''] ?? '#64748b';
        return {
          ...e,
          type: 'smoothstep',
          animated: showHandoffs && cross,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
          style: { stroke: color, strokeWidth: showHandoffs && cross ? 2.5 : undefined, opacity: showHandoffs && !cross ? 0.25 : 1 },
          labelStyle: { fontSize: 11, fontWeight: 600, fill: color },
          labelBgStyle: { fill: '#fff' },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [doc.edges, laneInfo, showHandoffs],
  );

  // ── Frames: put dropped/dragged blocks inside the frame under them ──
  const frameAt = useCallback(
    (abs: { x: number; y: number }, excludeId?: string) => {
      const frames = store().doc!.nodes.filter((n) => n.type === 'frame' && n.id !== excludeId);
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = rf.getInternalNode(frames[i].id);
        if (!f) continue;
        const { x, y } = f.internals.positionAbsolute;
        const w = f.measured.width ?? 0;
        const h = f.measured.height ?? 0;
        if (abs.x >= x && abs.x <= x + w && abs.y >= y && abs.y <= y + h) return { id: f.id, x, y };
      }
      return null;
    },
    [rf, store],
  );

  const addAt = useCallback(
    (type: string, pos: { x: number; y: number }, linkId?: string) => {
      const frame = type === 'frame' ? null : frameAt(pos);
      const position = frame ? { x: pos.x - frame.x, y: pos.y - frame.y } : pos;
      const target = linkId ? others.get(linkId) : undefined;
      const def = getDef(type)!;
      store().addNode(type, position, {
        ...(frame ? { parentId: frame.id } : {}),
        ...(target
          ? { data: { ...def.defaults(), label: target.name, workflowId: target.id, workflowName: target.name, mode: 'call', outcomes: endOutcomes(target) } }
          : {}),
      });
    },
    [frameAt, store, others],
  );

  const centerPoint = () => {
    const r = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const insertCopy = (id: string) => {
    const src = others.get(id);
    if (!src) return;
    const p = centerPoint();
    store().insertCopy(src, { x: p.x - 200, y: p.y - 100 });
    toast(`Inserted a copy of "${src.name}". Connect it into your flow.`);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DND_TYPE);
    if (!type) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(type, { x: p.x - (type === 'frame' ? 20 : 120), y: p.y - 30 }, e.dataTransfer.getData(DND_WF) || undefined);
  };

  const addAtCenter = (type: string, linkId?: string) => {
    const p = centerPoint();
    addAt(type, { x: p.x - 120 + Math.random() * 40, y: p.y - 40 + Math.random() * 40 }, linkId);
  };

  const onNodeDragStop = (_: unknown, __: Node, dragged: Node[]) => {
    const nodes = store().doc!.nodes;
    let changed = false;
    const next = nodes.map((n) => {
      if (!dragged.some((d) => d.id === n.id) || n.type === 'frame' || isStructural(n)) return n;
      const internal = rf.getInternalNode(n.id);
      if (!internal) return n;
      const abs = internal.internals.positionAbsolute;
      const center = { x: abs.x + (internal.measured.width ?? 0) / 2, y: abs.y + (internal.measured.height ?? 0) / 2 };
      const frame = frameAt(center, n.id);
      if ((frame?.id ?? undefined) === n.parentId) return n;
      changed = true;
      return frame
        ? { ...n, parentId: frame.id, position: { x: abs.x - frame.x, y: abs.y - frame.y } }
        : { ...n, parentId: undefined, position: { ...abs } };
    });
    if (changed) store().setNodes(next, false);
  };

  // ── Actions ──
  const exportString = (version: number) => JSON.stringify({ ...toJson(store().doc!), version }, null, 2);

  const saveFile = useCallback(
    async (forcePicker = false) => {
      const d = store().doc!;
      const name = await saveToDisk(d.id, fileNameFor(d.name), exportString(d.version + 1), forcePicker);
      if (name) {
        store().bumpVersion();
        toast(`Saved ${name} (v${d.version + 1})`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, toast],
  );

  const importIntoCurrent = async () => {
    const text = await pickTextFile();
    if (!text) return;
    try {
      const [wf] = parseImport(text);
      if (!confirm(`Replace the current canvas with "${wf.name}"? (You can undo.)`)) return;
      store().replaceDoc({ ...wf, name: store().doc!.name });
      setTimeout(() => rf.fitView({ duration: 300 }), 50);
      toast('Imported');
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const focusIssue = (i: Issue) => {
    if (!i.nodeId) return;
    const n = rf.getInternalNode(i.nodeId);
    if (!n) return;
    store().selectOnly(i.nodeId);
    rf.setCenter(n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2, n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2, {
      zoom: Math.max(rf.getZoom(), 1),
      duration: 400,
    });
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveFile(e.shiftKey);
        return;
      }
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) (e.preventDefault(), store().undo());
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), store().redo());
      else if (mod && k === 'c') store().copySelected();
      else if (mod && k === 'v') store().paste();
      else if (mod && k === 'd') (e.preventDefault(), store().copySelected() && store().paste());
      else if (mod && k === 'a') {
        e.preventDefault();
        const d = store().doc!;
        store().setNodes(d.nodes.map((n) => ({ ...n, selected: !isStructural(n) })), false);
      } else if (k === 'delete' || k === 'backspace') store().deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveFile, store]);

  const errors = issues.filter((i) => i.level === 'error').length;
  const flowCount = doc.nodes.filter((n) => !isAnnotation(n.type)).length;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2">
        <button className="btn-icon" title="All workflows" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <input
          className="w-72 rounded px-2 py-1 text-[15px] font-semibold outline-none hover:bg-slate-100 focus:bg-slate-100"
          value={doc.name}
          onChange={(e) => store().setMeta({ name: e.target.value })}
        />
        <span className="flex items-center gap-1 text-xs text-slate-400" title="Autosaved in this browser">
          {saved ? <CheckCircle2 size={13} /> : <Cloud size={13} />} {saved ? 'Saved locally' : 'Saving…'} · v{doc.version} · {flowCount} blocks
        </span>
        <div className="flex-1" />
        <button className="btn border-teal-600 text-teal-800" title="Create or change this workflow by describing it" onClick={() => setPrompting(true)}>
          <Sparkles size={15} /> Prompt
        </button>
        <button className="btn-icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => store().undo()}>
          <Undo2 size={17} />
        </button>
        <button className="btn-icon" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => store().redo()}>
          <Redo2 size={17} />
        </button>
        <button
          className="btn"
          title={hasLanes ? 'Arrange blocks top-to-bottom inside their lanes' : 'Auto-arrange blocks'}
          onClick={() => {
            const d = store().doc!;
            store().setNodes(lanesOf(d.nodes).length ? arrangeInLanes(d.nodes, d.edges) : autoLayout(d.nodes, d.edges));
            setTimeout(() => rf.fitView({ duration: 300 }), 50);
          }}
        >
          <LayoutDashboard size={15} /> Arrange
        </button>
        {hasLanes && (
          <button
            className={`btn ${showHandoffs ? 'border-orange-400 bg-orange-50 text-orange-800' : ''}`}
            title="Highlight connections that hand work from one lane (department) to another"
            onClick={() => setShowHandoffs((v) => !v)}
          >
            <ArrowLeftRight size={15} /> Handoffs {laneInfo.cross.size}
          </button>
        )}
        <button className={`btn ${errors ? 'text-red-700' : 'text-emerald-700'}`} onClick={() => setDrawer('issues')}>
          <ShieldCheck size={15} /> {errors ? `${errors} error${errors > 1 ? 's' : ''}` : 'Valid'}
        </button>
        <button className="btn" onClick={() => setDrawer(drawer === 'json' ? null : 'json')}>
          <Braces size={15} /> JSON
        </button>
        <button className="btn" title="Load a workflow JSON into this canvas" onClick={importIntoCurrent}>
          <FileUp size={15} /> Import
        </button>
        <button className="btn-primary" title="Save JSON file to disk (Ctrl+S). Shift+Ctrl+S = Save As" onClick={() => saveFile()}>
          <Save size={15} /> Save file
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette onAdd={addAtCenter} workflows={otherSummaries} onLink={(id) => addAtCenter('subworkflow', id)} onInsertCopy={insertCopy} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1" ref={wrapper} onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))} onDrop={onDrop}>
            <IssuesContext.Provider value={issueMap}>
             <DirectionContext.Provider value={doc.direction ?? 'LR'}>
             <LaneStatsContext.Provider value={laneInfo.stats}>
              <ReactFlow<FlowNode>
                nodes={flowNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={store().onNodesChange}
                onEdgesChange={(c) => store().onEdgesChange(c as never)}
                onConnect={store().onConnect}
                onNodeDragStart={() => store().snapshot()}
                onNodeDragStop={onNodeDragStop}
                onNodeDoubleClick={(_, n) => {
                  if (n.type === 'subworkflow' && n.data.workflowId && others.has(n.data.workflowId)) openWorkflow(n.data.workflowId);
                }}
                isValidConnection={(c) => c.source !== c.target && !!getDef(store().doc!.nodes.find((n) => n.id === c.target)?.type)?.hasInput}
                deleteKeyCode={null}
                selectionKeyCode="Shift"
                multiSelectionKeyCode={['Control', 'Meta']}
                panOnScroll
                zoomOnScroll={false}
                zoomActivationKeyCode={['Control', 'Meta']}
                connectionRadius={30}
                snapToGrid
                snapGrid={[10, 10]}
                minZoom={0.1}
                maxZoom={2.5}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) => (n.type === 'lane' ? '#f1f5f9' : n.type === 'band' ? '#ffedd5' : getDef(n.type)?.color ?? '#94a3b8')}
                  nodeStrokeWidth={2}
                />
              </ReactFlow>
             </LaneStatsContext.Provider>
             </DirectionContext.Provider>
            </IssuesContext.Provider>
            {aiNotes && (
              <div className="absolute left-1/2 top-4 z-10 w-[min(560px,90%)] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm shadow">
                <div className="mb-1 flex items-center gap-2 font-semibold text-amber-900">
                  <Sparkles size={14} /> Claude assumed:
                  <button className="btn-icon ml-auto h-6 w-6" onClick={() => setAiNotes(null)} title="Dismiss">
                    <X size={14} />
                  </button>
                </div>
                <ul className="list-disc space-y-0.5 pl-5 text-amber-900">
                  {aiNotes.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {!aiNotes && flowCount <= 2 && doc.edges.length === 0 && (
              <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-slate-800/80 px-4 py-1.5 text-xs text-white">
                Drag blocks from the left · connect the dots · scroll to pan, Ctrl+scroll to zoom
              </div>
            )}
          </div>
          {drawer && (
            <JsonDrawer
              tab={drawer}
              setTab={setDrawer}
              json={json}
              issues={issues}
              onClose={() => setDrawer(null)}
              onCopy={async () => {
                await navigator.clipboard.writeText(json);
                toast('JSON copied to clipboard');
              }}
              onDownload={() => downloadText(fileNameFor(doc.name), json)}
              linkedCount={withDependencies(doc.id, new Map([[doc.id, doc], ...others])).length - 1}
              onDownloadBundle={() => {
                const docs = withDependencies(doc.id, new Map([[doc.id, doc], ...others]));
                downloadText(fileNameFor(`${doc.name}-with-linked`), JSON.stringify(toBundle(docs), null, 2));
                toast(`Downloaded ${docs.length} workflows in one file`);
              }}
              onIssueClick={focusIssue}
            />
          )}
        </div>
        <Inspector workflows={workflows} issues={issues} onOpenWorkflow={openWorkflow} />
      </div>
      {prompting && (
        <PromptDialog
          base={doc}
          workflows={workflows}
          onClose={() => setPrompting(false)}
          onDone={(r) => {
            setPrompting(false);
            store().replaceDoc(r.doc);
            setAiNotes(r.assumptions.length ? r.assumptions : null);
            setTimeout(() => rf.fitView({ duration: 400, padding: 0.15 }), 80);
            const errs = r.issues.filter((i) => i.level === 'error').length;
            toast(errs ? `Done, with ${errs} problem${errs > 1 ? 's' : ''} to review. Ctrl+Z to undo.` : 'Workflow updated. Ctrl+Z to undo.');
            if (errs) setDrawer('issues');
          }}
        />
      )}
    </div>
  );
}

export function Editor(props: { onBack: () => void; toast: (m: string) => void }) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
