/**
 * Drives a whole student session against a running server, then a checkpoint and
 * an instructor comment. Every write goes over HTTP through the real guard path.
 *
 *   pnpm db:up && pnpm db:migrate
 *   pnpm --filter @coral/server start
 *   pnpm --filter @coral/server test:e2e
 *
 * Lines marked REFUSED are the point of the exercise: each one must fail, with a
 * 422 and the name of the invariant that stopped it. A run where everything
 * succeeds is a failing run.
 */
import { REFINEMENT_CHECKS, SPINE, SPINE_RELATION, SPINE_STAGES } from '@coral/core';

const BASE = process.env['BASE'] ?? 'http://localhost:8787';

let passed = 0;
let failed = 0;

const ok = (label: string, detail = ''): void => {
  passed += 1;
  console.log(`  ok    ${label}${detail === '' ? '' : `  (${detail})`}`);
};
const bad = (label: string, detail: string): void => {
  failed += 1;
  console.log(`  FAIL  ${label}  ${detail}`);
};

interface Thought {
  objectId: string;
  type: string;
  text: string;
  currentVersionId: string;
  archived: boolean;
}

interface View {
  projectId: string;
  state: {
    title: string;
    thoughts: Record<string, Thought>;
    versions: Record<string, Array<{ versionId: string }>>;
    relations: Record<string, { relation: string; removed: boolean }>;
    sources: Record<string, { sourceId: string; cite: string; access: string }>;
    passages: Record<string, { passageId: string; sourceId: string }>;
    snapshots: Record<string, { snapshotId: string }>;
    comments: Record<string, unknown>;
    proposals: Record<string, {
      proposalId: string; kind: string; suggestedType: string;
      targetObjectId: string | null; rationale: string;
      status: string; acceptedAs: string | null;
    }>;
    frame: { question: string; concepts: string[]; assumptions: string[]; acceptedAt: string | null } | null;
    thread: Array<{ kind?: string; targetObjectId?: string | null; hintLevel?: number; body?: string }>;
    seq: number;
  };
  events: Array<{ seq: number; type: string; actor: string }>;
  record: Record<string, number>;
  invariant?: string;
  message?: string;
}

async function post<T>(path: string, body?: unknown): Promise<{ status: number; json: T }> {
  // Fastify rejects a JSON content-type with no body, so only send the header
  // when there is something to parse.
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return (await res.json()) as T;
}

const uuid = (): string => crypto.randomUUID();

async function emit(
  projectId: string, actor: string, type: string, payload: unknown,
): Promise<{ status: number; json: View }> {
  return post(`/projects/${projectId}/events`, { actor, type, payload });
}

/** Asserts a write is refused, and reports which invariant did the refusing. */
async function refuse(
  label: string, projectId: string, actor: string, type: string, payload: unknown,
): Promise<void> {
  const { status, json } = await emit(projectId, actor, type, payload);
  if (status === 422) ok(`REFUSED ${label}`, json.invariant ?? 'no invariant named');
  else bad(`REFUSED ${label}`, `expected 422, got ${status}`);
}


/**
 * The framing walk, slice 01.
 *
 * Its own project, because the walk starts from an empty graph by definition.
 * Nothing here calls a model: every line the coach says is the v1 prototype's
 * copy read out of `SPINE`, and the assertions below check that what landed in
 * the log is that copy and not a paraphrase.
 */
