import { useEffect, useState } from 'react';
import type { Actor, ProjectId } from '@coral/core';
import FocusView from './FocusView.js';
import FramingView from './FramingView.js';
import Inspector from './Inspector.js';
import MapView from './MapView.js';
import { useStudio } from './store.js';

export default function App() {
  const projects = useStudio((s) => s.projects);
  const projectId = useStudio((s) => s.projectId);
  const state = useStudio((s) => s.state);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const role = useStudio((s) => s.role);
  const setRole = useStudio((s) => s.setRole);
  const refreshProjects = useStudio((s) => s.refreshProjects);
  const newProject = useStudio((s) => s.newProject);
  const open = useStudio((s) => s.open);
  const busy = useStudio((s) => s.busy);

  const [offline, setOffline] = useState(false);

  useEffect(() => {
    void refreshProjects().catch(() => setOffline(true));
  }, [refreshProjects]);

  if (offline) {
    return (
      <div className="pad" style={{ maxWidth: 520, margin: '80px auto' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>The server is not answering</h1>
        <p className="empty">
          Start it, then reload this page.
        </p>
        <pre className="mono field" style={{ whiteSpace: 'pre-wrap' }}>
{`pnpm db:up
pnpm db:migrate
pnpm --filter @coral/server start`}
        </pre>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">
          <span className="dot" />
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>
            Epistemic Research Studio
          </span>
        </div>

        <div className="pad" style={{ paddingTop: 0 }}>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void newProject('AI and independent reasoning', 'AI & Learning')}
          >
            + New question
          </button>
        </div>

        <div className="projlist">
          <span className="eyebrow" style={{ padding: '6px 10px' }}>Research</span>
          {projects.length === 0 && (
            <p className="empty" style={{ padding: '0 10px' }}>Nothing yet.</p>
          )}
          {projects.map((p) => (
            <button
              key={p.projectId}
              className="proj"
              aria-current={p.projectId === projectId}
              onClick={() => void open(p.projectId as ProjectId)}
            >
              <span className="t">{p.title}</span>
              <span className="m mono">{p.group} &middot; {p.events} events</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="stage">
        <div className="topbar">
          <span style={{ fontSize: 13 }}>
            {projectId === null ? 'No question open' : state.title}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {projectId === null ? '' : `${state.seq} events`}
          </span>
          <span className="grow" />

          <div className="seg">
            {(['frame', 'map', 'focus'] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'frame' ? 'Frame' : v === 'map' ? 'Map' : 'Focus'}
              </button>
            ))}
          </div>

          <div className="seg">
            {(['student', 'instructor'] as Actor[]).map((r) => (
              <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>
                {r === 'student' ? 'Student' : 'Instructor'}
              </button>
            ))}
          </div>
        </div>

        {projectId === null ? (
          <div className="focus">
            <div className="focuscol">
              <p className="empty">
                Open a question from the left, or start a new one. Every change you make is an event in
                an append-only log, so nothing here is overwritten and nothing is deleted.
              </p>
            </div>
          </div>
        ) : view === 'frame' ? <FramingView /> : view === 'map' ? <MapView /> : <FocusView />}
      </main>

      <Inspector />
    </div>
  );
}
