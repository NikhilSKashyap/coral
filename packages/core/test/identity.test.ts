import { describe, expect, it } from 'vitest';
import { append, replay, replayThrough } from '../src/state.js';
import { commentDrift } from '../src/selectors.js';
import { EVENT_TYPES } from '../src/events.js';
import { observableRecord } from '../src/metrics.js';
import type { CommentId, ObjectId, SnapshotId, VersionId } from '../src/ids.js';
import { Log, PROJECT } from './helpers.js';

/** A student writes a question, submits it, gets a comment, then revises twice. */
function session() {
  const log = new Log();
  const objectId = log.id<ObjectId>();
  const v1 = log.id<VersionId>();

  log.push('student', {
    type: 'project.created',
    payload: { title: 'AI and independent reasoning', group: 'AI & Learning' },
  });
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: v1, type: 'QUESTION',
      text: 'Does AI reduce independent thinking?', note: '', position: { x: 40, y: 40 },
    },
  });

  const snapshotId = log.id<SnapshotId>();
  log.push('student', {
    type: 'checkpoint.submitted',
    payload: { snapshotId, assignmentId: null, entries: [{ objectId, versionId: v1 }] },
  });

  const commentId = log.id<CommentId>();
  log.push('instructor', {
    type: 'comment.created',
    payload: {
      commentId, snapshotId, objectId, versionId: v1, kind: 'question',
      body: 'Which ability do you mean by "thinking"?',
    },
  });

  const v2 = log.id<VersionId>();
  log.push('student', {
    type: 'thought.revised',
    payload: {
      objectId, versionId: v2, parentVersionId: v1,
      text: 'Does AI reduce independent idea generation?', note: '',
    },
  });
  const v3 = log.id<VersionId>();
  log.push('student', {
    type: 'thought.revised',
    payload: {
      objectId, versionId: v3, parentVersionId: v2,
      text: "How does the timing of AI assistance influence students' hypothesis generation?",
      note: '',
    },
  });

  return { log, objectId, v1, v3, snapshotId, commentId };
}

describe('identity survives a checkpoint', () => {
  it('keeps one object id across submission and two revisions', () => {
    const { log, objectId, v1, v3 } = session();
    expect(Object.keys(log.state.thoughts)).toEqual([objectId]);
    expect(log.state.thoughts[objectId]?.currentVersionId).toBe(v3);
    expect(log.state.versions[objectId]?.map((v) => v.versionId)).toEqual([v1, expect.any(String), v3]);
  });

  it('freezes the reviewed version without minting a second identity', () => {
    const { log, objectId, v1, snapshotId } = session();
    const snapshot = log.state.snapshots[snapshotId];
    expect(snapshot?.entries).toEqual([{ objectId, versionId: v1 }]);
  });

  it('reports how far the live object has drifted from what was reviewed', () => {
    const { log, commentId, v1, v3 } = session();
    const drift = commentDrift(log.state, commentId);
    expect(drift).toMatchObject({
      reviewedVersionId: v1,
      currentVersionId: v3,
      versionsSince: 2,
      stale: true,
    });
  });

  it('refuses a comment naming a version the snapshot did not freeze', () => {
    const { log, objectId, snapshotId, v3 } = session();
    const bad = log.draft('instructor', {
      type: 'comment.created',
      payload: {
        commentId: log.id<CommentId>(), snapshotId, objectId, versionId: v3,
        kind: 'comment', body: 'Commenting on a version I never saw.',
      },
    });
    expect(() => append(log.state, bad)).toThrow(/iv\.comment/);
  });
});

describe('the log is the source of truth', () => {
  it('replays to exactly the projected state', () => {
    const { log } = session();
    expect(replay(PROJECT, log.events)).toEqual(log.state);
  });

  it('rewinds to any earlier point, which is what undo is', () => {
    const { log, objectId, v1 } = session();
    const before = replayThrough(PROJECT, log.events, 4);
    expect(before.thoughts[objectId]?.currentVersionId).toBe(v1);
    expect(Object.keys(before.comments)).toHaveLength(1);
  });

  it('refuses an event that leaves a gap in the sequence', () => {
    const { log } = session();
    const bad = { ...log.draft('student', { type: 'frame.accepted', payload: {} }), seq: 99 };
    expect(() => append(log.state, bad)).toThrow(/log\.sequence/);
  });
});

describe('the instructor panel counts things that happened', () => {
  it('reports observable events, not a judgment', () => {
    const { log } = session();
    const record = observableRecord(log.state, log.events);
    expect(record.questionRevisions).toBe(2);
    expect(record.claimsCreated).toBe(0);
    expect(record.claimsWithoutEvidence).toBe(0);
    expect(Object.values(record).every((v) => typeof v === 'number')).toBe(true);
  });

  it('has no event type that records an assessment of a student', () => {
    const forbidden = /capab|rubric|score|grade|level|proficien|assess|rating/i;
    expect(EVENT_TYPES.filter((t) => forbidden.test(t))).toEqual([]);
  });
});
