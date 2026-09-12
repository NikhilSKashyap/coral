import { useEffect, useState } from 'react';
import {
  RELATIONS, THOUGHT_TYPES, canBackEvidence, coachMoves, diffSinceReview, evidencePanel,
  hintLevelFor, liveThoughts, openProposals, thinkingTimeline,
  type CommentId, type ObjectId, type PassageId, type Proposal,
  type Relation, type RelationId, type SnapshotId, type Source, type ThoughtType,
  type VersionId,
} from '@coral/core';
import { Diff } from './FocusView.js';
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
            Counts of things that happened. No score, no judgment about the student. Open any
            figure to see the objects behind it.
          </p>
          <EvidencePanel />
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

        {/*
          A spent content budget looks exactly like a closed paper unless it is
          said out loud, and those are very different things.
        */}
        {lastSearch?.fullTextReason !== undefined && (
          <span className="empty" style={{ color: 'var(--brand)' }}>
            Full text was offered but could not be fetched: {lastSearch.fullTextReason}
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
  const detect = useStudio((s) => s.detect);
  const lastDetection = useStudio((s) => s.lastDetection);
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
            <button className="btn" disabled={busy} onClick={() => void detect()}>
              Which of these read as claims?
            </button>
            {lastDetection !== null && (
              <span className="empty">
                {lastDetection.raised === 0
                  ? 'Nothing new reads as a claim right now.'
                  : `${lastDetection.raised} on the table.`}
                {lastDetection.skipped > 0 && ` ${lastDetection.skipped} already ruled on.`}
                {lastDetection.fellBackFrom !== undefined
                  && ` ${lastDetection.fellBackFrom} could not classify, so the built-in reading did.`}
              </span>
            )}
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

  const detected = proposal.kind === 'claim';
  const target = proposal.targetObjectId === null
    ? undefined
    : state.thoughts[proposal.targetObjectId];

  const [text, setText] = useState('');
  const [revising, setRevising] = useState(false);
  const [relation, setRelation] = useState<Relation>(
    proposal.kind === 'challenge' ? 'challenges' : 'suggests',
  );

  const label = detected
    ? `reads as a ${proposal.suggestedType.toLowerCase()}`
    : proposal.kind === 'challenge' ? 'objection to answer' : 'suggested branch';

  return (
    <div className="row" style={{ borderColor: 'var(--coach)' }}>
      <div className="hd">
        <span className="eyebrow" style={{ color: 'var(--coach)' }}>
          {label}
          {!detected && ` \u00b7 ${proposal.suggestedType.toLowerCase()}`}
        </span>
      </div>
      <p style={{ color: 'var(--text)' }}>{proposal.rationale}</p>

      {target !== undefined && (
        <p style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
          {detected ? 'your ' : 'against: '}
          {detected && <span className="mono">{target.type.toLowerCase()}</span>}
          {detected ? ' \u2014 ' : ''}
          {target.text.slice(0, 90)}{target.text.length > 90 ? '\u2026' : ''}
        </p>
      )}

      {/*
        A detected claim is a reading of words that are already the student's, so
        accepting it asks for a decision rather than for a sentence. The two
        branches below are the whole difference between the kinds.
      */}
      {detected ? (
        <>
          {revising && (
            <textarea
              className="field"
              rows={3}
              value={text}
              placeholder="Sharpen it first, if you want to."
              onChange={(e) => setText(e.target.value)}
              aria-label="Revise before accepting"
            />
          )}
          <div className="acts">
            <button
              className="btn primary"
              disabled={busy || (revising && text.trim() === '')}
              onClick={() => void accept(
                proposal.proposalId,
                revising ? { text } : {},
              )}
            >
              {revising ? 'Revise and call it a claim' : `Yes, it\u2019s a ${proposal.suggestedType.toLowerCase()}`}
            </button>
            {!revising && (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => { setText(target?.text ?? ''); setRevising(true); }}
              >
                Revise it first
              </button>
            )}
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => void dismissProposal(proposal.proposalId)}
            >
              Not this
            </button>
          </div>
          <span className="empty">
            Your words do not change unless you change them. This only says what kind of thought
            it is, and it keeps the same identity and history.
          </span>
        </>
      ) : (
        <>
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
              onClick={() => void accept(proposal.proposalId, { text, relation })}
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
        </>
      )}
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
  const projectId = useStudio((s) => s.projectId);
  const assignments = useStudio((s) => s.assignments);
  const progress = useStudio((s) => s.progress);
  const refreshCourse = useStudio((s) => s.refreshCourse);
  const attach = useStudio((s) => s.attach);
  const resolveComment = useStudio((s) => s.resolveComment);

  useEffect(() => { void refreshCourse(); }, [refreshCourse, state.seq]);

  const mine = progress.find((p) => p.projectId === projectId);
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

      {/*
        What the assignment asks for, against what the map shows. Every line is
        a count; none of them is a mark. The lane breakdown is deliberate that an
        instructor sees checkpoint-level progress and nothing finer, so this is
        the same figure a student can see about their own work.
      */}
      {mine !== undefined && mine.requirements.length > 0 && (
        <div className="rows">
          <span className="eyebrow" style={{ color: 'var(--text-3)' }}>
            {mine.requirementsMet ? 'what the assignment asks for · all met' : 'what the assignment asks for'}
          </span>
          {mine.requirements.map((check) => (
            <div key={check.id} className="row">
              <div className="hd">
                <span style={{ fontSize: 12.5 }}>{check.label}</span>
                <span
                  className="tag"
                  style={{ color: check.met ? 'var(--ext)' : 'var(--text-3)' }}
                >
                  {check.met ? 'met' : 'not yet'}
                </span>
              </div>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      )}

      {role === 'instructor' && (
        <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">Thinking evolution</span>
          <p className="empty" style={{ marginTop: -4 }}>
            What the student did, in order. The coach&rsquo;s own moves are left out: this is a
            record of their work, not of what they were told.
          </p>
          <Timeline />
        </div>
      )}

      {role === 'instructor' && (
        <CourseBlock
          assignments={assignments}
          attached={mine !== undefined}
          onAttach={(id) => void attach(id)}
        />
      )}
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
            {latest.entries.length} object{latest.entries.length === 1 ? '' : 's'} frozen at{' '}
            {new Date(latest.at).toLocaleTimeString()}.
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
                {/*
                  The loop back. A student closes a comment by naming the version
                  that answers it, and the server refuses one that is not newer
                  than the version the instructor read — so this cannot become a
                  dismiss button.
                */}
                {c.resolvedByVersionId === null && role === 'student' && target !== undefined && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      disabled={busy || d === undefined || !d.stale}
                      onClick={() => void resolveComment(c.commentId, target.currentVersionId)}
                      title={d?.stale === true
                        ? 'Close this with the version you have written since'
                        : 'Revise the thought first; a comment is closed by a revision'}
                    >
                      {d?.stale === true ? 'I have addressed this' : 'Revise it first'}
                    </button>
                    {d?.stale !== true && (
                      <span className="empty">
                        A comment is closed by a revision, not by agreeing with it.
                      </span>
                    )}
                  </div>
                )}
                {c.resolvedByVersionId !== null && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ext)' }}>
                    resolved at v{(state.versions[c.objectId] ?? [])
                      .findIndex((v) => v.versionId === c.resolvedByVersionId) + 1}
                  </span>
                )}

                {/*
                  The comparison the identity-versus-version split has owed since
                  slice 00. Not "3 revisions since" but the words that moved
                  between what the instructor read and what is live now.
                */}
                {d !== undefined && d.stale && target !== undefined && (() => {
                  const review = diffSinceReview(state, c.objectId, c.versionId as VersionId);
                  if (review === undefined) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="eyebrow" style={{ color: 'var(--text-3)' }}>
                        what changed since it was read
                        {review.summary.rewritten
                          ? ' \u00b7 rewritten'
                          : ` \u00b7 +${review.summary.added} \u2212${review.summary.removed}`}
                      </span>
                      <Diff spans={review.diff} />
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Assignment authoring, and attaching this project to one.
 *
 * Small on purpose. An assignment is three requirements and some instructions;
 * everything else an instructor wants to know is a count the dashboard already
 * reports, and there is nowhere here to enter a mark.
 */
function CourseBlock({
  assignments,
  attached,
  onAttach,
}: {
  assignments: Array<{ assignmentId: string; title: string; requirements: { sources: number; counterArgument: boolean; aiProvenance: boolean } }>;
  attached: boolean;
  onAttach: (id: string | null) => void;
}) {
  const newAssignment = useStudio((s) => s.newAssignment);
  const busy = useStudio((s) => s.busy);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [sources, setSources] = useState(2);
  const [counter, setCounter] = useState(true);

  return (
    <div className="divide" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="eyebrow">Assignment</span>

      {assignments.length > 0 && (
        <label className="lbl">
          <span className="eyebrow">This project answers</span>
          <select
            className="field"
            defaultValue=""
            onChange={(e) => onAttach(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{attached ? 'Not attached' : 'Choose an assignment'}</option>
            {assignments.map((a) => (
              <option key={a.assignmentId} value={a.assignmentId}>{a.title}</option>
            ))}
          </select>
        </label>
      )}

      {open ? (
        <>
          <input
            className="field"
            value={title}
            placeholder="Literature synthesis, checkpoint 1"
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Assignment title"
          />
          <textarea
            className="field"
            rows={2}
            value={instructions}
            placeholder="What you are asking them to do."
            onChange={(e) => setInstructions(e.target.value)}
            aria-label="Instructions"
          />
          <label className="lbl">
            <span className="eyebrow">Sources that must be cited</span>
            <input
              className="field"
              type="number"
              min={0}
              value={sources}
              onChange={(e) => setSources(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <input type="checkbox" checked={counter} onChange={(e) => setCounter(e.target.checked)} />
            Require a counter-argument
          </label>
          <p className="empty">
            The AI provenance record is always attached. Coral records what prompted every write
            as it happens, so there is nothing for a student to remember.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn primary"
              disabled={busy || title.trim() === ''}
              onClick={async () => {
                await newAssignment({
                  title: title.trim(),
                  instructions: instructions.trim(),
                  requirements: { sources, counterArgument: counter, aiProvenance: true },
                });
                setOpen(false); setTitle(''); setInstructions('');
              }}
            >
              Create and publish
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <button className="btn ghost" onClick={() => setOpen(true)}>New assignment</button>
      )}
    </div>
  );
}

/**
 * The instructor's evidence panel.
 *
 * A number nobody can open is a score with extra steps, so every figure here
 * expands to the objects behind it and every object opens. The note under each
 * one says what is being counted, because a count without its definition is an
 * impression.
 */
function EvidencePanel() {
  const state = useStudio((s) => s.state);
  const events = useStudio((s) => s.events);
  const select = useStudio((s) => s.select);
  const setView = useStudio((s) => s.setView);

  const [open, setOpen] = useState<string | null>(null);
  const panel = evidencePanel(state, events);

  return (
    <div className="rows">
      {panel.map((item) => {
        const openable = item.objectIds.length > 0 || item.sourceIds.length > 0;
        return (
          <div key={item.id} className="row">
            <button
              className="hd"
              style={{ width: '100%', textAlign: 'left', cursor: openable ? 'pointer' : 'default' }}
              onClick={() => openable && setOpen(open === item.id ? null : item.id)}
            >
              <span style={{ fontSize: 12.5 }}>{item.label}</span>
              <span
                className="mono"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: item.value > 0 ? 'var(--text)' : 'var(--text-3)',
                }}
              >
                {item.value}
              </span>
            </button>

            {open === item.id && (
              <>
                <p style={{ color: 'var(--text-3)' }}>{item.note}</p>
                {item.objectIds.map((objectId) => {
                  const thought = state.thoughts[objectId];
                  if (thought === undefined) return null;
                  return (
                    <button
                      key={objectId}
                      style={{ textAlign: 'left', fontSize: 12, display: 'block', width: '100%' }}
                      onClick={() => { select(objectId); setView('focus'); }}
                    >
                      <span className="eyebrow" style={{ color: 'var(--ext)', marginRight: 6 }}>
                        {thought.type.toLowerCase()}
                      </span>
                      {thought.text.slice(0, 72)}{thought.text.length > 72 ? '…' : ''}
                    </button>
                  );
                })}
                {item.sourceIds.map((sourceId) => (
                  <p key={sourceId} style={{ fontSize: 12 }}>
                    <span className="eyebrow" style={{ color: 'var(--ext)', marginRight: 6 }}>source</span>
                    {state.sources[sourceId]?.cite ?? sourceId}
                  </p>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * How the reasoning moved, in order.
 *
 * Kept to the events that changed the shape of the argument. The coach's own
 * moves are deliberately absent: a timeline padded with prompts reads as a
 * record of what the student was told rather than what they did.
 */
export function Timeline() {
  const state = useStudio((s) => s.state);
  const events = useStudio((s) => s.events);
  const select = useStudio((s) => s.select);
  const setView = useStudio((s) => s.setView);

  const milestones = thinkingTimeline(state, events);
  if (milestones.length === 0) {
    return <p className="empty">Nothing has changed the shape of the argument yet.</p>;
  }

  return (
    <div className="spine">
      {milestones.map((m) => (
        <div key={`${String(m.seq)}-${m.kind}`} className="row">
          <div className="hd">
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>{m.kind}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {new Date(m.at).toLocaleTimeString()}
            </span>
          </div>
          <p style={{ color: 'var(--text-2)' }}>{m.label}</p>
          {m.quote !== null && (
            m.objectId === null ? (
              <p style={{ fontSize: 12.5 }}>&ldquo;{m.quote}&rdquo;</p>
            ) : (
              <button
                style={{ textAlign: 'left', fontSize: 12.5, display: 'block', width: '100%' }}
                onClick={() => { select(m.objectId as ObjectId); setView('focus'); }}
              >
                &ldquo;{m.quote.slice(0, 110)}{m.quote.length > 110 ? '…' : ''}&rdquo;
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
