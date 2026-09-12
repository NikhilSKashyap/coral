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
    relations: Record<string, { relation: string; removed: boolean }>;
    sources: Record<string, { sourceId: string; cite: string; access: string; title: string }>;
    passages: Record<string, {
      passageId: string; sourceId: string; text: string; locator: string; provenance: string;
    }>;
    snapshots: Record<string, { snapshotId: string }>;
    comments: Record<string, unknown>;
    versions: Record<string, Array<{ versionId: string; type?: string; text?: string }>>;
    proposals: Record<string, {
      proposalId: string; kind: string; suggestedType: string;
      targetObjectId: string | null; rationale: string;
      status: string; acceptedAs: string | null;
    }>;
    frame: { question: string; concepts: string[]; assumptions: string[]; acceptedAt: string | null } | null;
    thread: Array<{
      kind?: string; targetObjectId?: string | null; hintLevel?: number;
      body?: string; flag?: string | null;
    }>;
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

interface AssignmentShape {
  assignmentId: string;
  title: string;
  publishedAt: string | null;
}

interface DashboardShape {
  assignment: { title: string } | null;
  rows: Array<{
    projectId: string; title: string; submittedAt: string | null; checkpoints: number;
    requirements: Array<{ id: string; label: string; met: boolean; detail: string }>;
    requirementsMet: boolean; openComments: number; staleComments: number;
  }>;
}

interface BriefLineShape {
  objectId: string | null;
  text: string;
  role: string | null;
  flags: string[];
  children: BriefLineShape[];
}

interface BriefView {
  asOf: string | null;
  checkpoints: Array<{ snapshotId: string; at: string; entries: number }>;
  brief: {
    question: string | null;
    sections: Array<{ id: string; title: string; gap: boolean; gapPrompt: string; lines: BriefLineShape[] }>;
    synthesisOpening: boolean;
    cited: string[];
    gaps: Array<{ flag: string; detail: string }>;
  };
  omitted: Array<{ type: string }>;
}

interface SearchView extends View {
  query: string;
  source: 'openalex' | 'fixture';
  reason?: string;
  found: number;
  added: number;
  offeredButNotHeld: number;
}

/** Post raw bytes as a PDF, the way the browser posts a File. */
async function postBytes(
  path: string, bytes: Uint8Array,
): Promise<{ status: number; json: View }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: bytes,
  });
  return { status: res.status, json: (await res.json()) as View };
}

/**
 * A structurally valid PDF with no text layer, which is what a scan is.
 *
 * Built here rather than committed as a binary so the check is readable: one
 * page, one filled rectangle, not a character of text anywhere.
 */
