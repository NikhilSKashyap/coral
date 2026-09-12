import type { DomainEvent } from './events.js';
import { structuralGaps } from './gaps.js';
import type { ObjectId, SourceId } from './ids.js';
import {
  claimsWithoutEvidence, coachMoves, liveThoughts, thoughtsOfType, versionsOf,
} from './selectors.js';
import type { ProjectState, Thought } from './types.js';

/**
 * The instructor's evidence panel.
 *
 * `observableRecord` answers "how many". This answers "which ones", and that is
 * the difference the slice turns on: a number nobody can open is a score with
 * extra steps. Every figure here carries the objects behind it, so an instructor
 * reading "two claims without evidence" can go and look at both instead of
 * forming an impression.
 *
 * Nothing in this module infers anything. There is no capability read, no
 * rubric level, and no arithmetic that turns counts into a judgement about a
 * person. A test asserts as much, because this is the one place in the product
 * where a score would feel natural.
 */

export interface RecordEntry {
  id: string;
  label: string;
  value: number;
  /** The thoughts behind the number. */
  objectIds: ObjectId[];
  /** The sources behind it, where the figure is about reading rather than writing. */
  sourceIds: SourceId[];
  /** One line on what the number counts, so it cannot be read as a verdict. */
  note: string;
}

const byAge = (a: Thought, b: Thought): number => a.createdAt.localeCompare(b.createdAt);