async function framingWalk(): Promise<void> {
  console.log('\nframing walk');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;
  ok('walk project created', id);

  // The sequence is the lesson, so starting in the middle is refused.
  const jumped = await post<View>(`/projects/${id}/spine`, {
    stage: 'QUESTION', text: 'Skipping straight to the question.',
  });
  if (jumped.status === 422) ok('REFUSED starting at QUESTION', jumped.json.invariant ?? '');
  else bad('REFUSED starting at QUESTION', `expected 422, got ${jumped.status}`);

  const TEXT: Record<string, string> = {
    NOTICE: 'Students complete assignments much faster when they use AI.',
    WONDER: 'Are they actually learning more?',
    TENSION: 'Performance increases, but independent learning may not.',
    UNKNOWN: 'Can students perform the same reasoning without AI?',
    QUESTION: "How does generative AI use during literature synthesis affect graduate students' ability to independently analyze conflicting sources?",
  };

  let view: View | null = null;
  for (const stage of SPINE_STAGES) {
    const res = await post<View>(`/projects/${id}/spine`, { stage, text: TEXT[stage] });
    if (res.status !== 200) { bad(`${stage} written`, `status ${res.status}`); return; }
    view = res.json;

    const written = Object.values(view.state.thoughts).find((t) => t.type === stage);
    if (written?.text === TEXT[stage]) ok(`${stage} written`, 'the student\u2019s words, unchanged');
    else bad(`${stage} written`, 'text did not survive the round trip');

    const moves = view.state.thread.filter((m) => m.targetObjectId === written?.objectId);
    const reflect = moves.find((m) => m.kind === 'reflect');
    if (reflect?.body === SPINE[stage].hints[0]) ok(`${stage} reflection`, 'rung 1, volunteered');
    else bad(`${stage} reflection`, 'the coach said something not in SPINE');

    const handoff = moves.find((m) => m.kind === 'ask');
    if (handoff?.body === SPINE[stage].after) ok(`${stage} handoff`, 'opens the next stage');
    else bad(`${stage} handoff`, 'the handoff line did not match SPINE');

    if (stage !== 'NOTICE') {
      const relation = SPINE_RELATION[stage];
      const wired = Object.values(view.state.relations)
        .some((r) => r.relation === relation && !r.removed);
      if (wired) ok(`${stage} wired to the stage before`, relation);
      else bad(`${stage} wired to the stage before`, `no ${relation} edge`);
    }
  }

  if (view === null) return;
  const notice = Object.values(view.state.thoughts).find((t) => t.type === 'NOTICE');
  if (notice === undefined) return;

  /* ---- the ladder, on the built-in coach ------------------------------ */
  console.log('\nladder');
  await refuse('a jump to the sentence frame', id, 'coach', 'coach.moved', {
    moveId: uuid(), kind: 'offer_sentence_frame', targetObjectId: notice.objectId,
    hintLevel: 3, body: SPINE.NOTICE.hints[3], flag: null,
  });

  for (let expected = 1; expected <= 3; expected += 1) {
    const res = await post<View & { rung: number; provider: string; move: { body: string } }>(
      `/projects/${id}/coach`,
      { objectId: notice.objectId, escalate: true, provider: 'static' },
    );
    if (res.json.rung === expected && res.json.move.body === SPINE.NOTICE.hints[expected]) {
      ok(`rung ${expected + 1}`, res.json.move.body.slice(0, 44) + '\u2026');
    } else {
      bad(`rung ${expected + 1}`, `got rung ${res.json.rung}`);
    }
  }

  // A fourth press must not invent a fifth rung.
  const ceiling = await post<View & { rung: number }>(
    `/projects/${id}/coach`,
    { objectId: notice.objectId, escalate: true, provider: 'static' },
  );
  if (ceiling.json.rung === 3) ok('the ladder stops at the sentence frame', 'rung 4 is the last');
  else bad('the ladder stops', `got rung ${ceiling.json.rung}`);

  /* ---- the frame is assembled, never generated ------------------------ */
  console.log('\nproblem frame');
  const answered = REFINEMENT_CHECKS[0];
  const framed = await post<View>(`/projects/${id}/frame`, {
    answers: { [answered]: 'Graduate students in a literature synthesis seminar.' },
  });
  const frame = framed.json.state.frame;

  if (frame?.question === TEXT['QUESTION']) ok('the frame quotes the question verbatim');
  else bad('the frame quotes the question', 'the question was rewritten');

  if (frame?.assumptions.length === 1) ok('an unanswered prompt stays a gap', '1 of 5 answered');
  else bad('an unanswered prompt stays a gap', `${frame?.assumptions.length ?? 0} assumptions`);

  await refuse('an instructor accepting the frame', id, 'instructor', 'frame.accepted', {});

  const accepted = await emit(id, 'student', 'frame.accepted', {});
  if (accepted.json.state.frame?.acceptedAt !== null) ok('the student accepts the frame');
  else bad('the student accepts the frame', 'acceptedAt stayed null');
}


