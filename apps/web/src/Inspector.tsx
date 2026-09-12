import { useState } from 'react';
import {
  RELATIONS, THOUGHT_TYPES, canBackEvidence, coachMoves, hintLevelFor, liveThoughts,
  type CommentId, type HintLevel, type MoveId, type ObjectId, type PassageId,
  type Relation, type RelationId, type SnapshotId, type Source, type ThoughtType,
  type VersionId,
} from '@noesis/core';
import { useStudio, uuid } from './store.js';

type Tab = 'build' | 'sources' | 'coach' | 'review';

export default function Inspector() {
  const [tab, setTab] = useState<Tab>('build');
  const refusal = useStudio((s) => s.refusal);
  const dismiss = useStudio((s) => s.dismiss);
  const record = useStudio((s) => s.record);

  return (
    <aside className="panel">
      <div className="tabs">
        {(['build', 'sources', 'coach', 'review'] as Tab[]).map((t) => (
          <button key={t} aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'review' ? 'Review' : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="pad divide">
        {refusal !== null && (
          <div className="refusal">
            <span className="w">Write refused &middot; {refusal.invariant}</span>
            <span className="m">{refusal.message}</span>
            <button className="btn ghost" style={{ alignSelf: 'flex-start', color: 'inherit' }} onClick={dismiss}>
              Dismiss
            </button>
          </div>
        )}

        {tab === 'build' && <BuildTab />}
        {tab === 'sources' && <SourcesTab />}
        {tab === 'coach' && <CoachTab />}
        {tab === 'review' && <ReviewTab />}
      </div>

      {record !== null && (
        <div className="pad divide">
          <span className="eyebrow">Observable record</span>
          <p className="empty" style={{ marginTop: -4 }}>
            Counts of things that happened. No score, no judgment about the student.
          </p>
          <dl className="kvs">
            {Object.entries(record).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                <dd style={{ color: v > 0 ? 'var(--text)' : 'var(--text-3)' }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function BuildTab() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);
  const write = useStudio((s) => s.write);
  const busy = useStudio((s) => s.busy);
  const role = useStudio((s) => s.role);

  const [type, setType] = useState<ThoughtType>('WONDER');
  const [text, setText] = useState('');
  const [relation, setRelation] = useState<Relation>('raises');
  const [target, setTarget] = useState('');

  if (role !== 'student') {
    return <p className="empty">Switch to the student seat to change the map. An instructor only comments.</p>;
  }

  const parent = selected === null ? undefined : state.thoughts[selected];
  const others = liveThoughts(state).filter((t) => t.objectId !== selected);

  const create = async (): Promise<void> => {
    if (text.trim() === '') return;
    const objectId = uuid<ObjectId>();
    const base = parent?.position ?? { x: 120, y: 120 };
    const ok = await write('student', 'thought.created', {
      objectId,
      versionId: uuid<VersionId>(),
      type,
      text: text.trim(),
      note: '',
      position: { x: base.x + 40, y: base.y + 210 },
    });
    if (!ok) return;
    if (parent) {
      await write('student', 'relation.created', {
        relationId: uuid<RelationId>(), from: parent.objectId, to: objectId, relation,
      });
    }
    setText('');
    select(objectId);
  };

  const connect = async (): Promise<void> => {
    if (selected === null || target === '') return;
    await write('student', 'relation.created', {
      relationId: uuid<RelationId>(), from: selected, to: target, relation,
    });
    setTarget('');
  };

  return (
    <>
      <span className="eyebrow">
        {parent ? `Branch from this ${parent.type.toLowerCase()}` : 'New thought'}
      </span>
      {parent && <p className="empty" style={{ marginTop: -6 }}>{parent.text}</p>}

      <label className="lbl">
        <span className="eyebrow">Type</span>
        <select className="field" value={type} onChange={(e) => setType(e.target.value as ThoughtType)}>
          {THOUGHT_TYPES.filter((t) => t !== 'EVIDENCE').map((t) => (
            <option key={t} value={t}>{t.toLowerCase()}</option>
          ))}
        </select>
      </label>
      <p className="empty" style={{ marginTop: -6 }}>
        Evidence is not in this list. It is created from a source, in the Sources tab.
      </p>

      {parent && (
        <label className="lbl">
          <span className="eyebrow">Relation</span>
          <select className="field" value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
            {RELATIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      )}

      <label className="lbl">
        <span className="eyebrow">In your own words</span>
        <textarea
          className="field" rows={3} value={text}
          placeholder="Write the thought yourself. Nothing fills this in for you."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button className="btn primary" onClick={() => void create()} disabled={busy || text.trim() === ''}>
        Create {type.toLowerCase()}
      </button>

      {selected !== null && others.length > 0 && (
        <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">Connect to an existing thought</span>
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose a thought</option>
            {others.map((t) => (
              <option key={t.objectId} value={t.objectId}>
                {t.type.toLowerCase()} — {t.text.slice(0, 46)}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void connect()} disabled={target === '' || busy}>
            Connect with &ldquo;{relation.replace(/_/g, ' ')}&rdquo;
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function SourcesTab() {
  const state = useStudio((s) => s.state);
  const search = useStudio((s) => s.search);
  const write = useStudio((s) => s.write);
  const busy = useStudio((s) => s.busy);
  const role = useStudio((s) => s.role);
  const select = useStudio((s) => s.select);

  const [open, setOpen] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState('');
  const [warrant, setWarrant] = useState('');

  const sources = Object.values(state.sources);
  const passageFor = (s: Source): PassageId | null =>
    Object.values(state.passages).find((p) => p.sourceId === s.sourceId)?.passageId ?? null;

  const makeEvidence = async (source: Source): Promise<void> => {
    const passageId = passageFor(source);
    if (passageId === null) return;
    const objectId = uuid<ObjectId>();
    const ok = await write('student', 'evidence.created', {
      objectId,
      versionId: uuid<VersionId>(),
      sourceId: source.sourceId,
      passageId,
      interpretation,
      warrant,
      position: { x: 640, y: 300 },
    });
    if (ok) {
      setOpen(null); setInterpretation(''); setWarrant('');
      select(objectId);
    }
  };

  return (
    <>
      <span className="eyebrow">Literature</span>
      {sources.length === 0 ? (
        <>
          <p className="empty">
            Nothing searched yet. The fixture returns four papers at different access levels so the
            evidence gate can be tried against each.
          </p>
          <button className="btn primary" onClick={() => void search()} disabled={busy}>
            Search
          </button>
        </>
      ) : (
        <div className="rows">
          {sources.map((source) => {
            const usable = canBackEvidence(source.access);
            const passageId = passageFor(source);
            const passage = passageId === null ? null : state.passages[passageId] ?? null;
            const cited = Object.values(state.thoughts)
              .some((t) => t.evidence?.sourceId === source.sourceId);
            return (
              <div key={source.sourceId} className="row">
                <div className="hd">
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ext)' }}>{source.cite}</span>
                  <span className={`tag ${usable ? 'usable' : 'gated'}`}>
                    {source.access.replace(/_/g, ' ')}
                  </span>
                </div>
                <p style={{ color: 'var(--text)' }}>{source.title}</p>
                {passage !== null && <p style={{ fontStyle: 'italic' }}>&ldquo;{passage.text}&rdquo; {passage.locator}</p>}
                {passage === null && source.abstract !== null && <p>{source.abstract}</p>}
                {passage === null && (
                  <p style={{ color: 'var(--text-3)' }}>
                    No retrievable passage. Nothing is shown here that was not fetched.
                  </p>
                )}

                {role === 'student' && (
                  <div className="acts">
                    {cited && <span className="tag usable">cited</span>}
                    {usable && passage !== null && !cited && (
                      <button className="btn" onClick={() => setOpen(open === source.sourceId ? null : source.sourceId)}>
                        Use as evidence
                      </button>
                    )}
                    {!usable && (
                      <button
                        className="btn"
                        onClick={() => void write('student', 'source.uploaded', { sourceId: source.sourceId })}
                      >
                        Upload the paper
                      </button>
                    )}
                    {!source.saved && (
                      <button
                        className="btn ghost"
                        onClick={() => void write('student', 'source.saved', { sourceId: source.sourceId })}
                      >
                        Save
                      </button>
                    )}
                  </div>
                )}

                {open === source.sourceId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
                    <label className="lbl">
                      <span className="eyebrow">What do you think this shows?</span>
                      <textarea className="field" rows={2} value={interpretation}
                        onChange={(e) => setInterpretation(e.target.value)} />
                    </label>
                    <label className="lbl">
                      <span className="eyebrow">What does it license you to claim, and what not?</span>
                      <textarea className="field" rows={2} value={warrant}
                        onChange={(e) => setWarrant(e.target.value)} />
                    </label>
                    <button className="btn primary" onClick={() => void makeEvidence(source)} disabled={busy}>
                      Create evidence
                    </button>
                    <p className="empty">
                      Both fields are required. The evidence records your reading of the passage, not the
                      paper&rsquo;s abstract.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

const LADDER = [
  { kind: 'reflect', label: 'Reflect it back' },
  { kind: 'ask', label: 'Ask a question' },
  { kind: 'offer_structure', label: 'Offer a structure' },
  { kind: 'offer_sentence_frame', label: 'Offer a sentence frame' },
] as const;

function CoachTab() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const write = useStudio((s) => s.write);
  const busy = useStudio((s) => s.busy);

  const thought = selected === null ? undefined : state.thoughts[selected];
  const rung = selected === null ? 0 : hintLevelFor(state, selected);
  const moves = coachMoves(state);

  const move = async (kind: typeof LADDER[number]['kind'], level: number, body: string): Promise<void> => {
    await write('coach', 'coach.moved', {
      moveId: uuid<MoveId>(), kind, targetObjectId: selected, hintLevel: level as HintLevel, body, flag: null,
    });
  };

  return (
    <>
      <span className="eyebrow">Epistemic coach</span>
      <p className="empty" style={{ marginTop: -6 }}>
        There is no model behind these buttons yet. They exist to exercise the rules the coach will run
        under: it offers moves, it never writes the thought, and support climbs one rung at a time.
      </p>

      {thought === undefined ? (
        <p className="empty">Select a thought first.</p>
      ) : (
        <>
          <div className="chips">
            {LADDER.map((step, i) => (
              <button
                key={step.kind}
                className="chip"
                disabled={busy}
                onClick={() => void move(step.kind, i, `${step.label} on: ${thought.text}`)}
              >
                rung {i} &middot; {step.label}
              </button>
            ))}
          </div>
          <p className="empty">
            Reached rung {rung} on this thought. Asking for rung {rung + 2} or beyond is refused.
          </p>

          <button
            className="btn"
            disabled={busy}
            onClick={() => void write('coach', 'coach.moved', {
              moveId: uuid<MoveId>(), kind: 'challenge', targetObjectId: selected, hintLevel: 0,
              body: 'What alternative explanation could produce the same observation?', flag: null,
            })}
          >
            Challenge this thought
          </button>

          <button
            className="btn"
            style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
            disabled={busy}
            onClick={() => void write('coach', 'thought.created', {
              objectId: uuid<ObjectId>(), versionId: uuid<VersionId>(), type: 'QUESTION',
              text: 'A question the coach wrote on the student’s behalf.',
              note: '', position: { x: 0, y: 0 },
            })}
          >
            Let the coach write a thought
          </button>
          <p className="empty" style={{ marginTop: -6 }}>
            That last one must fail. It is here so the refusal is visible rather than promised.
          </p>
        </>
      )}

      {moves.length > 0 && (
        <div className="thread divide" style={{ paddingTop: 12 }}>
          <span className="eyebrow">Thread</span>
          {moves.slice(-8).map((m) => (
            <div key={m.moveId} className="msg coach">
              <span className="who">{m.kind.replace(/_/g, ' ')} &middot; rung {m.hintLevel}</span>
              {m.body}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ReviewTab() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const drift = useStudio((s) => s.drift);
  const write = useStudio((s) => s.write);
  const role = useStudio((s) => s.role);
  const busy = useStudio((s) => s.busy);

  const [body, setBody] = useState('');
  const snapshots = Object.values(state.snapshots);
  const latest = snapshots[snapshots.length - 1];
  const comments = Object.values(state.comments);

  const submit = async (): Promise<void> => {
    const entries = Object.values(state.thoughts).map((t) => ({
      objectId: t.objectId, versionId: t.currentVersionId,
    }));
    if (entries.length === 0) return;
    await write('student', 'checkpoint.submitted', {
      snapshotId: uuid<SnapshotId>(), assignmentId: null, entries,
    });
  };

  const comment = async (): Promise<void> => {
    if (latest === undefined || selected === null || body.trim() === '') return;
    const frozen = latest.entries.find((e) => e.objectId === selected);
    if (frozen === undefined) return;
    const ok = await write('instructor', 'comment.created', {
      commentId: uuid<CommentId>(), snapshotId: latest.snapshotId,
      objectId: selected, versionId: frozen.versionId, kind: 'question', body: body.trim(),
    });
    if (ok) setBody('');
  };

  return (
    <>
      <span className="eyebrow">Checkpoint</span>
      {latest === undefined ? (
        <>
          <p className="empty">
            Nothing submitted. A checkpoint freezes the version of every object in play. It clones
            nothing, so the student keeps editing the same objects afterwards.
          </p>
          {role === 'student' && (
            <button className="btn primary" onClick={() => void submit()} disabled={busy}>
              Submit a checkpoint
            </button>
          )}
        </>
      ) : (
        <>
          <p className="empty">
            {latest.entries.length} objects frozen at {new Date(latest.at).toLocaleTimeString()}.
            {role === 'student' && ' Submit again after revising to freeze a second time.'}
          </p>
          {role === 'student' && (
            <button className="btn" onClick={() => void submit()} disabled={busy}>
              Submit another checkpoint
            </button>
          )}
        </>
      )}

      {role === 'instructor' && latest !== undefined && (
        <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">Comment on the selected object</span>
          {selected === null ? (
            <p className="empty">Select a thought on the map.</p>
          ) : (
            <>
              <textarea
                className="field" rows={3} value={body}
                placeholder="Ask about the reasoning. You cannot edit the student's text."
                onChange={(e) => setBody(e.target.value)}
              />
              <button className="btn primary" onClick={() => void comment()} disabled={busy || body.trim() === ''}>
                Leave a comment
              </button>
            </>
          )}
        </div>
      )}

      {comments.length > 0 && (
        <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">Feedback</span>
          {comments.map((c) => {
            const d = drift.find((x) => x.commentId === c.commentId);
            const target = state.thoughts[c.objectId];
            return (
              <div key={c.commentId} className="row">
                <div className="hd">
                  <span className="eyebrow">{c.kind.replace(/_/g, ' ')}</span>
                  {d !== undefined && d.stale && (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--brand)' }}>
                      reviewed v{(state.versions[c.objectId] ?? []).findIndex((v) => v.versionId === c.versionId) + 1},
                      now v{(state.versions[c.objectId] ?? []).length}
                    </span>
                  )}
                </div>
                <p style={{ color: 'var(--text)' }}>{c.body}</p>
                {d !== undefined && d.stale && target !== undefined && (
                  <p>
                    <strong>Then.</strong>{' '}
                    {(state.versions[c.objectId] ?? []).find((v) => v.versionId === c.versionId)?.text}
                    <br />
                    <strong>Now.</strong> {target.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
