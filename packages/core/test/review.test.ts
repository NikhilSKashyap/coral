import { describe, expect, it } from 'vitest';
import { commentDrift, openComments } from '../src/selectors.js';
import { diffSinceReview } from '../src/diff.js';
import {
  NO_REQUIREMENTS, checkRequirements, outstanding, requirementsMet,
} from '../src/requirements.js';
import type {
  CommentId, ObjectId, PassageId, SnapshotId, SourceId, VersionId,
} from '../src/ids.js';
import { Log } from './helpers.js';

/* ------------------------------------------------------------------ */

interface Reviewed {
  log: Log;
  claim: ObjectId;
  v1: VersionId;
  snapshot: SnapshotId;
  comment: CommentId;
}

/** A claim, submitted, commented on. The state every resolve test starts from. */
function reviewed(): Reviewed {
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

  const snapshot = log.id<SnapshotId>();
  log.push('student', {
    type: 'checkpoint.submitted',
    payload: { snapshotId: snapshot, assignmentId: null, entries: [{ objectId: claim, versionId: v1 }] },
  });

  const comment = log.id<CommentId>();
  log.push('instructor', {
    type: 'comment.created',
    payload: {
      commentId: comment, snapshotId: snapshot, objectId: claim, versionId: v1,
      kind: 'mark_for_revision',
      body: 'Which students, and narrows compared with what?',
    },
  });

  return { log, claim, v1, snapshot, comment };
}

const revise = (log: Log, claim: ObjectId, text: string): VersionId => {
  const versionId = log.id<VersionId>();
  log.push('student', {
    type: 'thought.revised',
    payload: {
      objectId: claim, versionId,
      parentVersionId: log.state.thoughts[claim]?.currentVersionId as VersionId,
      text, note: '',
    },
  });
  return versionId;
};

/* ------------------------------------------------------------------ */

describe('a student closes a comment by revising, not by agreeing', () => {
  it('refuses a resolution that names the version the instructor already read', () => {
    const { log, comment, v1 } = reviewed();

    expect(() =>
      log.push('student', {
        type: 'comment.resolved',
        payload: { commentId: comment, byVersionId: v1 },
      }),
    ).toThrow(/iv\.comment/);
    expect(openComments(log.state)).toHaveLength(1);
  });

  it('accepts one that names a version written since', () => {
    const { log, claim, comment } = reviewed();
    const v2 = revise(log, claim, 'Drafting with AI narrows the hypotheses graduate students try unaided.');

    log.push('student', {
      type: 'comment.resolved',
      payload: { commentId: comment, byVersionId: v2 },
    });

    expect(openComments(log.state)).toHaveLength(0);
    expect(log.state.comments[comment]?.resolvedByVersionId).toBe(v2);
  });

  it('lets an instructor close it at any version, since judging is their job', () => {
    // Sometimes the answer arrives as a new object rather than a new version of
    // the old one, and only a reader can tell.
    const { log, comment, v1 } = reviewed();

    log.push('instructor', {
      type: 'comment.resolved',
      payload: { commentId: comment, byVersionId: v1 },
    });
    expect(log.state.comments[comment]?.resolvedByVersionId).toBe(v1);
  });

  it('refuses resolving the same comment twice', () => {
    const { log, claim, comment } = reviewed();
    const v2 = revise(log, claim, 'Drafting with AI narrows the hypotheses graduate students try.');
    log.push('student', { type: 'comment.resolved', payload: { commentId: comment, byVersionId: v2 } });

    const v3 = revise(log, claim, 'Drafting with AI narrows what graduate students try unaided.');
    expect(() =>
      log.push('student', { type: 'comment.resolved', payload: { commentId: comment, byVersionId: v3 } }),
    ).toThrow(/already resolved/);
  });

  it('refuses a version that was never recorded for that object', () => {
    const { log, comment } = reviewed();
    expect(() =>
      log.push('student', {
        type: 'comment.resolved',
        payload: { commentId: comment, byVersionId: log.id<VersionId>() },
      }),
    ).toThrow(/never recorded/);
  });
});

