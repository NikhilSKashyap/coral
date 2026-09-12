import { requestContradictions, type ProviderId } from '@coral/agent';
import {
  coachMoves, structuralGaps,
  type MoveId, type ObjectId, type ProjectId, type StructuralFlag,
} from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * Scan the map for what is missing or in tension.
 *
 * Two halves with a real difference between them. Most gaps are facts about the
 * structure — a claim with no evidence, an objection nobody answered, a source
 * saved and never cited, a question rewritten past the work behind it — and the
 * graph can prove every one, so they cost nothing and cannot be wrong in the way
 * a model can. Contradiction is the exception: whether two claims resist each
 * other is a question about meaning, so it needs reading.
 *
 * Everything found is written as a `flag` move. A flag names the work and stops:
 * it does not write the synthesis, pick a winner between two claims, or close
 * the gap it found.
 */

export interface ScanBody {
  provider?: ProviderId;
}

export interface ScanResult extends ProjectView {
  flagged: number;
  /** Flags that were already standing, so a repeated scan does not nag. */
  alreadyStanding: number;
  contradictions: number;
  /** True only when a model actually read the claims against each other. */
  scannedForContradictions: boolean;
  /** True when there were fewer than two claims, so there was nothing to read. */
  nothingToCompare: boolean;
  provider: ProviderId;
  reason?: string;
}

export async function scan(projectId: ProjectId, body: ScanBody): Promise<ScanResult> {
  let view = await loadProject(projectId);

  /**
   * What the coach has already said, so it is not said twice.
   *
   * Matched on the flag and its target rather than on wording: the same gap
   * found again is the same gap, and a student who has seen it does not need
   * telling in slightly different words.
   */
  const standing = new Set(
    coachMoves(view.state)
      .filter((m) => m.kind === 'flag' && m.flag !== null)
      .map((m) => `${m.flag ?? ''}|${m.targetObjectId ?? ''}`),
  );

  const found: Array<{ flag: StructuralFlag; target: ObjectId | null; body: string }> = [];

  for (const gap of structuralGaps(view.state)) {
    found.push({ flag: gap.flag, target: gap.objectIds[0] ?? null, body: gap.detail });
  }

  const outcome = await requestContradictions(view.state, body.provider ?? 'claude-code');
  for (const pair of outcome.pairs) {
    const other = view.state.thoughts[pair.b];
    found.push({
      flag: 'contradiction',
      target: pair.a,
      body: other === undefined
        ? pair.rationale
        : `${pair.rationale} The other claim is: "${other.text}"`,
    });
  }

  let flagged = 0;
  let alreadyStanding = 0;

  for (const item of found) {
    const key = `${item.flag}|${item.target ?? ''}`;
    if (standing.has(key)) { alreadyStanding += 1; continue; }
    standing.add(key);

    view = await appendEvent(projectId, {
      actor: 'coach',
      type: 'coach.moved',
      payload: {
        moveId: crypto.randomUUID() as MoveId,
        kind: 'flag',
        targetObjectId: item.target,
        // A flag is never a rung: it answers nothing the student asked for, so
        // it cannot advance the ladder.
        hintLevel: 0,
        body: item.body,
        flag: item.flag,
      },
    });
    flagged += 1;
  }

  return {
    ...view,
    flagged,
    alreadyStanding,
    contradictions: outcome.pairs.length,
    scannedForContradictions: outcome.provider !== 'static',
    nothingToCompare: (outcome.reason ?? '').includes('not two claims'),
    provider: outcome.provider,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  };
}
