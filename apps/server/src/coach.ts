import {
  detectProviders, renderContext, requestMove,
  type CoachMoveResult, type ProviderId,
} from '@coral/agent';
import {
  hintLevelFor,
  type HintLevel, type MoveId, type ObjectId, type ProjectId, type ProposalId,
} from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

export { detectProviders };

export interface CoachRequestBody {
  objectId: ObjectId;
  /** True when the student pressed for more help, which is what advances the rung. */
  escalate?: boolean;
  /** True when the student asked to be argued with. A one-move stance, not a mode. */
  argue?: boolean;
  provider?: ProviderId;
}

export interface CoachResponse extends ProjectView {
  move: CoachMoveResult;
  provider: ProviderId;
  fellBackFrom?: ProviderId;
  reason?: string;
  rung: HintLevel;
  /** Set when the move left something for the student to rule on. */
  proposalId?: ProposalId;
}

/**
 * One coaching move, from the student's own agent.
 *
 * The rung is computed here from the log rather than taken from the client, so
 * the ladder cannot be skipped by a caller that simply asks for rung three. The
 * returned move is then written through the same guarded append as everything
 * else: if a local model returns something outside the closed set, the guard
 * rejects it exactly as it would reject a hand-rolled request.
 */
export async function coach(
  projectId: ProjectId,
  body: CoachRequestBody,
): Promise<CoachResponse> {
  const view = await loadProject(projectId);
  const thought = view.state.thoughts[body.objectId];
  if (thought === undefined) throw new Error(`unknown thought ${body.objectId}`);

  const reached = hintLevelFor(view.state, body.objectId);
  const rung = (body.escalate === true ? Math.min(reached + 1, 3) : reached) as HintLevel;

  const outcome = await requestMove(
    {
      context: renderContext(view.state, body.objectId),
      rung,
      adversarial: body.argue === true,
    },
    body.provider ?? 'claude-code',
  );

  const move = outcome.move;
  const moveId = crypto.randomUUID() as MoveId;

  // Every move lands in the thread, including the two that also raise a
  // proposal. The thread is the record of what the coach said; a proposal is the
  // separate question of what the student does about it.
  let next = await appendEvent(projectId, {
    actor: 'coach',
    type: 'coach.moved',
    payload: {
      moveId,
      kind: move.kind,
      targetObjectId: body.objectId,
      hintLevel: rung,
      body: move.body,
      flag: move.flag ?? null,
    },
  });

  /**
   * Two kinds leave something to act on.
   *
   * `propose_branch` names a type the student might write next. `challenge`
   * states an objection, and an objection that cannot be answered on the map is
   * just a remark — so it too becomes a proposal, for a CHALLENGE thought the
   * student writes in their own words.
   *
   * Neither payload carries a sentence for the student's thought. The rationale
   * is the coach's reason for suggesting it, which is its own prose.
   */
  let proposalId: ProposalId | undefined;
  if (move.kind === 'propose_branch' || move.kind === 'challenge') {
    proposalId = crypto.randomUUID() as ProposalId;
    next = await appendEvent(projectId, {
      actor: 'coach',
      type: 'proposal.raised',
      payload: {
        proposalId,
        kind: move.kind === 'challenge' ? 'challenge' : 'branch',
        suggestedType: move.kind === 'challenge' ? 'CHALLENGE' : move.suggestedType,
        targetObjectId: body.objectId,
        rationale: move.body,
      },
    });
  }

  return {
    ...next,
    move,
    provider: outcome.provider,
    ...(outcome.fellBackFrom === undefined ? {} : { fellBackFrom: outcome.fellBackFrom }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    rung,
    ...(proposalId === undefined ? {} : { proposalId }),
  };
}
