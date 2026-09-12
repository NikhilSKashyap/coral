import { describe, expect, it } from 'vitest';
import { assembleBrief } from '../src/brief.js';
import { checkpointsOf, stateAtCheckpoint } from '../src/snapshot.js';
import type { ObjectId, SnapshotId, VersionId } from '../src/ids.js';
import { Log, PROJECT } from './helpers.js';

/**
 * A brief assembled from live state is the wrong document to review.
 *
 * The instructor commented on what was handed in. If the student has revised
 * since, a live brief defends them with text nobody read — which is the whole
 * thing the identity-versus-version split was built to avoid.
 */

interface Submitted {
  log: Log;
  claim: ObjectId;
  held: ObjectId;
  snapshot: SnapshotId;
  v1: VersionId;
}

/** A claim submitted at v1, plus a thought deliberately held back. */
function submitted(): Submitted {
  const log = new Log();
  const claim = log.id<ObjectId>();
  const v1 = log.id<VersionId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId: claim, versionId: v1, type: 'CLAIM',
      text: 'Drafting with AI narrows the hypotheses students try.',
      note: '', position: { x: 0, y: 0 },
    },
  });

  const held = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId: held, versionId: log.id<VersionId>(), type: 'IDEA',
      text: 'Half-finished idea I am not ready to show.',
      note: '', position: { x: 0, y: 0 },
    },
  });

  const snapshot = log.id<SnapshotId>();
  log.push('student', {
    type: 'checkpoint.submitted',
    payload: {
      snapshotId: snapshot, assignmentId: null,
      entries: [{ objectId: claim, versionId: v1 }],
    },
  });

  return { log, claim, held, snapshot, v1 };
}

const revise = (log: Log, objectId: ObjectId, text: string): VersionId => {
  const versionId = log.id<VersionId>();
  log.push('student', {
    type: 'thought.revised',
    payload: {
      objectId, versionId,
      parentVersionId: log.state.thoughts[objectId]?.currentVersionId as VersionId,
      text, note: '',
    },
  });
  return versionId;
};

describe('the brief as of a checkpoint', () => {
  it('shows the words that were handed in, not the ones written since', () => {
    const { log, claim, snapshot } = submitted();
    const original = log.state.thoughts[claim]?.text;
    revise(log, claim, 'Early drafting with AI narrows the framings graduate students reach unaided.');

    const then = stateAtCheckpoint(PROJECT, log.events, snapshot);
    expect(then?.thoughts[claim]?.text).toBe(original);
    // The live state has moved on, and still holds every version.
    expect(log.state.thoughts[claim]?.text).not.toBe(original);

    const brief = assembleBrief(then!);
    const line = brief.sections.find((s) => s.id === 'claims')?.lines[0];
    expect(line?.text).toBe(original);
  });

  it('leaves out work the student did not submit', () => {
    // A brief showing work deliberately held back would be handing the
    // instructor something that was never handed in.
    const { log, held, snapshot } = submitted();
    const then = stateAtCheckpoint(PROJECT, log.events, snapshot);

    expect(then?.thoughts[held]).toBeUndefined();
    expect(log.state.thoughts[held]).toBeDefined();
  });

  it('does not carry back anything created after the checkpoint', () => {
    const { log, snapshot } = submitted();
    const later = log.id<ObjectId>();
    log.push('student', {
      type: 'thought.created',
      payload: {
        objectId: later, versionId: log.id<VersionId>(), type: 'CLAIM',
        text: 'A claim written after submitting.', note: '', position: { x: 0, y: 0 },
      },
    });

    const then = stateAtCheckpoint(PROJECT, log.events, snapshot);
    expect(then?.thoughts[later]).toBeUndefined();
    expect(assembleBrief(then!).sections.find((s) => s.id === 'claims')?.lines).toHaveLength(1);
  });

  it('keeps only the history up to the version that was frozen', () => {
    const { log, claim, snapshot, v1 } = submitted();
    revise(log, claim, 'Revised once after submitting.');
    revise(log, claim, 'Revised twice after submitting.');

    const then = stateAtCheckpoint(PROJECT, log.events, snapshot);
    expect(then?.versions[claim]).toHaveLength(1);
    expect(then?.versions[claim]?.[0]?.versionId).toBe(v1);
    expect(log.state.versions[claim]).toHaveLength(3);
  });

  it('drops an edge to something that was not submitted', () => {
    const { log, claim, held, snapshot } = submitted();
    void claim; void held;
    const then = stateAtCheckpoint(PROJECT, log.events, snapshot);
    // The held thought is gone, so nothing may point at it.
    for (const edge of Object.values(then?.relations ?? {})) {
      expect(then?.thoughts[edge.from]).toBeDefined();
      expect(then?.thoughts[edge.to]).toBeDefined();
    }
  });

  it('is undefined for a checkpoint that does not exist', () => {
    const { log } = submitted();
    expect(stateAtCheckpoint(PROJECT, log.events, 'nope' as SnapshotId)).toBeUndefined();
  });

  it('lists the checkpoints in the order they were submitted', () => {
    const { log, claim, snapshot } = submitted();
    const v2 = revise(log, claim, 'Revised, then submitted again.');
    const second = log.id<SnapshotId>();
    log.push('student', {
      type: 'checkpoint.submitted',
      payload: {
        snapshotId: second, assignmentId: null,
        entries: [{ objectId: claim, versionId: v2 }],
      },
    });

    const list = checkpointsOf(log.state);
    expect(list.map((c) => c.snapshotId)).toEqual([snapshot, second]);

    // And each one reconstructs its own text.
    const first = stateAtCheckpoint(PROJECT, log.events, snapshot);
    const latest = stateAtCheckpoint(PROJECT, log.events, second);
    expect(first?.thoughts[claim]?.text).not.toBe(latest?.thoughts[claim]?.text);
    expect(latest?.thoughts[claim]?.text).toBe('Revised, then submitted again.');
  });
});
