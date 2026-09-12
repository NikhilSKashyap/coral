import {
  detectProviders, renderContext, requestMove,
  type CoachMoveResult, type ProviderId,
} from '@coral/agent';
import {
  hintLevelFor,
  type HintLevel, type ObjectId, type ProjectId,
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
  const next =
    move.kind === 'propose_branch'
      ? await appendEvent(projectId, {
          actor: 'coach',
          type: 'proposal.raised',
          payload: {
            proposalId: crypto.randomUUID(),
            kind: 'branch',
            suggestedType: move.suggestedType,
            targetObjectId: body.objectId,
            // The coach's reason for suggesting it. Never the thought itself.
            rationale: move.body,
          },
        })
      : await appendEvent(projectId, {
          actor: 'coach',
          type: 'coach.moved',
          payload: {
            moveId: crypto.randomUUID(),
            kind: move.kind,
            targetObjectId: body.objectId,
            hintLevel: rung,
            body: move.body,
            flag: move.flag ?? null,
          },
        });

  return {
    ...next,
    move,
    provider: outcome.provider,
    ...(outcome.fellBackFrom === undefined ? {} : { fellBackFrom: outcome.fellBackFrom }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    rung,
  };
}