export function evidencePanel(
  state: ProjectState,
  events: readonly DomainEvent[],
): RecordEntry[] {
  const entry = (
    id: string, label: string, note: string,
    thoughts: readonly Thought[], sourceIds: SourceId[] = [],
  ): RecordEntry => ({
    id, label, note,
    value: thoughts.length + sourceIds.length,
    objectIds: thoughts.map((t) => t.objectId),
    sourceIds,
  });

  const claims = thoughtsOfType(state, 'CLAIM').sort(byAge);
  const archived = Object.values(state.thoughts)
    .filter((t) => t.archived && t.type === 'CLAIM')
    .sort(byAge);

  /** Claims that have gained a version since they were created. */
  const revised = claims.filter((c) => versionsOf(state, c.objectId).length > 1);

  const cited = new Set(
    Object.values(state.thoughts)
      .map((t) => t.evidence?.sourceId)
      .filter((id): id is SourceId => id !== undefined),
  );
  const saved = Object.values(state.sources).filter((s) => s.saved);

  const questions = thoughtsOfType(state, 'QUESTION').sort(byAge);
  const questionRevisions = questions.reduce(
    (sum, q) => sum + Math.max(0, versionsOf(state, q.objectId).length - 1), 0,
  );

  const asked = coachMoves(state).filter((m) => m.hintLevel > 0);
  const askedOn = [...new Set(asked.map((m) => m.targetObjectId).filter((id): id is ObjectId => id !== null))]
    .map((id) => state.thoughts[id])
    .filter((t): t is Thought => t !== undefined);

  const accepted = Object.values(state.proposals).filter((p) => p.status === 'accepted');
  const dismissed = Object.values(state.proposals).filter((p) => p.status === 'dismissed');

  return [
    entry('claims', 'Claims on the map', 'Thoughts typed as a claim, however they arrived.', claims),
    entry('claims_revised', 'Claims revised at least once',
      'A claim with more than one version. Every version is kept.', revised),
    entry('claims_archived', 'Claims archived',
      'Archived, not deleted. They stay on the map, greyed.', archived),
    entry('claims_without_evidence', 'Claims with no evidence attached',
      'No Evidence thought joined to them by `supports`.', claimsWithoutEvidence(state).sort(byAge)),
    entry('challenges', 'Objections written',
      'Challenges the student wrote in their own words.', thoughtsOfType(state, 'CHALLENGE').sort(byAge)),
    entry('alternatives', 'Alternatives considered',
      'Other explanations put on the map.', thoughtsOfType(state, 'ALTERNATIVE').sort(byAge)),
    entry('evidence', 'Evidence objects',
      'A passage we hold, plus their reading of it and what it licenses.',
      liveThoughts(state).filter((t) => t.type === 'EVIDENCE').sort(byAge)),
    entry('sources_cited', 'Sources cited', 'Backing at least one Evidence object.', [], [...cited]),
    entry('sources_saved_never_cited', 'Sources saved and never cited',
      'Saved to the list, never used as evidence. Reading is not citing.',
      [], saved.filter((s) => !cited.has(s.sourceId)).map((s) => s.sourceId)),
    {
      id: 'question_revisions',
      label: 'Times the question was rewritten',
      note: 'A question that never moves is usually a question nobody interrogated.',
      value: questionRevisions,
      objectIds: questions.map((q) => q.objectId),
      sourceIds: [],
    },
    {
      id: 'hints_requested',
      label: 'Times the student asked for more help',
      note: 'Support climbs a rung only when asked. This counts the asking, not the needing.',
      value: asked.length,
      objectIds: askedOn.map((t) => t.objectId),
      sourceIds: [],
    },
    {
      id: 'proposals_accepted',
      label: 'Coach suggestions taken',
      note: 'Accepted by writing the thought, or by agreeing to a reading of one.',
      value: accepted.length,
      objectIds: accepted.map((p) => p.acceptedAs).filter((id): id is ObjectId => id !== null),
      sourceIds: [],
    },
    {
      id: 'proposals_dismissed',
      label: 'Coach suggestions declined',
      note: 'Declining is recorded. Neither number is better than the other.',
      value: dismissed.length,
      objectIds: dismissed.map((p) => p.targetObjectId).filter((id): id is ObjectId => id !== null),
      sourceIds: [],
    },
    {
      id: 'open_gaps',
      label: 'Structural gaps still open',
      note: 'Facts about the shape of the map, not about the person who made it.',
      value: structuralGaps(state).length,
      objectIds: structuralGaps(state).flatMap((g) => g.objectIds),
      sourceIds: [],
    },
    {
      id: 'events',
      label: 'Events in the log',
      note: 'Every write, in order. Nothing here was overwritten and nothing deleted.',
      value: events.length,
      objectIds: [],
      sourceIds: [],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The thinking evolution timeline                                     */
/* ------------------------------------------------------------------ */

export type MilestoneKind =
  | 'framed' | 'claimed' | 'retyped' | 'evidenced' | 'challenged'
  | 'revised' | 'synthesised' | 'submitted' | 'reviewed' | 'resolved';

export interface Milestone {
  seq: number;
  at: string;
  kind: MilestoneKind;
  /** Written by the template. The quoted part is the student's. */
  label: string;
  quote: string | null;
  objectId: ObjectId | null;
}

/**
 * How the reasoning moved, in order.
 *
 * A replay of the log kept to the events that changed the shape of the argument,
 * which is what the flow calls the Thinking Evolution. The coach's own moves are
 * left out on purpose: this is a record of what the student did, and a timeline
 * padded with prompts would read as a record of what they were told.
 */
export function thinkingTimeline(
  state: ProjectState,
  events: readonly DomainEvent[],
): Milestone[] {
  const out: Milestone[] = [];
  const textOf = (objectId: ObjectId): string | null => state.thoughts[objectId]?.text ?? null;

  for (const event of events) {
    const base = { seq: event.seq, at: event.at };

    switch (event.type) {
      case 'frame.accepted':
        out.push({ ...base, kind: 'framed', label: 'Accepted the problem frame', quote: state.frame?.question ?? null, objectId: null });
        break;

      case 'thought.created': {
        const { type, objectId, text } = event.payload;
        if (type === 'CLAIM') {
          out.push({ ...base, kind: 'claimed', label: 'Wrote a claim', quote: text, objectId });
        } else if (type === 'CHALLENGE') {
          out.push({ ...base, kind: 'challenged', label: 'Answered an objection', quote: text, objectId });
        } else if (type === 'SYNTHESIS') {
          out.push({ ...base, kind: 'synthesised', label: 'Wrote a synthesis', quote: text, objectId });
        } else if (type === 'QUESTION') {
          out.push({ ...base, kind: 'framed', label: 'Wrote the question', quote: text, objectId });
        }
        break;
      }

      case 'thought.retyped':
        if (event.payload.type === 'CLAIM') {
          out.push({
            ...base, kind: 'retyped', label: 'Recognised an earlier thought as a claim',
            quote: textOf(event.payload.objectId), objectId: event.payload.objectId,
          });
        }
        break;

      case 'evidence.created':
        out.push({
          ...base, kind: 'evidenced', label: 'Read a passage and said what it licenses',
          quote: event.payload.warrant, objectId: event.payload.objectId,
        });
        break;

      case 'thought.revised': {
        const type = state.thoughts[event.payload.objectId]?.type;
        if (type !== 'CLAIM' && type !== 'QUESTION') break;
        out.push({
          ...base, kind: 'revised',
          label: type === 'QUESTION' ? 'Rewrote the question' : 'Revised a claim',
          quote: event.payload.text, objectId: event.payload.objectId,
        });
        break;
      }

      case 'checkpoint.submitted':
        out.push({
          ...base, kind: 'submitted',
          label: `Submitted a checkpoint, freezing ${String(event.payload.entries.length)} object${event.payload.entries.length === 1 ? '' : 's'}`,
          quote: null, objectId: null,
        });
        break;

      case 'comment.created':
        out.push({
          ...base, kind: 'reviewed', label: `Instructor left a ${event.payload.kind.replace(/_/g, ' ')}`,
          quote: event.payload.body, objectId: event.payload.objectId,
        });
        break;

      case 'comment.resolved': {
        const comment = state.comments[event.payload.commentId];
        out.push({
          ...base, kind: 'resolved', label: 'Closed that feedback with a revision',
          quote: null, objectId: comment?.objectId ?? null,
        });
        break;
      }

      default:
        break;
    }
  }
  return out;
}
