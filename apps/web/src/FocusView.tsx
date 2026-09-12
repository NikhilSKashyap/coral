import { useEffect, useState } from 'react';
import { ancestorsOf, parentsOf, versionsOf, type ObjectId } from '@coral/core';
import { useStudio, uuid } from './store.js';
import type { VersionId } from '@coral/core';

/**
 * One thought at a time, with the path that led to it.
 *
 * Editing here writes a new version rather than changing the old one, which is
 * why the header counts versions and the history is always available.
 */
export default function FocusView() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);
  const write = useStudio((s) => s.write);
  const role = useStudio((s) => s.role);
  const busy = useStudio((s) => s.busy);

  const thought = selected === null ? undefined : state.thoughts[selected];
  const [text, setText] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setText(thought?.text ?? '');
    setNote(thought?.note ?? '');
  }, [thought?.objectId, thought?.currentVersionId, thought?.text, thought?.note]);

  if (thought === undefined) {
    return (
      <div className="focus">
        <div className="focuscol">
          <p className="empty">
            Select a thought on the map, or create one from the panel on the right.
          </p>
        </div>
      </div>
    );
  }

  const versions = versionsOf(state, thought.objectId);
  const ancestors = ancestorsOf(state, thought.objectId);
  const dirty = text !== thought.text || note !== thought.note;
  const editable = role === 'student' && !thought.archived;

  const save = async (): Promise<void> => {
    if (!dirty || text.trim() === '') return;
    await write('student', 'thought.revised', {
      objectId: thought.objectId,
      versionId: uuid<VersionId>(),
      parentVersionId: thought.currentVersionId,
      text: text.trim(),
      note,
    });
  };

  return (
    <div className="focus">
      <div className="focuscol">
        {ancestors.length > 0 && (
          <div className="spine">
            <span className="eyebrow">Reasoning so far</span>
            {ancestors.map((id) => {
              const a = state.thoughts[id];
              if (!a) return null;
              const rel = parentsOf(state, id)[0]?.relation ?? '';
              return (
                <button key={id} className="spinerow" onClick={() => select(id as ObjectId)}>
                  <span className="rel">{rel === '' ? 'start' : rel.replace(/_/g, ' ')}</span>
                  <span>{a.text}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="current">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>{thought.type}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
              version {versions.length}{thought.archived ? ' · archived' : ''}
            </span>
          </div>

          {editable ? (
            <>
              <textarea
                className="field bigtext"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Thought text"
              />
              <label className="lbl">
                <span className="eyebrow">Your note</span>
                <textarea
                  className="field"
                  rows={2}
                  value={note}
                  placeholder="Anything you want to keep with this thought."
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" onClick={() => void save()} disabled={!dirty || busy}>
                  Save as a new version
                </button>
                {dirty && (
                  <button className="btn ghost" onClick={() => { setText(thought.text); setNote(thought.note); }}>
                    Discard
                  </button>
                )}
                <span className="grow" />
                <button
                  className="btn ghost"
                  onClick={() => void write('student', 'thought.archived', { objectId: thought.objectId })}
                >
                  Archive
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="bigtext" style={{ margin: 0 }}>{thought.text}</p>
              {thought.note !== '' && <p style={{ margin: 0, color: 'var(--text-2)' }}>{thought.note}</p>}
              {thought.archived && role === 'student' && (
                <button
                  className="btn"
                  onClick={() => void write('student', 'thought.restored', { objectId: thought.objectId })}
                >
                  Restore
                </button>
              )}
            </>
          )}

          {thought.evidence && (
            <div className="row" style={{ background: 'var(--ext-soft)' }}>
              <span className="eyebrow" style={{ color: 'var(--ext)' }}>
                {state.sources[thought.evidence.sourceId]?.cite ?? 'Source'}
              </span>
              <p style={{ fontStyle: 'italic' }}>
                {state.passages[thought.evidence.passageId]?.text}
              </p>
              <p><strong>Warrant.</strong> {thought.evidence.warrant}</p>
            </div>
          )}
        </div>

        <div className="rows">
          <span className="eyebrow">
            Every version is kept. Nothing here is a score.
          </span>
          {[...versions].reverse().map((v, i) => (
            <div key={v.versionId} className="row">
              <div className="hd">
                <span className="eyebrow">
                  {v.type} v{versions.length - i}
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                  {v.authoredBy} · {new Date(v.at).toLocaleTimeString()}
                </span>
              </div>
              <p>{v.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