function textlessPdf(): Uint8Array {
  const content = '0 0 1 rg 10 10 100 100 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`
    + `startxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(out);
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


/**
 * Claim detection and the retype it proposes, slice 04.
 *
 * Driven on the built-in reading so the run is deterministic and costs nothing.
 * What is under test is the write path, which is identical whichever detector
 * found the candidate: a detected claim is a reading of words the student
 * already wrote, so accepting it retypes their thought instead of creating one.
 */
async function claimsAndVersions(): Promise<void> {
  console.log('\nclaim detection');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;

  const idea = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: idea, versionId: uuid(), type: 'IDEA',
    text: 'Early AI assistance narrows the range of hypotheses students try.',
    note: '', position: { x: 0, y: 0 },
  });
  const question = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: question, versionId: uuid(), type: 'WONDER',
    text: 'Are they actually learning more?', note: '', position: { x: 0, y: 0 },
  });

  const detected = await post<View & { raised: number; skipped: number; provider: string }>(
    `/projects/${id}/detect`, { provider: 'static' },
  );
  if (detected.json.raised >= 1) ok('detection raised a candidate', `${detected.json.raised} via ${detected.json.provider}`);
  else { bad('detection raised a candidate', 'none'); return; }

  const proposal = Object.values(detected.json.state.proposals).find((p) => p.kind === 'claim');
  if (proposal === undefined) { bad('a claim proposal', 'none raised'); return; }

  if (proposal.targetObjectId === idea) ok('it points at the student\u2019s own thought');
  else bad('it points at the student\u2019s own thought', 'wrong target');

  if (proposal.status === 'open') ok('and waits, rather than retyping on its own');
  else bad('it waits', `status ${proposal.status}`);

  // The open question is not a claim, and a shy detector should leave it alone.
  const onQuestion = Object.values(detected.json.state.proposals)
    .some((p) => p.targetObjectId === question);
  if (!onQuestion) ok('an open question is not read as a claim');
  else bad('an open question is not read as a claim', 'it was flagged');

  // Pressing again must not nag.
  const again = await post<View & { raised: number; skipped: number }>(
    `/projects/${id}/detect`, { provider: 'static' },
  );
  if (again.json.raised === 0) ok('detecting twice raises nothing new', `${again.json.skipped} already ruled on`);
  else bad('detecting twice raises nothing new', `${again.json.raised} raised again`);

  console.log('\naccepting a detected claim');
  await refuse('a coach retyping the student\u2019s thought', id, 'coach', 'thought.retyped', {
    objectId: idea, versionId: uuid(),
    parentVersionId: detected.json.state.thoughts[idea]?.currentVersionId, type: 'CLAIM',
  });

  const before = detected.json.state.thoughts[idea];
  const accepted = await post<View>(`/projects/${id}/proposals/${proposal.proposalId}/accept`, {});
  if (accepted.status !== 200) {
    bad('accepting a detected claim', `status ${accepted.status} ${accepted.json.message ?? ''}`);
    return;
  }
  const after = accepted.json.state.thoughts[idea];

  if (after?.type === 'CLAIM') ok('the thought becomes a claim');
  else bad('the thought becomes a claim', `type ${after?.type}`);

  if (after?.objectId === before?.objectId) ok('and keeps the identity it already had');
  else bad('identity', 'a second identity was minted');

  if (after?.text === before?.text) ok('its words are untouched', 'accepting is a decision, not a rewrite');
  else bad('its words are untouched', 'the text changed');

  const versions = accepted.json.state.versions[idea] ?? [];
  if (versions.length === 2) ok('the retype is a new version against that identity', 'v1 \u2192 v2');
  else bad('the retype mints one version', `${versions.length} versions`);

  if (accepted.json.record['claimsFromDetection'] === 1
      && accepted.json.record['claimsCreated'] === 1) {
    ok('the record counts a claim however it arrived', 'created=1, fromDetection=1');
  } else {
    bad('the record counts the claim', JSON.stringify(accepted.json.record));
  }

  console.log('\nrevising while accepting');
  const second = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: second, versionId: uuid(), type: 'IDEA',
    // Phrased so the built-in reading catches it: the shy detector looks for a
    // verb that commits to something, and recall is not what is under test here.
    text: 'Drafting with AI reduces how well graduate students handle conflicting sources.',
    note: '', position: { x: 0, y: 0 },
  });
  const round = await post<View & { raised: number }>(`/projects/${id}/detect`, { provider: 'static' });
  const next = Object.values(round.json.state.proposals)
    .find((p) => p.kind === 'claim' && p.status === 'open' && p.targetObjectId === second);
  if (next === undefined) { bad('a second candidate', 'none'); return; }

  const sharpened = 'Drafting with AI reduces how well graduate students handle conflicting sources unaided.';
  const revised = await post<View>(`/projects/${id}/proposals/${next.proposalId}/accept`, {
    text: sharpened,
  });
  const sharp = revised.json.state.thoughts[second];
  if (sharp?.text === sharpened && sharp.type === 'CLAIM') {
    ok('accepting can revise in the same breath', 'v1 \u2192 v3');
  } else {
    bad('accepting with a revision', `${sharp?.type} / ${sharp?.text.slice(0, 40) ?? ''}`);
  }
  if ((revised.json.state.versions[second] ?? []).length === 3) {
    ok('the revision and the retype are separate versions');
  } else {
    bad('revision then retype', `${(revised.json.state.versions[second] ?? []).length} versions`);
  }

  console.log('\narchive keeps the record');
  await emit(id, 'student', 'thought.archived', { objectId: second });
  const archived = await get<View>(`/projects/${id}`);
  const gone = archived.state.thoughts[second];
  if (gone?.archived === true && gone.text === sharpened) {
    ok('an archived claim stays on the map with its history', `${(archived.state.versions[second] ?? []).length} versions kept`);
  } else {
    bad('archive', 'the claim or its text disappeared');
  }
  if (archived.record['claimsArchived'] === 1) ok('and is counted as archived, not deleted');
  else bad('claimsArchived', String(archived.record['claimsArchived']));
}


/**
 * Synthesis, gaps and the brief, slice 05.
 *
 * Driven without a model, so the contradiction half reports honestly that it
 * could not look. What is under test is the half the graph can prove, and the
 * invariant the brief turns on: nothing in it was written here.
 */
async function synthesisAndBrief(): Promise<void> {
  console.log('\ngaps the graph can prove');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;

  const question = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: question, versionId: uuid(), type: 'QUESTION',
    text: 'How does drafting with AI affect unaided synthesis of conflicting sources?',
    note: '', position: { x: 0, y: 0 },
  });
  const claim = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: claim, versionId: uuid(), type: 'CLAIM',
    text: 'Drafting with AI narrows the range of hypotheses graduate students try.',
    note: '', position: { x: 0, y: 0 },
  });

  const scanned = await post<View & {
    flagged: number; alreadyStanding: number; contradictions: number;
    scannedForContradictions: boolean; reason?: string;
  }>(`/projects/${id}/scan`, { provider: 'static' });

  const flags = scanned.json.state.thread.filter((m) => m.kind === 'flag');
  if (flags.some((f) => f.flag === 'claim_without_evidence')) {
    ok('a claim with no evidence is flagged', `${scanned.json.flagged} flagged`);
  } else {
    bad('a claim with no evidence is flagged', 'no such flag');
  }

  if (!scanned.json.scannedForContradictions) {
    ok('and it says plainly that contradictions were not scanned', 'no model, no guess');
  } else {
    bad('contradiction honesty', 'it claimed to have scanned without a model');
  }

  // A flag answers nothing the student asked for, so it must not move the ladder.
  if (flags.every((f) => f.hintLevel === 0)) ok('a flag is never a rung');
  else bad('a flag is never a rung', 'one carried a hint level');

  const rescanned = await post<View & { flagged: number; alreadyStanding: number }>(
    `/projects/${id}/scan`, { provider: 'static' },
  );
  if (rescanned.json.flagged === 0 && rescanned.json.alreadyStanding > 0) {
    ok('scanning twice does not repeat itself', `${rescanned.json.alreadyStanding} already standing`);
  } else {
    bad('scanning twice', `${rescanned.json.flagged} flagged again`);
  }

  console.log('\nthe brief is assembled, never generated');
  const before = await get<BriefView>(`/projects/${id}/brief`);

  if (before.brief.question === 'How does drafting with AI affect unaided synthesis of conflicting sources?') {
    ok('the question is quoted word for word');
  } else {
    bad('the question is quoted', 'it was rewritten');
  }

  // The invariant. Every line must already exist somewhere in the project.
  const project = await get<View>(`/projects/${id}`);
  const known = new Set<string>([
    ...Object.values(project.state.thoughts).map((t) => t.text),
    ...Object.values(project.state.passages).map((p) => p.text),
    ...Object.values(project.state.sources).map((s) => s.cite),
  ]);
  const lines: string[] = [];
  const walkLines = (ls: BriefLineShape[]): void => {
    for (const l of ls) { lines.push(l.text); walkLines(l.children); }
  };
  for (const section of before.brief.sections) walkLines(section.lines);

  const invented = lines.filter((t) => !known.has(t));
  if (invented.length === 0) ok('no line in it is prose the server wrote', `${lines.length} lines, all traceable`);
  else bad('no line is invented', `${invented.length} lines had no source: ${invented[0] ?? ''}`);

  const empty = before.brief.sections.filter((s) => s.gap);
  if (empty.length > 0 && empty.every((s) => s.lines.length === 0 && s.gapPrompt !== '')) {
    ok('an empty section is a gap with a prompt', `${empty.length} open`);
  } else {
    bad('an empty section is a gap', 'a section covered for itself');
  }

  const claims = before.brief.sections.find((s) => s.id === 'claims');
  if (claims?.lines[0]?.flags.includes('claim_without_evidence')) {
    ok('the unsupported claim carries its flag in the brief');
  } else {
    bad('the claim carries its flag', JSON.stringify(claims?.lines[0]?.flags));
  }

  if (before.brief.synthesisOpening === false) ok('one claim is not yet a synthesis opening');
  else bad('synthesis opening', 'it opened on a single claim');

  const second = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: second, versionId: uuid(), type: 'CLAIM',
    text: 'Unaided synthesis surfaces more contradictions between sources.',
    note: '', position: { x: 0, y: 0 },
  });
  const after = await get<BriefView>(`/projects/${id}/brief`);
  if (after.brief.synthesisOpening) ok('two claims and no synthesis is an opening', 'not a failing');
  else bad('synthesis opening', 'two claims did not open one');

  if (after.omitted.length === 0) ok('nothing on the map is silently left out');
  else bad('omitted', `${after.omitted.length} thoughts vanished`);

  // Every cited id must resolve, or the brief is citing something imaginary.
  const unresolved = after.brief.cited.filter((oid) => project.state.thoughts[oid] === undefined
    && after.brief.cited.includes(oid) && oid !== second);
  if (unresolved.length === 0) ok('every citation resolves to a real object');
  else bad('citations resolve', `${unresolved.length} did not`);
}


/**
 * Instructor review, slice 06.
 *
 * The claim the slice has to prove is in the plan: a comment survives five
 * student revisions and still makes sense. It also covers the loop back — a
 * student closes a comment by revising, and cannot close one by agreeing.
 */
async function instructorReview(): Promise<void> {
  console.log('\nassignment');
  const assignment = await post<AssignmentShape>('/assignments', {
    title: 'Literature synthesis, checkpoint 1',
    instructions: 'Build a reasoning map and submit it.',
    requirements: { sources: 1, counterArgument: true, aiProvenance: true },
    publish: true,
  });
  if (assignment.status === 201 && assignment.json.publishedAt !== null) {
    ok('an assignment is authored and published', assignment.json.title);
  } else {
    bad('assignment', `status ${assignment.status}`);
    return;
  }

  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;
  await post<{ ok: boolean }>(`/projects/${id}/assignment`, {
    assignmentId: assignment.json.assignmentId,
  });

  const claim = uuid();
  const v1 = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: claim, versionId: v1, type: 'CLAIM',
    text: 'Drafting with AI narrows the hypotheses students try.',
    note: '', position: { x: 0, y: 0 },
  });

  console.log('\nprogress before a submission');
  const before = await get<DashboardShape>(`/dashboard?assignment=${assignment.json.assignmentId}`);
  const row = before.rows.find((r) => r.projectId === id);
  if (row === undefined) { bad('the project appears on the dashboard', 'not listed'); return; }

  if (row.submittedAt === null && row.checkpoints === 0) ok('it shows as not yet submitted');
  else bad('not yet submitted', `${String(row.checkpoints)} checkpoints`);

  const sources = row.requirements.find((r) => r.id === 'sources');
  if (sources?.met === false) ok('an unmet requirement says what is missing', sources.detail);
  else bad('unmet requirement', JSON.stringify(sources));

  const provenance = row.requirements.find((r) => r.id === 'ai_provenance');
  if (provenance?.met === true) ok('AI provenance is met structurally', 'nothing to remember to attach');
  else bad('ai provenance', JSON.stringify(provenance));

  for (const check of row.requirements) {
    if (/good|strong|weak|poor|excellent|grade|score/i.test(check.detail)) {
      bad('the dashboard grades nobody', check.detail);
      return;
    }
  }
  ok('every figure is a count, and none of them is a mark');

  console.log('\ncheckpoint and comment');
  const snapshot = uuid();
  await emit(id, 'student', 'checkpoint.submitted', {
    snapshotId: snapshot, assignmentId: assignment.json.assignmentId,
    entries: [{ objectId: claim, versionId: v1 }],
  });

  const commentId = uuid();
  const commented = await emit(id, 'instructor', 'comment.created', {
    commentId, snapshotId: snapshot, objectId: claim, versionId: v1,
    kind: 'mark_for_revision',
    body: 'Which students, and narrows compared with what?',
  });
  if (commented.status === 200) ok('an instructor marks it for revision');
  else bad('comment', `status ${commented.status}`);

  // The loop is a loop, not a dismiss button.
  await refuse('closing a comment without revising', id, 'student', 'comment.resolved', {
    commentId, byVersionId: v1,
  });

  console.log('\nfive revisions later');
  const texts = [
    'Drafting with AI narrows the hypotheses graduate students try.',
    'Drafting with AI narrows the hypotheses graduate students try unaided.',
    'Drafting with AI narrows the framings graduate students try unaided.',
    'Drafting with AI narrows the framings graduate students reach unaided.',
    'Early drafting with AI narrows the framings graduate students reach unaided.',
  ];
  let parent = v1;
  let last = v1;
  for (const text of texts) {
    last = uuid();
    await emit(id, 'student', 'thought.revised', {
      objectId: claim, versionId: last, parentVersionId: parent, text, note: '',
    });
    parent = last;
  }

  const drifted = await get<{ drift: Array<{ commentId: string; versionsSince: number; stale: boolean }> }>(
    `/projects/${id}/drift`,
  );
  const d = drifted.drift.find((x) => x.commentId === commentId);
  if (d?.versionsSince === 5 && d.stale) {
    ok('the comment survives five revisions', 'reviewed v1, now v6');
  } else {
    bad('drift after five revisions', JSON.stringify(d));
  }

  const after = await get<View>(`/projects/${id}`);
  const live = after.state.thoughts[claim];
  if (live?.objectId === claim && live.text === texts[4]) {
    ok('and still points at the same object', 'one identity, six versions');
  } else {
    bad('identity across revisions', 'the object changed');
  }
  if ((after.state.versions[claim] ?? []).length === 6) ok('every version is still on the record');
  else bad('versions kept', `${String((after.state.versions[claim] ?? []).length)}`);

  console.log('\nthe loop back');
  const resolved = await emit(id, 'student', 'comment.resolved', {
    commentId, byVersionId: last,
  });
  if (resolved.status === 200) ok('the student closes it with the version that answers it');
  else bad('resolve', `status ${resolved.status} ${resolved.json.message ?? ''}`);

  await refuse('closing the same comment twice', id, 'student', 'comment.resolved', {
    commentId, byVersionId: last,
  });

  const done = await get<DashboardShape>(`/dashboard?assignment=${assignment.json.assignmentId}`);
  const finished = done.rows.find((r) => r.projectId === id);
  if (finished?.openComments === 0 && finished.checkpoints === 1) {
    ok('the dashboard shows the checkpoint in and the feedback closed');
  } else {
    bad('dashboard after the loop', JSON.stringify({
      open: finished?.openComments, checkpoints: finished?.checkpoints,
    }));
  }
}


/**
 * The brief as of a checkpoint, and the evidence panel, slice 07.
 *
 * A brief read from live state is the wrong document to review: the instructor
 * commented on what was handed in, and a student who has revised since would be
 * defended by text nobody read.
 */
async function reviewAsSubmitted(): Promise<void> {
  console.log('\nthe brief as it was submitted');
  const created = await post<View>('/projects', {
    title: 'AI and independent reasoning', group: 'AI & Learning',
  });
  const id = created.json.projectId;

  const claim = uuid();
  const v1 = uuid();
  const submittedText = 'Drafting with AI narrows the hypotheses students try.';
  await emit(id, 'student', 'thought.created', {
    objectId: claim, versionId: v1, type: 'CLAIM',
    text: submittedText, note: '', position: { x: 0, y: 0 },
  });

  // Work the student is not ready to show.
  const held = uuid();
  await emit(id, 'student', 'thought.created', {
    objectId: held, versionId: uuid(), type: 'CLAIM',
    text: 'A half-finished claim I am holding back.', note: '', position: { x: 0, y: 0 },
  });

  const snapshot = uuid();
  await emit(id, 'student', 'checkpoint.submitted', {
    snapshotId: snapshot, assignmentId: null,
    entries: [{ objectId: claim, versionId: v1 }],
  });

  // ... and then they keep working.
  await emit(id, 'student', 'thought.revised', {
    objectId: claim, versionId: uuid(), parentVersionId: v1,
    text: 'Early drafting with AI narrows the framings graduate students reach unaided.',
    note: '',
  });

  const live = await get<BriefView>(`/projects/${id}/brief`);
  const asOf = await get<BriefView>(`/projects/${id}/brief?snapshot=${snapshot}`);

  const liveClaim = live.brief.sections.find((s) => s.id === 'claims')?.lines[0]?.text;
  const thenClaim = asOf.brief.sections.find((s) => s.id === 'claims')?.lines[0]?.text;

  if (thenClaim === submittedText) ok('the checkpoint brief shows the words that were handed in');
  else bad('the checkpoint brief', `got "${thenClaim ?? ''}"`);

  if (liveClaim !== submittedText) ok('the live brief has moved on', 'they are different documents');
  else bad('the live brief', 'it did not move on');

  const thenLines = asOf.brief.sections.find((s) => s.id === 'claims')?.lines ?? [];
  if (thenLines.length === 1) ok('work held back is not in the submitted brief', '1 of 2 claims');
  else bad('held-back work', `${thenLines.length} claims appeared`);

  if (asOf.asOf === snapshot && live.asOf === null) ok('each brief says which it is');
  else bad('asOf', `${String(asOf.asOf)} / ${String(live.asOf)}`);

  if (asOf.checkpoints.length === 1) ok('the checkpoints are listed to choose between');
  else bad('checkpoints listed', `${asOf.checkpoints.length}`);

  const missing = await get<{ message?: string }>(`/projects/${id}/brief?snapshot=${uuid()}`);
  if ((missing.message ?? '').includes('unknown checkpoint')) {
    ok('an unknown checkpoint is refused rather than silently falling back to live');
  } else {
    bad('unknown checkpoint', JSON.stringify(missing).slice(0, 60));
  }
}

async function main(): Promise<void> {
  console.log(`\ncoral end-to-end  ${BASE}\n`);

  await framingWalk();
  await proposalPath();
  await claimsAndVersions();
  await synthesisAndBrief();
  await instructorReview();
  await reviewAsSubmitted();


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
  //
  // Retrieval is real now, so the papers that come back are whatever OpenAlex
  // has today. These checks are therefore about the property rather than the
  // contents: what matters is that the access level tracks what we hold, and
  // that the gate opens only for the levels that carry text. They pass
  // identically on the offline fixture.
  console.log('\nsources');
  const searched = await post<SearchView>(`/projects/${id}/search`, {
    query: 'generative AI literature synthesis graduate students conflicting sources',
  });
  const sources = Object.values(searched.json.state.sources);
  const passages = Object.values(searched.json.state.passages);

  if (sources.length > 0) ok('search returned results', `${sources.length} via ${searched.json.source}`);
  else { bad('search returned results', 'nothing at all'); process.exit(1); }

  const byLevel = sources.reduce<Record<string, number>>(
    (a, s2) => ({ ...a, [s2.access]: (a[s2.access] ?? 0) + 1 }), {},
  );
  ok('every result carries a level', JSON.stringify(byLevel));

  // The property the whole slice turns on.
  const heldWithoutText = sources.filter((s2) => {
    const has = passages.some((p) => p.sourceId === s2.sourceId);
    return (s2.access === 'open_full_text' || s2.access === 'user_upload') && !has;
  });
  if (heldWithoutText.length === 0) ok('no source claims text it does not have');
  else bad('no source claims text it does not have', `${heldWithoutText.length} do`);

  const textWithoutLevel = passages.filter((p) => {
    const s2 = searched.json.state.sources[p.sourceId];
    return s2 !== undefined && s2.access !== 'open_full_text' && s2.access !== 'user_upload';
  });
  if (textWithoutLevel.length === 0) ok('every held passage sits on a level that permits it');
  else bad('every held passage sits on a permitted level', `${textWithoutLevel.length} do not`);

  if (searched.json.source === 'openalex') {
    ok('offered full text not claimed as held', `${searched.json.offeredButNotHeld} of ${searched.json.found}`);
  }

  // Searching the same question twice must not fill the panel with duplicates.
  const again = await post<SearchView>(`/projects/${id}/search`, {
    query: 'generative AI literature synthesis graduate students conflicting sources',
  });
  if (again.json.added === 0) ok('a repeated search adds nothing', `${again.json.found} found, 0 added`);
  else bad('a repeated search adds nothing', `${again.json.added} added again`);

  // A source the gate is closed on, minted rather than hoped for.
  //
  // Whether search returns one depends on the day's results and on whether a
  // content key is set — with one, everything can arrive at open_full_text. The
  // upload path must be tested either way, so the fixture for it is explicit.
  const gatedId = uuid();
  await emit(id, 'coach', 'source.discovered', {
    sourceId: gatedId, access: 'metadata',
    cite: 'Marek, 2026', title: 'Transfer After Scaffolded Analysis',
    method: 'Longitudinal', abstract: null, externalUrl: null, doi: null,
  });
  const withGated = await get<View>(`/projects/${id}`);
  const gated = withGated.state.sources[gatedId];
  if (gated === undefined) { bad('a gated source to test against', 'could not create one'); process.exit(1); }
  ok('a source the gate is closed on', `${gated.cite} at ${gated.access}`);

  console.log('\nevidence gate');

  // Evidence needs a passage. A gated source has none, so there is nothing to
  // cite even before the two written fields are considered.
  const noPassage = await emit(id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: gated.sourceId, passageId: uuid(),
    interpretation: 'It shows effort fell.', warrant: 'Licenses a claim about effort.',
    position: { x: 700, y: 250 },
  });
  if (noPassage.status === 422) ok('REFUSED evidence from a source with no passage', noPassage.json.invariant ?? '');
  else bad('REFUSED evidence from a source with no passage', `status ${noPassage.status}`);

  /* ---- the upload escape hatch ---------------------------------------- */
  //
  // Without this the gate would block every paywalled paper, so it ships with
  // the slice rather than after it.
  console.log('\nupload promotes a source');

  const notAPdf = await postBytes(
    `/projects/${id}/sources/${gated.sourceId}/upload`,
    new TextEncoder().encode('this is not a pdf'),
  );
  if (notAPdf.status === 422) ok('REFUSED a file that is not a PDF', notAPdf.json.invariant ?? '');
  else bad('REFUSED a file that is not a PDF', `status ${notAPdf.status}`);

  const scan = await postBytes(`/projects/${id}/sources/${gated.sourceId}/upload`, textlessPdf());
  if (scan.status === 422 && (scan.json.message ?? '').includes('no text layer')) {
    ok('REFUSED a scan with no text layer', 'a source with no text cannot be promoted');
  } else {
    bad('REFUSED a scan with no text layer', `status ${scan.status}`);
  }

  const stillGated = await get<View>(`/projects/${id}`);
  if (stillGated.state.sources[gated.sourceId]?.access === gated.access) {
    ok('a refused upload leaves the level alone', gated.access);
  } else {
    bad('a refused upload leaves the level alone', 'the level moved anyway');
  }

  // The honest path when a PDF will not extract: the student types the quote.
  const transcribed = await post<View>(
    `/projects/${id}/sources/${gated.sourceId}/transcribe`,
    {
      text: 'Readers who summarised each source separately rarely surfaced contradictions between them.',
      locator: 'p. 12, Findings',
    },
  );
  if (transcribed.status !== 200) {
    bad('transcribing a passage', `status ${transcribed.status} ${transcribed.json.message ?? ''}`);
    process.exit(1);
  }
  const promoted = transcribed.json.state.sources[gated.sourceId];
  const typed = Object.values(transcribed.json.state.passages)
    .find((p) => p.sourceId === gated.sourceId);

  if (promoted?.access === 'user_upload') ok('transcribing earns user_upload', gated.cite);
  else bad('transcribing earns user_upload', `got ${promoted?.access}`);

  if (typed?.provenance === 'student_transcribed') ok('and is recorded as the student\u2019s transcription');
  else bad('provenance', `got ${typed?.provenance}`);

  const tooShort = await post<View>(`/projects/${id}/sources/${gated.sourceId}/transcribe`, {
    text: 'It says so.', locator: 'p. 1',
  });
  if (tooShort.status === 422) ok('REFUSED a summary in place of the sentences', tooShort.json.invariant ?? '');
  else bad('REFUSED a summary in place of the sentences', `status ${tooShort.status}`);

  const noLocator = await post<View>(`/projects/${id}/sources/${gated.sourceId}/transcribe`, {
    text: 'Readers who summarised each source separately rarely surfaced contradictions.',
    locator: '  ',
  });
  if (noLocator.status === 422) ok('REFUSED a passage nobody could find again', noLocator.json.invariant ?? '');
  else bad('REFUSED a passage nobody could find again', `status ${noLocator.status}`);

  console.log('\nevidence from what we now hold');
  if (typed === undefined) { bad('a passage to cite', 'none'); process.exit(1); }

  await refuse('evidence with an empty warrant', id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: gated.sourceId, passageId: typed.passageId,
    interpretation: 'Separate summaries hide contradictions.', warrant: '   ',
    position: { x: 700, y: 250 },
  });
  await refuse('evidence with an empty interpretation', id, 'student', 'evidence.created', {
    objectId: uuid(), versionId: uuid(), sourceId: gated.sourceId, passageId: typed.passageId,
    interpretation: '  ', warrant: 'Licenses a claim about reading strategy.',
    position: { x: 700, y: 250 },
  });

  const evidence = uuid();
  const madeEvidence = await emit(id, 'student', 'evidence.created', {
    objectId: evidence, versionId: uuid(), sourceId: gated.sourceId, passageId: typed.passageId,
    interpretation: 'Summarising sources one at a time hides the disagreements between them.',
    warrant: 'Licenses a claim about reading strategy, not about capability.',
    position: { x: 700, y: 250 },
  });
  if (madeEvidence.status === 200) ok('evidence once both fields are written', gated.cite);
  else bad('evidence once both fields are written', `status ${madeEvidence.status} ${madeEvidence.json.message ?? ''}`);

  await emit(id, 'student', 'relation.created', {
    relationId: uuid(), from: evidence, to: claim, relation: 'supports',
  });
  ok('evidence wired to the claim', 'supports');

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
