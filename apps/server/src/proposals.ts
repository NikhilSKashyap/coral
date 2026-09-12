import {
  RELATIONS, coachMoves,
  type MoveId, type ObjectId, type ProjectId, type ProposalId, type Relation,
  type RelationId, type ThoughtType, type VersionId,
} from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * Accepting a proposal, which is the only way one becomes a thought.
 *
 * The coach detects; it does not accept. So this route takes the student's own
 * words and their own choice of relation, and writes the thought under their
 * name. There is no path anywhere in the server that turns a proposal into a
 * thought without text arriving from the student in the same request.
 *
 * Invariant iii guards the acceptance event itself. What this module adds is the
 * only route that can legally satisfy it.
 */

export interface AcceptProposalBody {
  /**
   * The student's words.
   *
   * Required for a branch or a challenge, which create a thought that did not
   * exist. Optional for a detected claim, where the words are already the
   * student's and accepting only changes how the thought is typed — passing
   * text there revises it in the same breath.
   */
  text?: string;
  /** Chosen by the student. The coach's suggestion is a default in the UI, not a decision. */
  relation?: Relation;
}

/**
 * A refusal that belongs to invariant iii.
 *
 * Carries the invariant name so the route can answer with a 422 in the same
 * shape as every guard in `@coral/core`. A bad request here is a refusal with a
 * reason, not a server fault.
 */
export class ProposalRefused extends Error {
  readonly invariant = 'iii.proposal';
  constructor(message: string) {
    super(message);
    this.name = 'ProposalRefused';
  }
}

/** The coach move that raised this, so the new thought records what prompted it. */
function promptingMove(view: ProjectView, target: ObjectId | null): MoveId | null {
  if (target === null) return null;
  return [...coachMoves(view.state)]
    .reverse()
    .find((m) => m.targetObjectId === target
      && (m.kind === 'propose_branch' || m.kind === 'challenge' || m.kind === 'flag'))
    ?.moveId ?? null;
}

export async function acceptProposal(
  projectId: ProjectId,
  proposalId: ProposalId,
  body: AcceptProposalBody,
): Promise<ProjectView> {
  const before = await loadProject(projectId);
  const proposal = before.state.proposals[proposalId];
  if (proposal === undefined) throw new ProposalRefused(`unknown proposal ${proposalId}`);
  if (proposal.status !== 'open') {
    throw new ProposalRefused(`proposal ${proposalId} is already ${proposal.status}`);
  }

  const text = (body.text ?? '').trim();
  const target = proposal.targetObjectId;

  /**
   * A detected claim is a reading of words the student already wrote, so
   * accepting it retypes their thought rather than creating a new one. There is
   * no authorship question to answer: nothing new is written unless they choose
   * to revise at the same time.
   */
  if (proposal.kind === 'claim') {
    if (target === null) throw new ProposalRefused('a detected claim must name a thought');
    return acceptDetectedClaim(projectId, proposalId, target, proposal.suggestedType, text, before);
  }

  if (text === '') {
    throw new ProposalRefused(
      'a proposal is accepted by writing the thought, not by agreeing to it',
    );
  }
  if (body.relation === undefined || !(RELATIONS as readonly string[]).includes(body.relation)) {
    throw new ProposalRefused(`"${String(body.relation)}" is not one of the eight relations`);
  }

  const objectId = crypto.randomUUID() as ObjectId;

  let view = await appendEvent(projectId, {
    actor: 'student',
    type: 'thought.created',
    promptedBy: promptingMove(before, target),
    payload: {
      objectId,
      versionId: crypto.randomUUID() as VersionId,
      type: proposal.suggestedType,
      text,
      note: '',
      position: beside(before, target),
    },
  });

  if (target !== null) {
    view = await appendEvent(projectId, {
      actor: 'student',
      type: 'relation.created',
      payload: {
        relationId: crypto.randomUUID() as RelationId,
        from: target,
        to: objectId,
        relation: body.relation,
      },
    });
  }

  // Last, so the proposal is only ever marked accepted once the thought it
  // stands for actually exists.
  return appendEvent(projectId, {
    actor: 'student',
    type: 'proposal.accepted',
    payload: { proposalId, objectId },
  });
}

/**
 * Accept a detected claim: retype the student's own thought.
 *
 * Ordered so nothing is ever half-done. An optional revision goes first, since
 * `assertStableIdentity` requires each write to branch from the version that is
 * current; the retype follows; the proposal closes last. Every one of these is
 * a student action, because every one of them is a decision about their words.
 */
async function acceptDetectedClaim(
  projectId: ProjectId,
  proposalId: ProposalId,
  target: ObjectId,
  suggestedType: ThoughtType,
  text: string,
  before: ProjectView,
): Promise<ProjectView> {
  const thought = before.state.thoughts[target];
  if (thought === undefined) throw new ProposalRefused(`unknown thought ${target}`);
  if (thought.type === suggestedType) {
    throw new ProposalRefused(`that thought is already a ${suggestedType.toLowerCase()}`);
  }

  let view = before;
  let parentVersionId = thought.currentVersionId;
  const promptedBy = promptingMove(before, target);

  if (text !== '' && text !== thought.text) {
    const versionId = crypto.randomUUID() as VersionId;
    view = await appendEvent(projectId, {
      actor: 'student',
      type: 'thought.revised',
      promptedBy,
      payload: { objectId: target, versionId, parentVersionId, text, note: thought.note },
    });
    parentVersionId = versionId;
  }

  view = await appendEvent(projectId, {
    actor: 'student',
    type: 'thought.retyped',
    promptedBy,
    payload: {
      objectId: target,
      versionId: crypto.randomUUID() as VersionId,
      parentVersionId,
      type: suggestedType,
    },
  });

  return appendEvent(projectId, {
    actor: 'student',
    type: 'proposal.accepted',
    payload: { proposalId, objectId: target },
  });
}

export async function dismissProposal(
  projectId: ProjectId,
  proposalId: ProposalId,
): Promise<ProjectView> {
  const before = await loadProject(projectId);
  const proposal = before.state.proposals[proposalId];
  if (proposal === undefined) throw new ProposalRefused(`unknown proposal ${proposalId}`);
  if (proposal.status !== 'open') {
    throw new ProposalRefused(`proposal ${proposalId} is already ${proposal.status}`);
  }

  return appendEvent(projectId, {
    actor: 'student',
    type: 'proposal.dismissed',
    payload: { proposalId },
  });
}

/** Drop the new thought near the one it answers, so the map stays readable. */
function beside(view: ProjectView, target: ObjectId | null): { x: number; y: number } {
  const anchor = target === null ? undefined : view.state.thoughts[target];
  if (anchor === undefined) return { x: 520, y: 120 };
  return { x: anchor.position.x + 300, y: anchor.position.y + 60 };
}
