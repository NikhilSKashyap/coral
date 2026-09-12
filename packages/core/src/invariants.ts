import type { DomainEvent } from './events.js';
import { COACH_ONLY_EVENTS, INSTRUCTOR_ONLY_EVENTS, STUDENT_AUTHORED_EVENTS } from './events.js';
import { PASSAGE_PROVENANCE, canBackEvidence } from './types.js';
import type { ProjectState } from './types.js';

/**
 * The write path, not the interface, is where the product's refusals live.
 *
 * A prompt that says "do not write the student's thought" fails silently. These
 * guards run on every append, server-side, and throw. Each one corresponds to a
 * numbered invariant in the build plan.
 */
export class InvariantViolation extends Error {
  constructor(
    readonly invariant: string,
    message: string,
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'InvariantViolation';
  }
}

// Declared as a function statement, not an arrow const, so TypeScript narrows
// control flow after every call site.
function fail(invariant: string, message: string): never {
  throw new InvariantViolation(invariant, message);
}

const blank = (s: string): boolean => s.trim().length === 0;

const has = <T,>(list: readonly T[], value: T): boolean => list.includes(value);

/* ------------------------------------------------------------------ */

/** i. The model never writes thought text. */
export function assertAuthorship(event: DomainEvent): void {
  if (has(STUDENT_AUTHORED_EVENTS, event.type as never) && event.actor !== 'student') {
    fail('i.authorship', `${event.type} carries text the student owns; actor was "${event.actor}"`);
  }
  if (has(COACH_ONLY_EVENTS, event.type as never) && event.actor !== 'coach') {
    fail('i.authorship', `${event.type} is a coach move; actor was "${event.actor}"`);
  }
  if (has(INSTRUCTOR_ONLY_EVENTS, event.type as never) && event.actor !== 'instructor') {
    fail('i.authorship', `${event.type} is an instructor action; actor was "${event.actor}"`);
  }
  if (event.actor === 'instructor' && !has(INSTRUCTOR_ONLY_EVENTS, event.type as never)
      && event.type !== 'comment.resolved') {
    fail('i.authorship', `an instructor may only comment; got ${event.type}`);
  }
}

/** ii. Evidence needs real text and a written interpretation. */
export function assertEvidenceGate(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'evidence.created') return;
  const { sourceId, passageId, interpretation, warrant } = event.payload;

  const source = state.sources[sourceId];
  if (!source) fail('ii.evidence', `unknown source ${sourceId}`);
  if (!canBackEvidence(source.access)) {
    fail('ii.evidence', `source ${sourceId} is at "${source.access}"; evidence needs an accessible passage or an upload`);
  }

  const passage = state.passages[passageId];
  if (!passage) fail('ii.evidence', `no captured passage ${passageId}; the system never implies text it has not retrieved`);
  if (passage.sourceId !== sourceId) {
    fail('ii.evidence', `passage ${passageId} belongs to ${passage.sourceId}, not ${sourceId}`);
  }

  if (blank(interpretation)) fail('ii.evidence', 'interpretation is empty; a source without a reading stays a source');
  if (blank(warrant)) fail('ii.evidence', 'warrant is empty; say what the finding licenses and what it does not');
}

/** ii (cont). A passage always states where its text came from. */
export function assertPassageProvenance(event: DomainEvent): void {
  if (event.type !== 'passage.captured') return;
  if (!has(PASSAGE_PROVENANCE, event.payload.provenance)) {
    fail('ii.passage', `unknown provenance "${event.payload.provenance}"`);
  }
  if (blank(event.payload.text)) fail('ii.passage', 'a captured passage with no text is not a capture');
}

/** iii. A detected claim is a proposal until a student accepts it. */
export function assertProposalNotAutoAccepted(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'proposal.accepted') return;
  if (event.actor !== 'student') {
    fail('iii.proposal', `only a student accepts a proposal; actor was "${event.actor}"`);
  }
  const proposal = state.proposals[event.payload.proposalId];
  if (!proposal) fail('iii.proposal', `unknown proposal ${event.payload.proposalId}`);
  if (proposal.status !== 'open') {
    fail('iii.proposal', `proposal ${event.payload.proposalId} is already ${proposal.status}`);
  }
}

/** v. Support escalates one rung at a time, and only when asked. */
export function assertHintLadder(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'coach.moved') return;
  const { hintLevel, targetObjectId } = event.payload;
  if (hintLevel === 0 || targetObjectId === null) return;
  const reached = state.thread.reduce((max, entry) => {
    if (!('kind' in entry)) return max;
    if (entry.targetObjectId !== targetObjectId) return max;
    return Math.max(max, entry.hintLevel);
  }, 0);
  if (hintLevel > reached + 1) {
    fail('v.ladder', `jumped from rung ${reached} to ${hintLevel} on ${targetObjectId}; the ladder advances one step per request`);
  }
}

