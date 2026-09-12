import { diffWords, summariseDiff } from './diff.js';
import type { ObjectId } from './ids.js';
import {
  challengesRaised, childrenOf, claimsWithoutEvidence, liveThoughts, parentsOf,
  thoughtsOfType, versionsOf,
} from './selectors.js';
import type { ProjectState, StructuralFlag } from './types.js';

/**
 * Gaps the graph can prove.
 *
 * Every one of these is a fact about the structure, not a reading of the prose,
 * which is why they need no model and cannot be wrong in the way a model can.
 * The coach is allowed to name them — invariant vii permits describing the work
 * — and the brief renders them as sections a student must close.
 *
 * `contradiction` is deliberately absent. Two claims resisting each other is a
 * matter of what they mean, so it needs reading and lives with detection.
 */

export interface Gap {
  flag: StructuralFlag;
  /** The objects involved, so an interface can link straight to them. */
  objectIds: ObjectId[];
  /** One sentence, describing the work. Never the worker. */
  detail: string;
}

/** A claim with no `supports` edge from an Evidence thought. */
function unsupportedClaims(state: ProjectState): Gap[] {
  return claimsWithoutEvidence(state).map((claim) => ({
    flag: 'claim_without_evidence' as const,
    objectIds: [claim.objectId],
    detail: `"${truncate(claim.text)}" has no evidence attached.`,
  }));
}

/** A challenge nobody has answered with a thought of their own. */
function unresolvedChallenges(state: ProjectState): Gap[] {
  const gaps: Gap[] = [];

  for (const thought of thoughtsOfType(state, 'CHALLENGE')) {
    if (childrenOf(state, thought.objectId).length > 0) continue;
    gaps.push({
      flag: 'unresolved_challenge',
      objectIds: [thought.objectId],
      detail: `"${truncate(thought.text)}" has not been answered.`,
    });
  }

  // An objection the coach raised that never became a thought at all.
  const answered = new Set(
    Object.values(state.proposals)
      .filter((p) => p.kind === 'challenge' && p.status !== 'open')
      .map((p) => p.targetObjectId)
      .filter((id): id is ObjectId => id !== null),
  );
  for (const move of challengesRaised(state)) {
    const target = move.targetObjectId;
    if (target === null || answered.has(target)) continue;
    const thought = state.thoughts[target];
    if (thought === undefined) continue;
    gaps.push({
      flag: 'unresolved_challenge',
      objectIds: [target],
      detail: `An objection to "${truncate(thought.text)}" is still open.`,
    });
  }
  return gaps;
}

/** A source saved and never cited. Reading is not citing. */
function uncitedSources(state: ProjectState): Gap[] {
  const cited = new Set(
    Object.values(state.thoughts)
      .map((t) => t.evidence?.sourceId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
  return Object.values(state.sources)
    .filter((s) => s.saved && !cited.has(s.sourceId))
    .map((source) => ({
      flag: 'source_saved_never_cited' as const,
      objectIds: [],
      detail: `${source.cite} was saved but never cited.`,
    }));
}

/**
 * How far the question has travelled from the one the frame was accepted on.
 *
 * Drift is not a fault — a question that never moves is usually a question
 * nobody interrogated. It is a gap only in the sense that the work behind the
 * question may no longer be pointed at it, which is worth showing rather than
 * scoring. The threshold is deliberately loose: this fires on a question that
 * has been substantially rewritten, not on one that gained a word.
 */
function questionDrift(state: ProjectState): Gap[] {
  const question = thoughtsOfType(state, 'QUESTION')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (question === undefined) return [];

  const versions = versionsOf(state, question.objectId);
  const first = versions[0];
  if (first === undefined || versions.length < 2) return [];

  const summary = summariseDiff(diffWords(first.text, question.text));
  const moved = summary.added + summary.removed;
  const total = moved + summary.unchanged;
  if (total === 0 || moved / total < 0.4) return [];

  return [{
    flag: 'question_drift',
    objectIds: [question.objectId],
    detail: `The question has been substantially rewritten since v1 (+${String(summary.added)} −${String(summary.removed)} words). Work done against the earlier wording may no longer answer it.`,
  }];
}

/**
 * Claims that are not joined to anything.
 *
 * Not one of the five named flags, so it is reported through
 * `claim_without_evidence` only when it also lacks evidence. A claim wired to
 * nothing at all is instead surfaced by the brief as a synthesis opening.
 */
export function isolatedClaims(state: ProjectState): ObjectId[] {
  return thoughtsOfType(state, 'CLAIM')
    .filter((c) => parentsOf(state, c.objectId).length === 0
      && childrenOf(state, c.objectId).length === 0)
    .map((c) => c.objectId);
}

/** Every gap the graph can prove, in the order an interface should show them. */
export function structuralGaps(state: ProjectState): Gap[] {
  return [
    ...unsupportedClaims(state),
    ...unresolvedChallenges(state),
    ...questionDrift(state),
    ...uncitedSources(state),
  ];
}

/**
 * Whether there is enough on the map for a synthesis to be worth writing.
 *
 * Two or more live claims, and no synthesis yet. Reported as an opening rather
 * than a gap, because a synthesis nobody is ready to write is not a failing.
 */
export function synthesisOpening(state: ProjectState): ObjectId[] | null {
  const claims = thoughtsOfType(state, 'CLAIM');
  if (claims.length < 2) return null;
  if (liveThoughts(state).some((t) => t.type === 'SYNTHESIS')) return null;
  return claims.map((c) => c.objectId);
}

const truncate = (text: string, at = 70): string =>
  text.length <= at ? text : `${text.slice(0, at)}…`;
