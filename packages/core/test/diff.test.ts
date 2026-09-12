import { describe, expect, it } from 'vitest';
import { diffSinceReview, diffWords, summariseDiff, versionTrail } from '../src/diff.js';
import type { MoveId, ObjectId, VersionId } from '../src/ids.js';
import { Log } from './helpers.js';

const join = (spans: ReturnType<typeof diffWords>, kind?: string): string =>
  spans.filter((s) => kind === undefined || s.kind === kind).map((s) => s.text).join('');

describe('a diff a reader can trust', () => {
  it('round-trips: the spans rebuild both sides exactly', () => {
    const before = 'Early AI assistance narrows the range of hypotheses students try.';
    const after = 'Early AI assistance narrows the range of hypotheses graduate students try first.';
    const spans = diffWords(before, after);

    expect(join(spans.filter((s) => s.kind !== 'added'))).toBe(before);
    expect(join(spans.filter((s) => s.kind !== 'removed'))).toBe(after);
  });

  it('reports an insertion as an addition and nothing else', () => {
    const spans = diffWords('performance rises', 'performance clearly rises');
    expect(join(spans, 'removed')).toBe('');
    expect(join(spans, 'added').trim()).toBe('clearly');
  });

  it('reports a deletion as a removal and nothing else', () => {
    const spans = diffWords('performance clearly rises', 'performance rises');
    expect(join(spans, 'added')).toBe('');
    expect(join(spans, 'removed').trim()).toBe('clearly');
  });

  it('merges a reworded phrase into one removal and one addition', () => {
    const spans = diffWords('it may conceal weaker ability', 'it may conceal thinner ability');
    const kinds = spans.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'removed')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'added')).toHaveLength(1);
  });

  it('says nothing changed when nothing changed', () => {
    const spans = diffWords('unchanged text', 'unchanged text');
    expect(spans).toEqual([{ kind: 'same', text: 'unchanged text' }]);
    expect(summariseDiff(spans).added).toBe(0);
    expect(summariseDiff(spans).removed).toBe(0);
  });

  it('calls a total replacement a rewrite', () => {
    const summary = summariseDiff(diffWords('one thing entirely', 'something wholly different'));
    expect(summary.rewritten).toBe(true);
    expect(summary.unchanged).toBe(0);
  });

  it('does not call an edit a rewrite', () => {
    const summary = summariseDiff(diffWords('performance rises but learning may not',
      'performance rises but independent learning may not'));
    expect(summary.rewritten).toBe(false);
    expect(summary.added).toBe(1);
  });

  it('handles an empty side without inventing words', () => {
    expect(summariseDiff(diffWords('', 'new text')).removed).toBe(0);
    expect(summariseDiff(diffWords('old text', '')).added).toBe(0);
  });

  it('falls back to a wholesale replacement rather than a huge table', () => {
    const long = Array.from({ length: 1200 }, (_, i) => `w${String(i)}`).join(' ');
    const spans = diffWords(long, `${long} extra`);
    expect(spans.map((s) => s.kind)).toEqual(['removed', 'added']);
  });
});

/** A claim, revised twice, once at the coach's prompting. */
function revisedTwice(): { log: Log; objectId: ObjectId; v1: VersionId; move: MoveId } {
  const log = new Log();
  const objectId = log.id<ObjectId>();
  const v1 = log.id<VersionId>();

  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: v1, type: 'IDEA',
      text: 'AI assistance narrows the hypotheses students try.',
      note: '', position: { x: 0, y: 0 },
    },
  });

  const move = log.id<MoveId>();
  log.push('coach', {
    type: 'coach.moved',
    payload: {
      moveId: move, kind: 'ask', targetObjectId: objectId, hintLevel: 0,
      body: 'Which students, and narrows compared with what?', flag: null,
    },
  });

  // Revised at the coach's prompting, so the trail can resolve the prompt.
  const v2 = log.id<VersionId>();
  log.push('student', {
    type: 'thought.revised',
    promptedBy: move,
    payload: {
      objectId, versionId: v2, parentVersionId: v1,
      text: 'AI assistance narrows the hypotheses graduate students try.',
      note: '',
    },
  });

  log.push('student', {
    type: 'thought.retyped',
    payload: {
      objectId, versionId: log.id<VersionId>(), parentVersionId: v2, type: 'CLAIM',
    },
  });

  return { log, objectId, v1, move };
}

