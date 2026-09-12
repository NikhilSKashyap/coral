import { useEffect, useMemo, useState } from 'react';
import {
  REFINEMENT_CHECKS, SPINE, SPINE_RELATION, SPINE_STAGES,
  coachMoves, currentStage, establishedPieces, spineOf, spineProgress,
  type CoachMove, type ObjectId,
} from '@coral/core';
import { useStudio } from './store.js';

/**
 * The framing walk: five stages before the map opens.
 *
 * Everything the coach says here is static copy from the v1 prototype, read out
 * of `SPINE`. No model is in the loop in this slice, which is the point — the
 * ladder either teaches before it costs anything, or it does not teach.
 *
 * The one rule the interface carries on its own is that the next stage's prompt
 * is not shown until the previous stage is written. Everything else is enforced
 * on the write path: the stage order by `spine.order`, the rungs by
 * `assertHintLadder`, and the authorship of every word by `assertAuthorship`.
 */
export default function FramingView() {
  const state = useStudio((s) => s.state);
  const write = useStudio((s) => s.write);
  const writeStage = useStudio((s) => s.writeStage);
  const draftFrame = useStudio((s) => s.draftFrame);
  const ask = useStudio((s) => s.ask);
  const setView = useStudio((s) => s.setView);
  const select = useStudio((s) => s.select);
  const busy = useStudio((s) => s.busy);
  const role = useStudio((s) => s.role);

  const spine = useMemo(() => spineOf(state), [state]);
  const stage = currentStage(state);
  const progress = spineProgress(state);
  const pieces = establishedPieces(state);

  const [draft, setDraft] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => { setDraft(''); }, [stage]);

  const movesFor = (id: ObjectId): CoachMove[] =>
    coachMoves(state).filter((m) => m.targetObjectId === id);

  const save = async (): Promise<void> => {
    if (stage === null || draft.trim() === '') return;
    const ok = await writeStage(stage, draft.trim());
    if (ok) setDraft('');
  };

  if (role !== 'student') {
    return (
      <div className="focus">
        <div className="focuscol">
          <p className="empty">
            The framing walk is the student&apos;s. An instructor sees it once a checkpoint is
            submitted, in the Review tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="focus">
      <div className="focuscol">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ color: 'var(--brand)' }}>Framing</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {progress.written} of {SPINE_STAGES.length} written
            {progress.hintsRequested > 0 && ` · ${progress.hintsRequested} coach moves`}
          </span>
        </div>

        <p className="empty" style={{ maxWidth: '62ch' }}>
          Work down the spine: what you noticed, what you wonder, what is in tension, what is
          unknown, and only then the question. The coach offers the smallest push it can — a
          reflection, then a question, then a structure, then a sentence frame. The move stays
          yours.
        </p>

        {/* --- stages already written ---------------------------------- */}
        {SPINE_STAGES.map((s) => {
          const t = spine[s];
          if (t === undefined) return null;
          const moves = movesFor(t.objectId);
          const rung = moves.reduce((max, m) => Math.max(max, m.hintLevel), 0);
          return (
            <div key={s} className="current">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span className="eyebrow" style={{ color: 'var(--brand)' }}>{s}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ext)' }}>
                  {s === 'NOTICE' ? 'start' : SPINE_RELATION[s].replace(/_/g, ' ')}
                </span>
              </div>

              <p className="bigtext" style={{ margin: 0 }}>{t.text}</p>

              {moves.length > 0 && (
                <div className="thread">
                  {moves.map((m) => (
                    <div key={m.moveId} className="msg coach">
                      <span className="who">coach · {m.kind.replace(/_/g, ' ')} · rung {m.hintLevel + 1}</span>
                      {m.body}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn ghost"
                  disabled={busy || rung >= 3}
                  onClick={() => void ask(t.objectId, { escalate: true, provider: 'static' })}
                  title={rung >= 3 ? 'This is the last rung. There is nothing further to give.' : undefined}
                >
                  {rung >= 3 ? 'No further help' : rung === 2 ? 'Show a sentence frame' : 'More help'}
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void ask(t.objectId, { argue: true, provider: 'static' })}
                >
                  Argue with me
                </button>
                <span className="grow" />
                <button className="btn ghost" onClick={() => { select(t.objectId); setView('focus'); }}>
                  Revise
                </button>
              </div>

              {rung >= 3 && (
                <span className="empty">
                  A frame is the last thing the coach has. The sentence is still yours to finish.
                </span>
              )}
            </div>
          );
        })}

        {/* --- the stage being written now ------------------------------ */}
        {stage !== null && (
          <div className="current" style={{ borderColor: 'var(--brand)' }}>
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>{stage}</span>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {SPINE[stage].guidance}
            </p>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>{SPINE[stage].prompt}</p>
            <textarea
              className="field bigtext"
              rows={3}
              value={draft}
              placeholder={stage === 'NOTICE'
                ? 'It can be incomplete. Start with what you actually think.'
                : 'In your own words.'}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`${stage} text`}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn primary" disabled={busy || draft.trim() === ''} onClick={() => void save()}>
                {stage === 'QUESTION' ? 'Write my question' : `Add this ${stage.toLowerCase()}`}
              </button>
              <span className="empty">{SPINE[stage].next}</span>
            </div>
          </div>
        )}

        {/* --- stages not reached yet ----------------------------------- */}
        {SPINE_STAGES.filter((s) => spine[s] === undefined && s !== stage).map((s) => (
          <div key={s} className="row" style={{ opacity: 0.55 }}>
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>{s}</span>
            <p>{SPINE[s].slot}</p>
          </div>
        ))}

        {/* --- the pieces, while the question is being written ----------- */}
        {stage === 'QUESTION' && pieces.length > 0 && (
          <div className="current">
            <span className="eyebrow">What you have established</span>
            <span className="empty">
              These are your words, listed. Assembling them into a question is the step the coach
              will not take for you.
            </span>
            <div className="rows">
              {pieces.map((p) => (
                <div key={p.objectId} className="row">
                  <span className="eyebrow" style={{ color: 'var(--ext)' }}>{p.label}</span>
                  <p>{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- refinement and the Problem Frame -------------------------- */}
        {stage === null && <Refinement answers={answers} setAnswers={setAnswers} />}

        {stage === null && state.frame === null && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void draftFrame(answers)}
          >
            Assemble the Problem Frame
          </button>
        )}

        {state.frame !== null && (
          <div className="current">
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>Problem Frame</span>
            <span className="empty">
              Assembled from objects that already exist. Every line below is something you wrote.
            </span>
            <p className="bigtext" style={{ margin: 0 }}>{state.frame.question}</p>

            {state.frame.assumptions.length > 0 && (
              <div className="rows">
                {state.frame.assumptions.map((a) => (
                  <div key={a} className="row"><p>{a}</p></div>
                ))}
              </div>
            )}
            {state.frame.assumptions.length === 0 && (
              <span className="empty">
                No refinement answers yet, so the frame has none. A gap here stays a gap.
              </span>
            )}

            {state.frame.acceptedAt === null ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await write('student', 'frame.accepted', {});
                    if (ok) setView('map');
                  }}
                >
                  Accept the frame and open the studio
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => void draftFrame(answers)}>
                  Redraft it
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="empty">
                  Accepted {new Date(state.frame.acceptedAt).toLocaleTimeString()}. The frame is a
                  version, not a verdict — keep editing the question on the map and redraft it.
                </span>
                <span className="grow" />
                <button className="btn" onClick={() => setView('map')}>Open the studio</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The refinement prompts, once a question exists.
 *
 * Reflective prompts, not fields that have to be filled. An unanswered one is
 * left out of the frame rather than guessed at, which is why the copy says so.
 */
function Refinement({
  answers,
  setAnswers,
}: {
  answers: Record<string, string>;
  setAnswers: (next: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="current">
      <span className="eyebrow">Refine the question</span>
      <span className="empty">
        Reflective prompts, not fields you have to fill. Answer the ones that change your question.
      </span>
      <div className="rows">
        {REFINEMENT_CHECKS.map((check) => (
          <div key={check} className="row">
            <button
              style={{ textAlign: 'left', fontSize: 12.5 }}
              onClick={() => setOpen(open === check ? null : check)}
            >
              {check}
              {(answers[check] ?? '').trim() !== '' && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--ext)', marginLeft: 8 }}>
                  answered
                </span>
              )}
            </button>
            {open === check && (
              <textarea
                className="field"
                rows={2}
                value={answers[check] ?? ''}
                placeholder="Think it through here."
                onChange={(e) => setAnswers({ ...answers, [check]: e.target.value })}
                aria-label={check}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
