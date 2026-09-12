import type { DomainEvent } from './events.js';
import { checkInvariants } from './invariants.js';
import type { ProjectId } from './ids.js';
import type {
  Comment, CoachMove, ProjectState, StudentReply, Thought, ThoughtVersion,
} from './types.js';

/**
 * Current state is a projection. Nothing here is authoritative; replaying the
 * log from zero must reproduce it exactly, which is what makes version history,
 * the coach thread, the instructor panel and undo the same machinery.
 */

export const initialState = (projectId: ProjectId): ProjectState => ({
  projectId,
  title: 'Untitled question',
  group: 'Unfiled',
  frame: null,
  thoughts: {},
  versions: {},
  relations: {},
  sources: {},
  passages: {},
  proposals: {},
  snapshots: {},
  comments: {},
  thread: [],
  seq: 0,
});

const version = (
  event: DomainEvent,
  fields: Pick<ThoughtVersion, 'versionId' | 'objectId' | 'type' | 'text' | 'note' | 'parentVersionId'>,
): ThoughtVersion => ({
  ...fields,
  authoredBy: event.actor,
  promptedBy: event.promptedBy,
  at: event.at,
  seq: event.seq,
});

const withVersion = (state: ProjectState, v: ThoughtVersion): ProjectState['versions'] => ({
  ...state.versions,
  [v.objectId]: [...(state.versions[v.objectId] ?? []), v],
});

