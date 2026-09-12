import type { DomainEvent } from './events.js';
import { claimsWithoutEvidence, openProposals, thoughtsOfType } from './selectors.js';
import type { ProjectState } from './types.js';

/**
 * The instructor's evidence panel.
 *
 * Every field here is a count of something that happened, traceable to the
 * objects behind it. There is deliberately no capability score, no rubric level,
 * and no judgment about the student. The coach may name a structural gap in the
 * reasoning; nothing in this module describes the person.
 */
export interface ObservableRecord {
  claimsCreated: number;
  claimsRevised: number;
  claimsArchived: number;
  claimsWithoutEvidence: number;
  challengesExplored: number;
  alternativesExplored: number;
  evidenceCreated: number;
  sourcesSaved: number;
  sourcesCited: number;
  sourcesSavedNeverCited: number;
  questionRevisions: number;
  coachMovesOffered: number;
  hintsRequested: number;
  /**
   * What the student did with what the coach suggested.
   *
   * Raised against accepted and dismissed is an observable of judgment being
   * exercised over a suggestion, which is a different thing from compliance. It
   * is still a count: nothing here says whether the student chose well.
   */
  proposalsRaised: number;
  proposalsAccepted: number;
  proposalsDismissed: number;
  proposalsOpen: number;
}

export function observableRecord(
  state: ProjectState,
  events: readonly DomainEvent[],
): ObservableRecord {
  const typeOf = (objectId: string): string | undefined => state.thoughts[objectId]?.type;

  const citedSources = new Set(
    Object.values(state.thoughts)
      .map((t) => t.evidence?.sourceId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
  const savedSources = Object.values(state.sources).filter((s) => s.saved);

  let claimsCreated = 0;
  let claimsRevised = 0;
  let claimsArchived = 0;
  let evidenceCreated = 0;
  let questionRevisions = 0;
  let coachMovesOffered = 0;
  let hintsRequested = 0;
  let proposalsRaised = 0;
  let proposalsAccepted = 0;
  let proposalsDismissed = 0;

  for (const event of events) {
    switch (event.type) {
      case 'thought.created':
        if (event.payload.type === 'CLAIM') claimsCreated += 1;
        break;
      case 'evidence.created':
        evidenceCreated += 1;
        break;
      case 'thought.revised': {
        const t = typeOf(event.payload.objectId);
        if (t === 'CLAIM') claimsRevised += 1;
        if (t === 'QUESTION') questionRevisions += 1;
        break;
      }
      case 'thought.archived':
        if (typeOf(event.payload.objectId) === 'CLAIM') claimsArchived += 1;
        break;
      case 'coach.moved':
        coachMovesOffered += 1;
        if (event.payload.hintLevel > 0) hintsRequested += 1;
        break;
      case 'proposal.raised':
        proposalsRaised += 1;
        break;
      case 'proposal.accepted':
        proposalsAccepted += 1;
        break;
      case 'proposal.dismissed':
        proposalsDismissed += 1;
        break;
      default:
        break;
    }
  }

  return {
    claimsCreated,
    claimsRevised,
    claimsArchived,
    claimsWithoutEvidence: claimsWithoutEvidence(state).length,
    challengesExplored: thoughtsOfType(state, 'CHALLENGE').length,
    alternativesExplored: thoughtsOfType(state, 'ALTERNATIVE').length,
    evidenceCreated,
    sourcesSaved: savedSources.length,
    sourcesCited: citedSources.size,
    sourcesSavedNeverCited: savedSources.filter((s) => !citedSources.has(s.sourceId)).length,
    questionRevisions,
    coachMovesOffered,
    hintsRequested,
    proposalsRaised,
    proposalsAccepted,
    proposalsDismissed,
    proposalsOpen: openProposals(state).length,
  };
}