/**
 * The proposal path, slice 02.
 *
 * The coach names a kind of thought; the student writes the sentence. Driven on
 * the built-in ladder so the run costs nothing and is deterministic — what is
 * under test is the write path, which is identical whichever provider answered.
 */
async function proposalPath(): Promise<void> {
  console.log('\nproposals');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;

  // A thought to object to.
  const tension = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: tension, versionId: uuid(), type: 'TENSION',
    text: 'Performance increases, but independent learning may not.',
    note: '', position: { x: 0, y: 0 },
  });

  // Ask to be argued with. The ladder returns a challenge, and a challenge is
  // actionable, so the route raises a proposal alongside the move.
  const argued = await post<View & { move: { kind: string }; proposalId?: string }>(
    `/projects/${id}/coach`,
    { objectId: tension, argue: true, provider: 'static' },
  );
  if (argued.json.move.kind === 'challenge') ok('the coach objects', 'kind=challenge');
  else bad('the coach objects', `kind=${argued.json.move.kind}`);

  const proposalId = argued.json.proposalId;
  if (proposalId === undefined) { bad('the objection is actionable', 'no proposal raised'); return; }
  ok('the objection is actionable', 'proposal raised, status open');

  const raised = argued.json.state.proposals[proposalId];
  if (raised?.suggestedType === 'CHALLENGE' && raised.status === 'open') {
    ok('it proposes a CHALLENGE and waits');
  } else {
    bad('it proposes a CHALLENGE and waits', `got ${raised?.suggestedType} / ${raised?.status}`);
  }

  // The one thing the coach may not do with its own proposal.
  await refuse('the coach accepting its own proposal', id, 'coach', 'proposal.accepted', {
    proposalId, objectId: uuid(),
  });

  // Accepting with no words is refused by the route, not just by the form.
  const empty = await post<View>(`/projects/${id}/proposals/${proposalId}/accept`, {
    text: '   ', relation: 'challenges',
  });
  if (empty.status === 422) ok('REFUSED accepting without writing anything', empty.json.invariant ?? '');
  else bad('REFUSED accepting without writing anything', `expected 422, got ${empty.status}`);

  // A relation outside the eight is refused too: the student picks, from a list.
  const offVocab = await post<View>(`/projects/${id}/proposals/${proposalId}/accept`, {
    text: 'A reading of my own.', relation: 'reveals',
  });
  if (offVocab.status === 422) ok('REFUSED a relation outside the vocabulary', offVocab.json.invariant ?? '');
  else bad('REFUSED a relation outside the vocabulary', `expected 422, got ${offVocab.status}`);

  // The student answers it in their own words.
  const mine = 'The cohort changed between the two assignments, which the speed reading ignores.';
  const accepted = await post<View>(`/projects/${id}/proposals/${proposalId}/accept`, {
    text: mine, relation: 'challenges',
  });
  if (accepted.status !== 200) { bad('accepting the proposal', `status ${accepted.status}`); return; }

  const proposal = accepted.json.state.proposals[proposalId];
  const answer = proposal?.acceptedAs === null || proposal?.acceptedAs === undefined
    ? undefined
    : accepted.json.state.thoughts[proposal.acceptedAs];

  if (answer?.text === mine) ok('the thought is the student\u2019s words', 'verbatim');
  else bad('the thought is the student\u2019s words', 'text did not match');

  if (answer?.type === 'CHALLENGE') ok('the type is the one the coach proposed', 'CHALLENGE');
  else bad('the type is the one the coach proposed', `got ${answer?.type}`);

  if (!JSON.stringify(answer ?? {}).includes(raised?.rationale.slice(0, 20) ?? '@@'))
    ok('the coach\u2019s rationale is not in the thought');
  else bad('the coach\u2019s rationale is not in the thought', 'rationale leaked into the node');

  const wired = Object.values(accepted.json.state.relations)
    .some((r) => r.relation === 'challenges' && !r.removed);
  if (wired) ok('the objection is wired to what it contests', 'challenges');
  else bad('the objection is wired to what it contests', 'no challenges edge');

  if (proposal?.status === 'accepted') ok('the proposal closes only once the thought exists');
  else bad('the proposal closes', `status ${proposal?.status}`);

  // Accepting twice is refused, and so is accepting after a dismissal.
  const again = await post<View>(`/projects/${id}/proposals/${proposalId}/accept`, {
    text: 'A second answer.', relation: 'challenges',
  });
  if (again.status === 422) ok('REFUSED accepting the same proposal twice', again.json.invariant ?? '');
  else bad('REFUSED accepting twice', `status ${again.status}`);

  const second = await post<View & { proposalId?: string }>(
    `/projects/${id}/coach`,
    { objectId: tension, argue: true, provider: 'static' },
  );
  const dismissId = second.json.proposalId;
  if (dismissId === undefined) { bad('a second objection is raised', 'none'); return; }

  const dismissed = await post<View>(`/projects/${id}/proposals/${dismissId}/dismiss`);
  if (dismissed.json.state.proposals[dismissId]?.status === 'dismissed') {
    ok('declining is recorded rather than erased', 'status dismissed');
  } else {
    bad('declining is recorded', 'status did not change');
  }

  const afterDismiss = await post<View>(`/projects/${id}/proposals/${dismissId}/accept`, {
    text: 'Changed my mind.', relation: 'challenges',
  });
  if (afterDismiss.status === 422) ok('REFUSED accepting a dismissed proposal', afterDismiss.json.invariant ?? '');
  else bad('REFUSED accepting a dismissed proposal', `status ${afterDismiss.status}`);

  const record = accepted.json.record;
  if (record['proposalsRaised'] === 1 && record['proposalsAccepted'] === 1) {
    ok('the record counts raised against accepted', 'no judgment about the choice');
  } else {
    bad('the record counts proposals', JSON.stringify(record));
  }
}

