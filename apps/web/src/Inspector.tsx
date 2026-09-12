import { useEffect, useState } from 'react';
import {
  RELATIONS, THOUGHT_TYPES, canBackEvidence, coachMoves, hintLevelFor, liveThoughts,
  openProposals,
  type CommentId, type ObjectId, type PassageId, type Proposal,
  type Relation, type RelationId, type SnapshotId, type Source, type ThoughtType,
  type VersionId,
} from '@coral/core';
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
  const uploadPaper = useStudio((s) => s.uploadPaper);
  const write = useStudio((s) => s.write);
  const busy = useStudio((s) => s.busy);
  const role = useStudio((s) => s.role);
  const select = useStudio((s) => s.select);

  const [open, setOpen] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState('');
  const [warrant, setWarrant] = useState('');
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState<string | null>(null);

  const lastSearch = useStudio((s) => s.lastSearch);
  const fullTextAvailable = useStudio((s) => s.fullTextAvailable);
  const refreshRetrieval = useStudio((s) => s.refreshRetrieval);
  useEffect(() => { void refreshRetrieval(); }, [refreshRetrieval]);

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          className="field"
          rows={2}
          value={query}
          placeholder="Search terms, or leave empty to search your own question."
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the literature"
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void search(query)} disabled={busy}>
            {busy ? 'Searching\u2026' : 'Search'}
          </button>
          {lastSearch !== null && (
            <span className="empty">
              {lastSearch.added} of {lastSearch.found} added
              {lastSearch.source === 'fixture' && ' \u00b7 offline fixture'}
            </span>
          )}
        </div>
        {lastSearch?.reason !== undefined && (
          <span className="empty" style={{ color: 'var(--brand)' }}>
            Retrieval could not answer, so the built-in fixture did. {lastSearch.reason}
          </span>
        )}
        {lastSearch !== null && lastSearch.offeredButNotHeld > 0 && (
          <span className="empty">
            {lastSearch.offeredButNotHeld} of these are open access somewhere, but the passage is
            not in hand{fullTextAvailable === false && ' (no content key set)'}. They stay at
            abstract level until you upload the paper.
          </span>
        )}
      </div>

      {sources.length === 0 ? (
        <p className="empty">
          Nothing searched yet. Results come back at whatever level we can actually support, and
          only a source with real text can back a claim.
        </p>
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
                      <>
                        <label
                          className="btn"
                          style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
                        >
                          Upload the paper
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            style={{ display: 'none' }}
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file !== undefined) void uploadPaper(source.sourceId, file);
                            }}
                          />
                        </label>
                        <button
                          className="btn ghost"
                          onClick={() => setTyping(typing === source.sourceId ? null : source.sourceId)}
                        >
                          Type a passage
                        </button>
                      </>
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

                {typing === source.sourceId && (
                  <TranscribeForm
                    sourceId={source.sourceId}
                    onDone={() => setTyping(null)}
                  />
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

/**
 * A passage typed from a paper the student holds.
 *
 * The honest path for a library book, a scan with no text layer, or anything
 * that will not extract. It asks for the sentences rather than a summary of
 * them, and for a locator, because a quote nobody can find again is not much
 * better than one that was invented.
 */
function TranscribeForm({ sourceId, onDone }: { sourceId: string; onDone: () => void }) {
  const transcribe = useStudio((s) => s.transcribe);
  const busy = useStudio((s) => s.busy);
  const [text, setText] = useState('');
  const [locator, setLocator] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
      <label className="lbl">
        <span className="eyebrow">The passage, in the paper&rsquo;s words</span>
        <textarea
          className="field"
          rows={4}
          value={text}
          placeholder="Type or paste the sentences exactly as they appear."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="lbl">
        <span className="eyebrow">Where it is</span>
        <input
          className="field"
          value={locator}
          placeholder="p. 9, Results"
          onChange={(e) => setLocator(e.target.value)}
        />
      </label>
      <button
        className="btn primary"
        disabled={busy || text.trim() === '' || locator.trim() === ''}
        onClick={async () => { if (await transcribe(sourceId, text, locator)) onDone(); }}
      >
        Save the passage
      </button>
      <p className="empty">
        Transcribing is you vouching for the text, so it earns the same level as an upload. It is
        recorded as your transcription, not as something retrieved.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CoachTab() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const busy = useStudio((s) => s.busy);
  const ask = useStudio((s) => s.ask);
  const providers = useStudio((s) => s.providers);
  const provider = useStudio((s) => s.provider);
  const setProvider = useStudio((s) => s.setProvider);
  const lastMove = useStudio((s) => s.lastMove);
  const refreshProviders = useStudio((s) => s.refreshProviders);

  useEffect(() => { void refreshProviders(); }, [refreshProviders]);

  const thought = selected === null ? undefined : state.thoughts[selected];
  const rung = selected === null ? 0 : hintLevelFor(state, selected);
  const moves = coachMoves(state);
  const open = openProposals(state);
  const active = providers.find((p) => p.id === provider);

  return (
    <>
      <span className="eyebrow">Epistemic coach</span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {providers.map((p) => (
          <button
            key={p.id}
            className="row"
            aria-current={p.id === provider}
            onClick={() => p.available && setProvider(p.id)}
            disabled={!p.available}
            style={{
              textAlign: 'left', cursor: p.available ? 'pointer' : 'not-allowed',
              opacity: p.available ? 1 : 0.5,
              borderColor: p.id === provider ? 'var(--brand)' : 'var(--border)',
            }}
          >
            <div className="hd">
              <span style={{ fontSize: 13 }}>{p.label}</span>
              <span className="tag {p.available ? 'usable' : 'gated'}"
                    style={{ color: p.available ? 'var(--ext)' : 'var(--text-3)' }}>
                {p.available ? 'ready' : 'not installed'}
              </span>
            </div>
            <p>{p.detail}</p>
          </button>
        ))}
      </div>
      <p className="empty" style={{ marginTop: -4 }}>
        Coral runs no model of its own and stores no key. Moves come from the tool you
        already signed in to, on this machine, and are billed to you by it.
      </p>

      {thought === undefined ? (
        <p className="empty">Select a thought first.</p>
      ) : (
        <>
          <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn primary" disabled={busy}
                    onClick={() => void ask(thought.objectId, {})}>
              {busy ? 'Thinking\u2026' : 'Ask the coach'}
            </button>
            <button className="btn" disabled={busy || rung >= 3}
                    onClick={() => void ask(thought.objectId, { escalate: true })}>
              Give me more help {rung >= 3 ? '(at the top rung)' : `(rung ${rung} \u2192 ${rung + 1})`}
            </button>
            <button className="btn" disabled={busy}
                    onClick={() => void ask(thought.objectId, { argue: true })}>
              Argue with this thought
            </button>
            <p className="empty">
              Support climbs one rung at a time and only when you ask. The coach will not
              write the thought, whichever model is behind it.
            </p>
          </div>

          {lastMove !== null && (
            <div className="row" style={{ borderColor: 'var(--coach)' }}>
              <div className="hd">
                <span className="eyebrow" style={{ color: 'var(--coach)' }}>
                  {lastMove.move.kind.replace(/_/g, ' ')} &middot; rung {lastMove.rung}
                </span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {lastMove.provider}
                </span>
              </div>
              <p style={{ color: 'var(--text)' }}>{lastMove.move.body}</p>
              {lastMove.move.suggestedType !== undefined && (
                <p>Suggests a {lastMove.move.suggestedType.toLowerCase()}
                  {lastMove.move.relation !== undefined && ` (${lastMove.move.relation.replace(/_/g, ' ')})`}.
                  Write it yourself in the Build tab.</p>
              )}
              {lastMove.fellBackFrom !== undefined && (
                <p style={{ color: 'var(--brand)' }}>
                  {lastMove.fellBackFrom} could not answer, so the built-in ladder did. {lastMove.reason}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {open.length > 0 && (
        <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">On the table</span>
          <p className="empty" style={{ marginTop: -4 }}>
            The coach named a kind of thought. Writing it is yours — a suggestion does not
            become a node until you put words in it.
          </p>
          {open.map((p) => <ProposalCard key={p.proposalId} proposal={p} />)}
        </div>
      )}

      {moves.length > 0 && (
        <div className="thread divide" style={{ paddingTop: 12 }}>
          <span className="eyebrow">Thread</span>
          {moves.slice(-6).reverse().map((m) => (
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

/**
 * One proposal, and the two things a student can do with it.
 *
 * The type comes from the coach and the relation defaults to whatever fits the
 * kind, but both the sentence and the final choice of relation are the
 * student's. Accepting is disabled until something is written, and the server
 * refuses an empty accept regardless of what the form allows.
 */
function ProposalCard({ proposal }: { proposal: Proposal }) {
  const state = useStudio((s) => s.state);
  const busy = useStudio((s) => s.busy);
  const accept = useStudio((s) => s.acceptProposal);
  const dismissProposal = useStudio((s) => s.dismissProposal);

  const [text, setText] = useState('');
  const [relation, setRelation] = useState<Relation>(
    proposal.kind === 'challenge' ? 'challenges' : 'suggests',
  );

  const target = proposal.targetObjectId === null
    ? undefined
    : state.thoughts[proposal.targetObjectId];

  return (
    <div className="row" style={{ borderColor: 'var(--coach)' }}>
      <div className="hd">
        <span className="eyebrow" style={{ color: 'var(--coach)' }}>
          {proposal.kind === 'challenge' ? 'objection to answer' : 'suggested branch'}
          {' \u00b7 '}{proposal.suggestedType.toLowerCase()}
        </span>
      </div>
      <p style={{ color: 'var(--text)' }}>{proposal.rationale}</p>
      {target !== undefined && (
        <p style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
          against: {target.text.slice(0, 90)}{target.text.length > 90 ? '\u2026' : ''}
        </p>
      )}

      <textarea
        className="field"
        rows={3}
        value={text}
        placeholder={proposal.kind === 'challenge'
          ? 'Answer the objection in your own words.'
          : `Write the ${proposal.suggestedType.toLowerCase()} yourself.`}
        onChange={(e) => setText(e.target.value)}
        aria-label={`Write the ${proposal.suggestedType.toLowerCase()}`}
      />

      <label className="lbl">
        <span className="eyebrow">How it relates</span>
        <select
          className="field"
          value={relation}
          onChange={(e) => setRelation(e.target.value as Relation)}
        >
          {RELATIONS.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </label>

      <div className="acts">
        <button
          className="btn primary"
          disabled={busy || text.trim() === ''}
          onClick={() => void accept(proposal.proposalId, text, relation)}
        >
          Write it myself
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => void dismissProposal(proposal.proposalId)}
        >
          Not this
        </button>
      </div>
      <span className="empty">
        Declining is recorded too. Nothing is deleted.
      </span>
    </div>
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
