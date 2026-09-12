import { MalformedMove, type CoachMoveResult, type CoachRequest } from './move.js';
import {
  ClaudeCodeProvider, CodexProvider, StaticProvider,
  type CoachProvider, type ProviderId, type ProviderStatus,
} from './providers.js';

export * from './move.js';
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
): Promise<CoachOutcome> {
  const fallback = new StaticProvider();
  if (preferred === 'static') {
    return { move: await fallback.move(request), provider: 'static' };
  }

  const provider = ORDER.find((p) => p.id === preferred);
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
