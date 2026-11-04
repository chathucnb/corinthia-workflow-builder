import { useCallback, useEffect, useState } from 'react';
import { Editor } from '../canvas/Editor';
import { loadWorkflow, saveWorkflow } from '../store/persistence';
import { useWorkflow } from '../store/workflowStore';
import { Home } from './Home';

/** Hash routing: #/ = list, #/w/<id> = editor. Survives reloads. */
const readRoute = () => {
  const m = location.hash.match(/^#\/w\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

export default function App() {
  const [route, setRoute] = useState<string | null>(readRoute);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const doc = useWorkflow((s) => s.doc);

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2500);
  }, []);

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!route) {
      const leaving = useWorkflow.getState().doc;
      if (leaving) void saveWorkflow(leaving);
      useWorkflow.getState().close();
      setReady(true);
      return;
    }
    // Save the workflow being left (e.g. when jumping to a linked workflow).
    const leaving = useWorkflow.getState().doc;
    (leaving ? saveWorkflow(leaving) : Promise.resolve())
      .then(() => loadWorkflow(route))
      .then((d) => {
      if (cancelled) return;
      if (!d) {
        location.hash = '#/';
        return;
      }
      useWorkflow.getState().load(d);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [route]);

  const open = (id: string) => (location.hash = `#/w/${encodeURIComponent(id)}`);

  return (
    <>
      {!ready ? null : route && doc ? (
        <Editor key={doc.id} onBack={() => (location.hash = '#/')} toast={toast} />
      ) : (
        <Home onOpen={open} toast={toast} />
      )}
      {msg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{msg}</div>
      )}
    </>
  );
}
