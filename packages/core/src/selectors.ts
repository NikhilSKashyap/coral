import type { CommentId, ObjectId } from './ids.js';
import type {
  CoachMove, Comment, ProjectState, Proposal, RelationEdge, Thought, ThoughtType, ThoughtVersion,
} from './types.js';

export const thought = (s: ProjectState, id: ObjectId): Thought | undefined => s.thoughts[id];

export const liveThoughts = (s: ProjectState): Thought[] =>
  Object.values(s.thoughts).filter((t) => !t.archived);

export const thoughtsOfType = (s: ProjectState, type: ThoughtType): Thought[] =>
  liveThoughts(s).filter((t) => t.type === type);

export const activeRelations = (s: ProjectState): RelationEdge[] =>
  Object.values(s.relations).filter((r) => !r.removed);

export const childrenOf = (s: ProjectState, id: ObjectId): RelationEdge[] =>
  activeRelations(s).filter((r) => r.from === id);

export const parentsOf = (s: ProjectState, id: ObjectId): RelationEdge[] =>
  activeRelations(s).filter((r) => r.to === id);

export const versionsOf = (s: ProjectState, id: ObjectId): ThoughtVersion[] =>
  s.versions[id] ?? [];

export const versionAt = (
  s: ProjectState, id: ObjectId, versionId: string,
): ThoughtVersion | undefined => versionsOf(s, id).find((v) => v.versionId === versionId);

/** Walk up the first parent edge at each step. Cycle-safe. */
export function ancestorsOf(s: ProjectState, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  const seen = new Set<string>([id]);
  let cursor = id;
  for (;;) {
    const parent = parentsOf(s, cursor)[0];
    if (!parent || seen.has(parent.from)) break;
    out.unshift(parent.from);
    seen.add(parent.from);
    cursor = parent.from;
  }
  return out;
}

/** Everything downstream of a thought. Cycle-safe. */
export function subtreeOf(s: ProjectState, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  const seen = new Set<string>([id]);
  const queue: ObjectId[] = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of childrenOf(s, current)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      out.push(edge.to);
      queue.push(edge.to);
    }
  }
  return out;
}

export const coachMoves = (s: ProjectState): CoachMove[] =>
  s.thread.filter((entry): entry is CoachMove => 'kind' in entry);

export const hintLevelFor = (s: ProjectState, id: ObjectId): number =>
  coachMoves(s)
    .filter((m) => m.targetObjectId === id)
    .reduce((max, m) => Math.max(max, m.hintLevel), 0);

/** A claim with no `supports` edge from an Evidence thought. */
export function claimsWithoutEvidence(s: ProjectState): Thought[] {
  return thoughtsOfType(s, 'CLAIM').filter((claim) =>
    !parentsOf(s, claim.objectId).some((edge) => {
      const from = s.thoughts[edge.from];
      return edge.relation === 'supports' && from?.type === 'EVIDENCE';
    }),
  );
}

/**
 * Proposals the student has not yet ruled on.
 *
 * The coach detects; it does not accept. A proposal sits here until a student
 * either writes the thought themselves or dismisses it, which is invariant iii
 * made visible rather than merely guarded.
 */
export const openProposals = (s: ProjectState): Proposal[] =>
  Object.values(s.proposals).filter((p) => p.status === 'open');

export const proposalsFor = (s: ProjectState, id: ObjectId): Proposal[] =>
  Object.values(s.proposals).filter((p) => p.targetObjectId === id);

/** Objections the coach has raised. The one move where its prose is its own. */
export const challengesRaised = (s: ProjectState): CoachMove[] =>
  coachMoves(s).filter((m) => m.kind === 'challenge');

/**
 * A challenge the student has not answered with a thought of their own.
 *
 * An objection only does its work once it is argued with, so an unanswered one
 * is a structural gap the coach may name.
 */
export function unansweredChallenges(s: ProjectState): CoachMove[] {
  const answered = new Set(
    Object.values(s.proposals)
      .filter((p) => p.kind === 'challenge' && p.status === 'accepted')
      .map((p) => p.targetObjectId)
      .filter((id): id is ObjectId => id !== null),
  );
  return challengesRaised(s).filter(
    (m) => m.targetObjectId !== null && !answered.has(m.targetObjectId),
  );
}

export const openComments = (s: ProjectState): Comment[] =>
  Object.values(s.comments).filter((c) => c.resolvedByVersionId === null);

/**
 * How far the live object has moved since an instructor read it.
 *
 * This is the number the interface needs in order to say "commented on v2, now
 * at v5" and offer a diff, which is the whole point of splitting identity from
 * version.
 */
export interface CommentDrift {
  commentId: CommentId;
  objectId: ObjectId;
  reviewedVersionId: string;
  currentVersionId: string;
  versionsSince: number;
  stale: boolean;
}

export function commentDrift(s: ProjectState, commentId: CommentId): CommentDrift | undefined {
  const comment = s.comments[commentId];
  if (!comment) return undefined;
  const target = s.thoughts[comment.objectId];
  if (!target) return undefined;
  const versions = versionsOf(s, comment.objectId);
  const reviewedIndex = versions.findIndex((v) => v.versionId === comment.versionId);
  const currentIndex = versions.length - 1;
  const versionsSince = reviewedIndex < 0 ? 0 : currentIndex - reviewedIndex;
  return {
    commentId,
    objectId: comment.objectId,
    reviewedVersionId: comment.versionId,
    currentVersionId: target.currentVersionId,
    versionsSince,
    stale: versionsSince > 0,
  };
}