describe('a comment survives five revisions and still makes sense', () => {
  it('keeps pointing at what was read while the student moves on', () => {
    const { log, claim, comment, v1 } = reviewed();

    const texts = [
      'Drafting with AI narrows the hypotheses graduate students try.',
      'Drafting with AI narrows the hypotheses graduate students try unaided.',
      'Drafting with AI narrows the framings graduate students try unaided.',
      'Drafting with AI narrows the framings graduate students reach unaided.',
      'Early drafting with AI narrows the framings graduate students reach unaided.',
    ];
    for (const text of texts) revise(log, claim, text);

    const drift = commentDrift(log.state, comment);
    expect(drift?.versionsSince).toBe(5);
    expect(drift?.stale).toBe(true);
    // Still attached to the object, still naming the version that was read.
    expect(drift?.reviewedVersionId).toBe(v1);
    expect(log.state.comments[comment]?.objectId).toBe(claim);

    const review = diffSinceReview(log.state, claim, v1);
    expect(review?.reviewedNumber).toBe(1);
    expect(review?.currentNumber).toBe(6);
    expect(review?.reviewedText).toBe('Drafting with AI narrows the hypotheses students try.');
    expect(review?.currentText).toBe(texts[4]);
    expect(review?.summary.added).toBeGreaterThan(0);
  });

  it('refuses a comment on a version the checkpoint never froze', () => {
    const { log, claim, snapshot } = reviewed();
    const v2 = revise(log, claim, 'Revised after submitting.');

    expect(() =>
      log.push('instructor', {
        type: 'comment.created',
        payload: {
          commentId: log.id<CommentId>(), snapshotId: snapshot, objectId: claim,
          versionId: v2, kind: 'comment', body: 'On a version I never saw.',
        },
      }),
    ).toThrow(/iv\.comment/);
  });
});

/* ------------------------------------------------------------------ */

const cite = (log: Log): void => {
  const sourceId = log.id<SourceId>();
  const passageId = log.id<PassageId>();
  log.push('coach', {
    type: 'source.discovered',
    payload: {
      sourceId, access: 'open_full_text', cite: 'Okoro & Lind, 2024',
      title: 'Task Speed, Effort, and Perceived Learning', method: null,
      abstract: null, externalUrl: null, doi: null,
    },
  });
  log.push('coach', {
    type: 'passage.captured',
    payload: {
      passageId, sourceId, text: 'Comprehension scores were unchanged.',
      locator: 'p. 11', provenance: 'retrieved',
    },
  });
  log.push('student', {
    type: 'evidence.created',
    payload: {
      objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(), sourceId, passageId,
      interpretation: 'Speed rose while comprehension stayed flat.',
      warrant: 'Licenses a claim about effort, not understanding.',
      position: { x: 0, y: 0 },
    },
  });
};

describe('an assignment asks for counts, never for a grade', () => {
  it('asks for nothing when nothing is required', () => {
    const { log } = reviewed();
    const checks = checkRequirements(log.state, { sources: 0, counterArgument: false, aiProvenance: false });
    expect(checks).toHaveLength(0);
    expect(requirementsMet(checks)).toBe(true);
  });

  it('counts sources actually cited, not sources on the list', () => {
    const { log } = reviewed();
    const before = checkRequirements(log.state, { ...NO_REQUIREMENTS, sources: 1 });
    expect(before[0]?.met).toBe(false);
    expect(outstanding(before)).toHaveLength(1);

    cite(log);
    const after = checkRequirements(log.state, { ...NO_REQUIREMENTS, sources: 1 });
    expect(after[0]?.met).toBe(true);
    expect(after[0]?.detail).toContain('1 cited as evidence');
  });

  it('accepts a challenge or an alternative as a counter-argument', () => {
    const { log } = reviewed();
    const req = { ...NO_REQUIREMENTS, counterArgument: true };
    expect(checkRequirements(log.state, req)[0]?.met).toBe(false);

    log.push('student', {
      type: 'thought.created',
      payload: {
        objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(), type: 'ALTERNATIVE',
        text: 'The cohort changed between the assignments.', note: '', position: { x: 0, y: 0 },
      },
    });
    expect(checkRequirements(log.state, req)[0]?.met).toBe(true);
  });

  it('reports AI provenance as met, because it is structural', () => {
    // Nothing a student has to remember to attach: the log records what
    // prompted every write as it happens.
    const { log } = reviewed();
    const check = checkRequirements(log.state, { ...NO_REQUIREMENTS, aiProvenance: true })[0];
    expect(check?.met).toBe(true);
    expect(check?.id).toBe('ai_provenance');
  });

  it('says what is there and never how good it is', () => {
    const { log } = reviewed();
    cite(log);
    const checks = checkRequirements(log.state, { sources: 1, counterArgument: true, aiProvenance: true });
    for (const check of checks) {
      expect(check.detail).not.toMatch(/good|strong|weak|poor|excellent|sufficient|score|grade/i);
      expect(typeof check.met).toBe('boolean');
    }
  });

  it('links every figure to the objects behind it', () => {
    const { log } = reviewed();
    cite(log);
    const check = checkRequirements(log.state, { ...NO_REQUIREMENTS, sources: 1 })[0];
    expect(check?.objectIds.length).toBeGreaterThan(0);
    for (const objectId of check?.objectIds ?? []) {
      expect(log.state.thoughts[objectId]).toBeDefined();
    }
  });
});