/** Apply one event. Assumes the guards have already run. */
export function apply(state: ProjectState, event: DomainEvent): ProjectState {
  const next = { ...state, seq: event.seq };

  switch (event.type) {
    case 'project.created':
      return { ...next, projectId: event.projectId, title: event.payload.title, group: event.payload.group };

    case 'frame.drafted':
      return {
        ...next,
        frame: {
          question: event.payload.question,
          concepts: event.payload.concepts,
          assumptions: event.payload.assumptions,
          acceptedAt: null,
        },
      };

    case 'frame.accepted':
      return next.frame ? { ...next, frame: { ...next.frame, acceptedAt: event.at } } : next;

    case 'thought.created': {
      const p = event.payload;
      const v = version(event, {
        versionId: p.versionId, objectId: p.objectId, type: p.type,
        text: p.text, note: p.note, parentVersionId: null,
      });
      const thought: Thought = {
        objectId: p.objectId,
        type: p.type,
        currentVersionId: p.versionId,
        text: p.text,
        note: p.note,
        position: p.position,
        archived: false,
        createdAt: event.at,
      };
      return {
        ...next,
        thoughts: { ...next.thoughts, [p.objectId]: thought },
        versions: withVersion(next, v),
      };
    }

    case 'evidence.created': {
      const p = event.payload;
      const text = p.interpretation;
      const v = version(event, {
        versionId: p.versionId, objectId: p.objectId, type: 'EVIDENCE',
        text, note: p.warrant, parentVersionId: null,
      });
      const thought: Thought = {
        objectId: p.objectId,
        type: 'EVIDENCE',
        currentVersionId: p.versionId,
        text,
        note: p.warrant,
        position: p.position,
        archived: false,
        createdAt: event.at,
        evidence: {
          sourceId: p.sourceId,
          passageId: p.passageId,
          interpretation: p.interpretation,
          warrant: p.warrant,
        },
      };
      // Citing a source is a stronger signal than saving it, so it implies saved.
      const source = next.sources[p.sourceId];
      return {
        ...next,
        thoughts: { ...next.thoughts, [p.objectId]: thought },
        versions: withVersion(next, v),
        sources: source ? { ...next.sources, [p.sourceId]: { ...source, saved: true } } : next.sources,
      };
    }

    case 'thought.revised': {
      const p = event.payload;
      const current = next.thoughts[p.objectId];
      if (!current) return next;
      const v = version(event, {
        versionId: p.versionId, objectId: p.objectId, type: current.type,
        text: p.text, note: p.note, parentVersionId: p.parentVersionId,
      });
      return {
        ...next,
        thoughts: {
          ...next.thoughts,
          [p.objectId]: { ...current, currentVersionId: p.versionId, text: p.text, note: p.note },
        },
        versions: withVersion(next, v),
      };
    }

    case 'thought.retyped': {
      const p = event.payload;
      const current = next.thoughts[p.objectId];
      if (!current) return next;
      const v = version(event, {
        versionId: p.versionId, objectId: p.objectId, type: p.type,
        text: current.text, note: current.note, parentVersionId: p.parentVersionId,
      });
      return {
        ...next,
        thoughts: {
          ...next.thoughts,
          [p.objectId]: { ...current, type: p.type, currentVersionId: p.versionId },
        },
        versions: withVersion(next, v),
      };
    }

    case 'thought.moved': {
      const current = next.thoughts[event.payload.objectId];
      if (!current) return next;
      return {
        ...next,
        thoughts: {
          ...next.thoughts,
          [event.payload.objectId]: { ...current, position: event.payload.position },
        },
      };
    }

    case 'thought.archived':
    case 'thought.restored': {
      const current = next.thoughts[event.payload.objectId];
      if (!current) return next;
      return {
        ...next,
        thoughts: {
          ...next.thoughts,
          [event.payload.objectId]: { ...current, archived: event.type === 'thought.archived' },
        },
      };
    }

    case 'relation.created':
      return {
        ...next,
        relations: {
          ...next.relations,
          [event.payload.relationId]: {
            relationId: event.payload.relationId,
            from: event.payload.from,
            to: event.payload.to,
            relation: event.payload.relation,
            authoredBy: event.actor,
            removed: false,
          },
        },
      };

    case 'relation.retyped': {
      const current = next.relations[event.payload.relationId];
      if (!current) return next;
      return {
        ...next,
        relations: {
          ...next.relations,
          [event.payload.relationId]: { ...current, relation: event.payload.relation },
        },
      };
    }

    case 'relation.removed': {
      const current = next.relations[event.payload.relationId];
      if (!current) return next;
      return {
        ...next,
        relations: { ...next.relations, [event.payload.relationId]: { ...current, removed: true } },
      };
    }

    case 'source.discovered':
      return {
        ...next,
        sources: {
          ...next.sources,
          [event.payload.sourceId]: {
            sourceId: event.payload.sourceId,
            access: event.payload.access,
            cite: event.payload.cite,
            title: event.payload.title,
            method: event.payload.method,
            abstract: event.payload.abstract,
            externalUrl: event.payload.externalUrl,
            doi: event.payload.doi,
            saved: false,
            discoveredAt: event.at,
          },
        },
      };

    case 'source.saved':
    case 'source.uploaded': {
      const current = next.sources[event.payload.sourceId];
      if (!current) return next;
      const patched = event.type === 'source.uploaded'
        ? { ...current, saved: true, access: 'user_upload' as const }
        : { ...current, saved: true };
      return { ...next, sources: { ...next.sources, [event.payload.sourceId]: patched } };
    }

    case 'passage.captured':
      return {
        ...next,
        passages: {
          ...next.passages,
          [event.payload.passageId]: {
            passageId: event.payload.passageId,
            sourceId: event.payload.sourceId,
            text: event.payload.text,
            locator: event.payload.locator,
            provenance: event.payload.provenance,
          },
        },
      };

    case 'proposal.raised':
      return {
        ...next,
        proposals: {
          ...next.proposals,
          [event.payload.proposalId]: {
            proposalId: event.payload.proposalId,
            kind: event.payload.kind,
            suggestedType: event.payload.suggestedType,
            targetObjectId: event.payload.targetObjectId,
            rationale: event.payload.rationale,
            status: 'open',
            acceptedAs: null,
          },
        },
      };

    case 'proposal.accepted':
    case 'proposal.dismissed': {
      const current = next.proposals[event.payload.proposalId];
      if (!current) return next;
      const patched = event.type === 'proposal.accepted'
        ? { ...current, status: 'accepted' as const, acceptedAs: event.payload.objectId }
        : { ...current, status: 'dismissed' as const };
      return { ...next, proposals: { ...next.proposals, [event.payload.proposalId]: patched } };
    }

    case 'coach.moved': {
      const move: CoachMove = {
        moveId: event.payload.moveId,
        kind: event.payload.kind,
        targetObjectId: event.payload.targetObjectId,
        hintLevel: event.payload.hintLevel,
        body: event.payload.body,
        flag: event.payload.flag,
        at: event.at,
      };
      return { ...next, thread: [...next.thread, move] };
    }

    case 'student.replied': {
      const reply: StudentReply = { moveId: event.payload.moveId, text: event.payload.text, at: event.at };
      return { ...next, thread: [...next.thread, reply] };
    }

    case 'checkpoint.submitted':
      return {
        ...next,
        snapshots: {
          ...next.snapshots,
          [event.payload.snapshotId]: {
            snapshotId: event.payload.snapshotId,
            projectId: event.projectId,
            assignmentId: event.payload.assignmentId,
            entries: event.payload.entries,
            at: event.at,
          },
        },
      };

    case 'comment.created': {
      const comment: Comment = {
        commentId: event.payload.commentId,
        snapshotId: event.payload.snapshotId,
        objectId: event.payload.objectId,
        versionId: event.payload.versionId,
        kind: event.payload.kind,
        body: event.payload.body,
        authorId: event.actorId,
        resolvedByVersionId: null,
        at: event.at,
      };
      return { ...next, comments: { ...next.comments, [comment.commentId]: comment } };
    }

    case 'comment.resolved': {
      const current = next.comments[event.payload.commentId];
      if (!current) return next;
      return {
        ...next,
        comments: {
          ...next.comments,
          [event.payload.commentId]: { ...current, resolvedByVersionId: event.payload.byVersionId },
        },
      };
    }
  }
}

/** Guard, then apply. This is the only supported write path. */
export function append(state: ProjectState, event: DomainEvent): ProjectState {
  checkInvariants(event, state);
  return apply(state, event);
}

/** Rebuild from zero. Used by tests, undo, and the instructor's timeline. */
export function replay(projectId: ProjectId, events: readonly DomainEvent[]): ProjectState {
  return events.reduce(append, initialState(projectId));
}

/** State as it stood immediately after a given seq. Undo is a rewind, not an inverse. */
export function replayThrough(
  projectId: ProjectId,
  events: readonly DomainEvent[],
  seq: number,
): ProjectState {
  return replay(projectId, events.filter((e) => e.seq <= seq));
}