/** vi. Nothing is overwritten. Revisions branch from the version that is current. */
export function assertStableIdentity(event: DomainEvent, state: ProjectState): void {
  if (event.type === 'thought.created' || event.type === 'evidence.created') {
    if (state.thoughts[event.payload.objectId]) {
      fail('vi.identity', `object ${event.payload.objectId} already exists; identities are minted once`);
    }
    return;
  }
  if (event.type !== 'thought.revised' && event.type !== 'thought.retyped') return;
  const thought = state.thoughts[event.payload.objectId];
  if (!thought) fail('vi.identity', `unknown object ${event.payload.objectId}`);
  if (thought.currentVersionId !== event.payload.parentVersionId) {
    fail('vi.identity', `parent ${event.payload.parentVersionId} is not current (${thought.currentVersionId})`);
  }
  const versions = state.versions[event.payload.objectId] ?? [];
  if (versions.some((v) => v.versionId === event.payload.versionId)) {
    fail('vi.identity', `version ${event.payload.versionId} already recorded`);
  }
}

/** iv. A checkpoint freezes existing pairs. It never mints a second identity. */
export function assertSnapshotIdentity(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'checkpoint.submitted') return;
  for (const entry of event.payload.entries) {
    const thought = state.thoughts[entry.objectId];
    if (!thought) fail('iv.snapshot', `cannot freeze unknown object ${entry.objectId}`);
    const versions = state.versions[entry.objectId] ?? [];
    if (!versions.some((v) => v.versionId === entry.versionId)) {
      fail('iv.snapshot', `version ${entry.versionId} was never recorded for ${entry.objectId}`);
    }
  }
}

/** iv (cont). Feedback names both the stable object and the version reviewed. */
export function assertCommentTarget(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'comment.created') return;
  const snapshot = state.snapshots[event.payload.snapshotId];
  if (!snapshot) fail('iv.comment', `unknown snapshot ${event.payload.snapshotId}`);
  const entry = snapshot.entries.find((e) => e.objectId === event.payload.objectId);
  if (!entry) fail('iv.comment', `object ${event.payload.objectId} is not in snapshot ${event.payload.snapshotId}`);
  if (entry.versionId !== event.payload.versionId) {
    fail('iv.comment', `snapshot froze ${entry.versionId}; the comment names ${event.payload.versionId}`);
  }
}

/**
 * iv (cont). A student closes a comment by revising, not by agreeing with it.
 *
 * Resolving names the version that answers the comment, and for a student that
 * version has to be one written after the one the instructor read. Without this
 * the resolve loop is a dismiss button: a student could clear a mark for
 * revision without touching the thought, and the instructor's panel would show
 * feedback addressed that nothing addressed.
 *
 * An instructor may close anything at any version. Judging whether an objection
 * has been met is exactly their job, and sometimes the answer arrives as a new
 * object rather than as a new version of the old one.
 */
export function assertResolutionRevises(event: DomainEvent, state: ProjectState): void {
  if (event.type !== 'comment.resolved') return;

  const comment = state.comments[event.payload.commentId];
  if (!comment) fail('iv.comment', `unknown comment ${event.payload.commentId}`);
  if (comment.resolvedByVersionId !== null) {
    fail('iv.comment', `comment ${event.payload.commentId} is already resolved`);
  }

  const versions = state.versions[comment.objectId] ?? [];
  const answering = versions.findIndex((v) => v.versionId === event.payload.byVersionId);
  if (answering < 0) {
    fail('iv.comment', `version ${event.payload.byVersionId} was never recorded for ${comment.objectId}`);
  }

  if (event.actor === 'instructor') return;

  const reviewed = versions.findIndex((v) => v.versionId === comment.versionId);
  if (answering <= reviewed) {
    fail(
      'iv.comment',
      `resolving names the version that answers the comment; ${event.payload.byVersionId} is not newer than the version reviewed`,
    );
  }
}

/** The log is append-only and gapless. Replay depends on it. */
export function assertSequence(event: DomainEvent, state: ProjectState): void {
  if (event.seq !== state.seq + 1) {
    fail('log.sequence', `expected seq ${state.seq + 1}, got ${event.seq}`);
  }
  if (event.projectId !== state.projectId && event.type !== 'project.created') {
    fail('log.sequence', `event belongs to project ${event.projectId}, not ${state.projectId}`);
  }
}

/** Every guard, in one call. This is what the append path runs. */
export function checkInvariants(event: DomainEvent, state: ProjectState): void {
  assertSequence(event, state);
  assertAuthorship(event);
  assertPassageProvenance(event);
  assertEvidenceGate(event, state);
  assertProposalNotAutoAccepted(event, state);
  assertHintLadder(event, state);
  assertStableIdentity(event, state);
  assertSnapshotIdentity(event, state);
  assertCommentTarget(event, state);
  assertResolutionRevises(event, state);
}
