import { requestDetection, type ProviderId } from '@coral/agent';
import type { ProjectId, ProposalId } from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * Run claim detection and put the results on the board as proposals.
 *
 * Nothing here creates a thought or edits one. A detected claim is a proposal
 * to retype something the student already wrote, and invariant iii means it
 * sits open until they rule on it.
 *
 * Detection is idempotent in the way that matters: a thought with a proposal
 * already open is skipped, and so is one the student has already declined,
 * because re-raising a suggestion someone has turned down is how a tool starts
 * nagging.
 */

export interface DetectBody {
  provider?: ProviderId;
}

export interface DetectResult extends ProjectView {
  raised: number;
  skipped: number;
  provider: ProviderId;
  fellBackFrom?: ProviderId;
  reason?: string;
}

export async function detectClaims(
  projectId: ProjectId,
  body: DetectBody,
): Promise<DetectResult> {
  let view = await loadProject(projectId);

  const outcome = await requestDetection(view.state, body.provider ?? 'claude-code');

  // Every thought the student has already ruled on, at any time. A dismissal is
  // a decision, and the log keeps it, so it is honoured rather than forgotten.
  const ruled = new Set(
    Object.values(view.state.proposals)
      .filter((p) => p.kind === 'claim' && p.targetObjectId !== null)
      .map((p) => p.targetObjectId as string),
  );

  let raised = 0;
  let skipped = 0;

  for (const candidate of outcome.candidates) {
    if (ruled.has(candidate.objectId as string)) { skipped += 1; continue; }
    ruled.add(candidate.objectId as string);

    view = await appendEvent(projectId, {
      actor: 'coach',
      type: 'proposal.raised',
      payload: {
        proposalId: crypto.randomUUID() as ProposalId,
        kind: 'claim',
        suggestedType: 'CLAIM',
        targetObjectId: candidate.objectId,
        // The coach's reading of the thought. Never a rewrite of it.
        rationale: candidate.rationale,
      },
    });
    raised += 1;
  }

  return {
    ...view,
    raised,
    skipped,
    provider: outcome.provider,
    ...(outcome.fellBackFrom === undefined ? {} : { fellBackFrom: outcome.fellBackFrom }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  };
}