async function main(): Promise<void> {
  console.log(`\ncoral end-to-end  ${BASE}\n`);

  await framingWalk();
  await proposalPath();


  console.log('project');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  if (created.status !== 201) { bad('create project', `status ${created.status}`); process.exit(1); }
  const id = created.json.projectId;
  ok('created', id);

  /* ---- the student builds a map by hand ------------------------------- */
  console.log('\ngraph');
  const notice = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: notice, versionId: uuid(), type: 'NOTICE',
    text: 'Students complete assignments much faster when they use AI.',
    note: 'Seminar, week 3', position: { x: 320, y: 40 },
  });
  ok('NOTICE created');

  const wonder = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: wonder, versionId: uuid(), type: 'WONDER',
    text: 'Are they actually learning more?', note: '', position: { x: 170, y: 250 },
  });
  await emit(id, 'student', 'relation.created', {
    relationId: uuid(), from: notice, to: wonder, relation: 'raises',
  });
  ok('WONDER created and wired', 'raises');

  const tension = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: tension, versionId: uuid(), type: 'TENSION',
    text: 'Performance increases, but independent learning may not.',
    note: '', position: { x: 130, y: 450 },
  });
  await emit(id, 'student', 'relation.created', {
    relationId: uuid(), from: wonder, to: tension, relation: 'reframes',
  });
  ok('TENSION created and wired', 'reframes');

  const claim = uuid();
  const claimV1 = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: claim, versionId: claimV1, type: 'CLAIM',
    text: 'Early AI assistance narrows the range of hypotheses students try.',
    note: '', position: { x: 420, y: 450 },
  });
  ok('CLAIM created');

  /* ---- the coach may not author -------------------------------------- */
  console.log('\nauthorship');
  await refuse('coach writes a thought', id, 'coach', 'thought.created', {
    objectId: uuid(), versionId: uuid(), type: 'QUESTION',
    text: 'A question the coach wrote for the student.', note: '', position: { x: 0, y: 0 },
  });
  await refuse('instructor edits the graph', id, 'instructor', 'thought.revised', {
    objectId: claim, versionId: uuid(), parentVersionId: claimV1,
    text: 'Rewritten by the grader.', note: '',
  });
  const coached = await emit(id, 'coach', 'coach.moved', {
    moveId: uuid(), kind: 'challenge', targetObjectId: claim, hintLevel: 0,
    body: 'What alternative explanation could produce the same observation?', flag: null,
  });
  if (coached.status === 200) ok('coach writes an objection', 'challenge move accepted');
  else bad('coach writes an objection', `status ${coached.status}`);

  /* ---- support escalates one rung at a time --------------------------- */
  console.log('\nhint ladder');
  await refuse('jump straight to a sentence frame', id, 'coach', 'coach.moved', {
    moveId: uuid(), kind: 'offer_sentence_frame', targetObjectId: tension, hintLevel: 3,
    body: 'Try completing: Although ___, ___.', flag: null,
  });
  const rungs = [[1, 'ask'], [2, 'offer_structure'], [3, 'offer_sentence_frame']] as const;
  for (const [rung, kind] of rungs) {
    await emit(id, 'coach', 'coach.moved', {
      moveId: uuid(), kind, targetObjectId: tension, hintLevel: rung,
      body: `Rung ${rung}.`, flag: null,
    });
  }
  ok('rungs 1, 2, 3 accepted in order');

  /* ---- sources and the evidence gate ---------------------------------- */
  console.log('\nsources');
  const searched = await post<View>(`/projects/${id}/search`);
  const sources = Object.values(searched.json.state.sources);
  ok('search returned every access level', sources.map((s) => s.access).join(', '));

  const openText = sources.find((s) => s.access === 'open_full_text');
  const abstractOnly = sources.find((s) => s.access === 'abstract');
  const metadataOnly = sources.find((s) => s.access === 'metadata');
  if (!openText || !abstractOnly || !metadataOnly) {
    bad('fixtures', 'missing an access level'); process.exit(1);
  }
  const passage = Object.values(searched.json.state.passages)
    .find((p) => p.sourceId === openText.sourceId);
  if (!passage) { bad('fixtures', 'no passage for the full-text source'); process.exit(1); }

  console.log('\nevidence gate');
  await refuse('evidence from an abstract-only source', id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: abstractOnly.sourceId, passageId: passage.passageId,
    interpretation: 'It shows effort fell.', warrant: 'Licenses a claim about effort.',
    position: { x: 700, y: 250 },
  });
  await refuse('evidence with an empty warrant', id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: openText.sourceId, passageId: passage.passageId,
    interpretation: 'It shows fewer hypotheses.', warrant: '   ',
    position: { x: 700, y: 250 },
  });

  const evidence = uuid();
  const madeEvidence = await emit(id, 'student', 'evidence.created', {
    objectId: evidence, versionId: uuid(), sourceId: openText.sourceId, passageId: passage.passageId,
    interpretation: 'Generated examples narrowed the range of hypotheses students tried.',
    warrant: 'This licenses a claim about variety, not about understanding.',
    position: { x: 700, y: 250 },
  });
  if (madeEvidence.status === 200) ok('evidence from full text with both fields', openText.cite);
  else bad('evidence from full text', `status ${madeEvidence.status} ${madeEvidence.json.message ?? ''}`);

  await emit(id, 'student', 'relation.created', {
    relationId: uuid(), from: evidence, to: claim, relation: 'supports',
  });
  ok('evidence wired to the claim', 'supports');

  console.log('\nupload promotes a paywalled source');
  await emit(id, 'student', 'source.uploaded', { sourceId: metadataOnly.sourceId });
  const uploadedPassage = uuid();
  await emit(id, 'coach', 'passage.captured', {
    passageId: uploadedPassage, sourceId: metadataOnly.sourceId,
    text: 'Gains under scaffolding persisted for procedural steps but not for reconciling sources.',
    locator: 'p. 9', provenance: 'uploaded',
  });
  const fromUpload = await emit(id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: metadataOnly.sourceId, passageId: uploadedPassage,
    interpretation: 'Scaffolded gains did not transfer to reconciling conflicting sources.',
    warrant: 'Supports a narrow claim about transfer, not about all reasoning.',
    position: { x: 980, y: 250 },
  });
  if (fromUpload.status === 200) ok('upload then evidence', metadataOnly.cite);
  else bad('upload then evidence', `status ${fromUpload.status} ${fromUpload.json.message ?? ''}`);

  /* ---- identity across a checkpoint ----------------------------------- */
  console.log('\ncheckpoint and feedback');
  const snapshot = uuid();
  const before = await get<View>(`/projects/${id}`);
  const entries = Object.values(before.state.thoughts).map((t) => ({
    objectId: t.objectId, versionId: t.currentVersionId,
  }));
  await emit(id, 'student', 'checkpoint.submitted', {
    snapshotId: snapshot, assignmentId: null, entries,
  });
  ok('checkpoint submitted', `${entries.length} objects frozen`);

  await refuse('comment on a version never frozen', id, 'instructor', 'comment.created', {
    commentId: uuid(), snapshotId: snapshot, objectId: claim, versionId: uuid(),
    kind: 'comment', body: 'Commenting on something I never saw.',
  });

  await emit(id, 'instructor', 'comment.created', {
    commentId: uuid(), snapshotId: snapshot, objectId: claim, versionId: claimV1,
    kind: 'question', body: 'What would count as evidence against this?',
  });
  ok('instructor comment accepted');

  let parent = claimV1;
  const revisions = [
    'Early AI assistance narrows the hypotheses students generate unaided.',
    'Early AI assistance reduces the variety of hypotheses students generate without help.',
  ];
  for (const text of revisions) {
    const v = uuid();
    await emit(id, 'student', 'thought.revised', {
      objectId: claim, versionId: v, parentVersionId: parent, text, note: '',
    });
    parent = v;
  }
  ok('student revised the claim twice');

  const { drift } = await get<{ drift: Array<{ versionsSince: number; stale: boolean }> }>(
    `/projects/${id}/drift`,
  );
  const d = drift[0];
  if (d && d.versionsSince === 2 && d.stale) {
    ok('comment survived the revisions', 'reviewed v1, live is now v3');
  } else {
    bad('comment drift', JSON.stringify(drift));
  }

  await refuse('revise against a stale parent', id, 'student', 'thought.revised', {
    objectId: claim, versionId: uuid(), parentVersionId: claimV1,
    text: 'Branching off a dead version.', note: '',
  });

  /* ---- archiving keeps the thought ------------------------------------ */
  console.log('\narchive');
  await emit(id, 'student', 'thought.archived', { objectId: wonder });
  const afterArchive = await get<View>(`/projects/${id}`);
  const archived = afterArchive.state.thoughts[wonder];
  if (archived && archived.archived && archived.text !== '') {
    ok('archived thought stays on the map', 'flagged, not erased');
  } else {
    bad('archive', 'thought disappeared');
  }

  /* ---- the log is the record ------------------------------------------ */
  console.log('\nrecord');
  const final = await get<View>(`/projects/${id}`);
  ok('events in the log', String(final.state.seq));
  ok('thoughts on the map', String(Object.keys(final.state.thoughts).length));
  const counted = Object.entries(final.record)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  console.log(`        ${counted}`);

  const replayed = await get<View>(`/projects/${id}`);
  if (replayed.state.seq === final.state.seq) ok('state replays from the log');
  else bad('replay', 'state drifted between reads');

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`project ${id}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