describe('the trail reads as a record', () => {
  it('numbers every version and leaves the first without a diff', () => {
    const { log, objectId } = revisedTwice();
    const trail = versionTrail(log.state, objectId);

    expect(trail.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(trail[0]?.diff).toBeNull();
    expect(trail[0]?.summary).toBeNull();
    expect(trail[1]?.diff).not.toBeNull();
  });

  it('shows what moved between revisions', () => {
    const { log, objectId } = revisedTwice();
    const trail = versionTrail(log.state, objectId);
    expect(join(trail[1]?.diff ?? [], 'added').trim()).toBe('graduate');
    expect(trail[1]?.summary?.added).toBe(1);
  });

  it('marks the step that changed the type rather than the words', () => {
    const { log, objectId } = revisedTwice();
    const trail = versionTrail(log.state, objectId);

    expect(trail[2]?.retyped).toBe(true);
    expect(trail[2]?.type).toBe('CLAIM');
    // A retype keeps the words, so there is nothing to show as a text change.
    expect(trail[2]?.summary?.added).toBe(0);
    expect(trail[2]?.summary?.removed).toBe(0);
    expect(trail[1]?.retyped).toBe(false);
  });

  it('keeps every earlier version, since nothing is overwritten', () => {
    const { log, objectId } = revisedTwice();
    const trail = versionTrail(log.state, objectId);
    expect(trail[0]?.type).toBe('IDEA');
    expect(trail[0]?.text).toContain('students try.');
    expect(trail).toHaveLength(3);
  });

  it('records the student as the author of every version', () => {
    const { log, objectId } = revisedTwice();
    for (const step of versionTrail(log.state, objectId)) {
      expect(step.authoredBy).toBe('student');
    }
  });
});

describe('the comparison a comment owes the student', () => {
  it('shows the reviewed version against the live one', () => {
    const { log, objectId, v1 } = revisedTwice();
    const review = diffSinceReview(log.state, objectId, v1);

    expect(review?.reviewedNumber).toBe(1);
    expect(review?.currentNumber).toBe(3);
    expect(join(review?.diff ?? [], 'added').trim()).toBe('graduate');
  });

  it('shows no change when the comment is on the live version', () => {
    const { log, objectId } = revisedTwice();
    const current = log.state.thoughts[objectId]?.currentVersionId as VersionId;
    const review = diffSinceReview(log.state, objectId, current);

    expect(review?.reviewedNumber).toBe(review?.currentNumber);
    expect(review?.summary.added).toBe(0);
    expect(review?.summary.removed).toBe(0);
  });

  it('is undefined for a version that was never recorded', () => {
    const { log, objectId } = revisedTwice();
    expect(diffSinceReview(log.state, objectId, 'nope' as VersionId)).toBeUndefined();
  });
});

describe('provenance is readable, not just recorded', () => {
  it('resolves the coach move that prompted a revision', () => {
    const { log, objectId, move } = revisedTwice();
    const trail = versionTrail(log.state, objectId);

    expect(trail[1]?.prompt?.moveId).toBe(move);
    expect(trail[1]?.prompt?.kind).toBe('ask');
    expect(trail[1]?.prompt?.body).toContain('Which students');
  });

  it('leaves the prompt null where the student wrote unprompted', () => {
    const { log, objectId } = revisedTwice();
    const trail = versionTrail(log.state, objectId);
    expect(trail[0]?.prompt).toBeNull();
  });
});
