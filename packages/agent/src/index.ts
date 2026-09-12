import type { ProjectState, Thought } from '@coral/core';
import {
  parseContradictions, parseDetection, renderCandidates, renderClaims,
  type ClaimCandidate, type ContradictionPair,
} from './detect.js';
import { MalformedMove, type CoachMoveResult, type CoachRequest } from './move.js';
import {
  ClaudeCodeProvider, CodexProvider, StaticProvider,
  type CoachProvider, type ProviderId, type ProviderStatus,
} from './providers.js';

export * from './move.js';
export * from './detect.js';
export * from './context.js';
export * from './constitution.js';
export * from './providers.js';

const ORDER: CoachProvider[] = [
  new ClaudeCodeProvider(),
  new CodexProvider(),
  new StaticProvider(),
];

/** What this machine can actually do, for the settings screen. */
export async function detectProviders(): Promise<ProviderStatus[]> {
  return Promise.all(
    ORDER.map(async (p) => ({
      id: p.id,
      label: p.label,
      available: await p.available(),
      detail:
        p.id === 'static'
          ? 'Always available. No model, no network, no account.'
          : `Uses your own ${p.label} sign-in. Coral never sees the credential.`,
    })),
  );
}

export interface CoachOutcome {
  move: CoachMoveResult;
  /** Which provider actually produced this. */
  provider: ProviderId;
  /** Set when the preferred provider failed and the ladder answered instead. */
  fellBackFrom?: ProviderId;
  reason?: string;
}

/**
 * Ask for one move, with a floor under it.
 *
 * The static ladder is always the last resort, so a missing install, an expired
 * session, an exhausted quota, an offline laptop and a malformed reply all land
 * in the same place: the student still gets a usable move.
 */
export async function requestMove(
  request: CoachRequest,
  preferred: ProviderId = 'claude-code',
  // Injectable so the floor can be tested with a provider that misbehaves on
  // purpose. Production never passes it.
  providers: readonly CoachProvider[] = ORDER,
): Promise<CoachOutcome> {
  const fallback = new StaticProvider();
  if (preferred === 'static') {
    return { move: await fallback.move(request), provider: 'static' };
  }

  const provider = providers.find((p) => p.id === preferred);
  if (provider === undefined || !(await provider.available())) {
    return {
      move: await fallback.move(request),
      provider: 'static',
      fellBackFrom: preferred,
      reason: `${preferred} is not installed on this machine`,
    };
  }

  try {
    return { move: await provider.move(request), provider: provider.id };
  } catch (error) {
    const reason =
      error instanceof MalformedMove
        ? `${provider.label} returned something outside the allowed move set`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      move: await fallback.move(request),
      provider: 'static',
      fellBackFrom: provider.id,
      reason,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Claim detection                                                     */
/* ------------------------------------------------------------------ */

export interface DetectionOutcome {
  candidates: ClaimCandidate[];
  provider: ProviderId;
  fellBackFrom?: ProviderId;
  reason?: string;
}

/**
 * Which of the student's thoughts are already doing the work of a claim.
 *
 * Same floor as a coaching move, and the floor matters more here: detection is
 * a convenience, so a missed candidate costs nothing. The student can type a
 * claim whenever they like. That is why the static detector below is
 * deliberately shy rather than clever.
 */
export async function requestDetection(
  state: ProjectState,
  preferred: ProviderId = 'claude-code',
  providers: readonly CoachProvider[] = ORDER,
): Promise<DetectionOutcome> {
  const { prompt, refs } = renderCandidates(state);
  if (refs.length === 0) return { candidates: [], provider: 'static' };

  if (preferred === 'static') {
    return { candidates: staticDetect(refs), provider: 'static' };
  }

  const provider = providers.find((p) => p.id === preferred);
  // Only the Claude Code adapter has a classifier path. Anything else lands on
  // the shy detector rather than pretending.
  if (provider === undefined || !('detect' in provider) || !(await provider.available())) {
    return {
      candidates: staticDetect(refs),
      provider: 'static',
      fellBackFrom: preferred,
      reason: `${preferred} cannot classify on this machine`,
    };
  }

  try {
    const raw = await (provider as { detect: (p: string) => Promise<unknown> }).detect(prompt);
    return { candidates: parseDetection(raw, refs), provider: provider.id };
  } catch (error) {
    return {
      candidates: staticDetect(refs),
      provider: 'static',
      fellBackFrom: provider.id,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Claim detection with no model, and deliberately shy.
 *
 * A false positive puts a proposal on the board that wastes the student's
 * attention, so this only flags an IDEA that reads as an assertion: a statement
 * rather than a question, long enough to be making a point, and carrying a word
 * that commits to something. It will miss plenty. That is the right trade for a
 * floor.
 */
function staticDetect(refs: readonly Thought[]): ClaimCandidate[] {
  const commits = /\b(is|are|was|were|does|do|causes?|leads? to|reduces?|increases?|narrows?|improves?|prevents?|means?|implies|shows?)\b/i;

  return refs
    .filter((t) => t.type === 'IDEA')
    .filter((t) => !t.text.includes('?'))
    .filter((t) => (t.text.match(/\S+/g) ?? []).length >= 6)
    .filter((t) => commits.test(t.text))
    .slice(0, 2)
    .map((t) => ({
      objectId: t.objectId,
      rationale: 'This states something that could be disagreed with, which is what a claim does.',
    }));
}

export interface ContradictionOutcome {
  pairs: ContradictionPair[];
  provider: ProviderId;
  fellBackFrom?: ProviderId;
  reason?: string;
}

/**
 * Which claims resist each other.
 *
 * There is no static floor for this one, and that is the honest answer rather
 * than a shortcut: whether two claims conflict is a question about meaning, and
 * a keyword heuristic that guessed at it would produce exactly the confident
 * nonsense this product exists to avoid. With no agent installed, the scan
 * reports that it could not look.
 */
export async function requestContradictions(
  state: ProjectState,
  preferred: ProviderId = 'claude-code',
  providers: readonly CoachProvider[] = ORDER,
): Promise<ContradictionOutcome> {
  const { prompt, refs } = renderClaims(state);

  // Nothing to compare is not the same as being unable to compare, and saying
  // so the same way would report a capability failure where there is none.
  if (refs.length < 2) {
    return {
      pairs: [],
      provider: 'static',
      reason: 'there are not two claims to read against each other yet',
    };
  }

  const provider = providers.find((p) => p.id === preferred);
  if (preferred === 'static' || provider === undefined
      || !('contradictions' in provider) || !(await provider.available())) {
    return {
      pairs: [],
      provider: 'static',
      ...(preferred === 'static' ? {} : { fellBackFrom: preferred }),
      reason: 'Reading two claims against each other needs a model. Nothing was scanned.',
    };
  }

  try {
    const raw = await (provider as { contradictions: (p: string) => Promise<unknown> })
      .contradictions(prompt);
    return { pairs: parseContradictions(raw, refs), provider: provider.id };
  } catch (error) {
    return {
      pairs: [],
      provider: 'static',
      fellBackFrom: provider.id,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
