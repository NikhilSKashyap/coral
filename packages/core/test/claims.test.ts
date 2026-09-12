import { describe, expect, it } from 'vitest';
import type { MoveId, ObjectId, ProposalId, VersionId } from '../src/ids.js';
import { observableRecord } from '../src/metrics.js';
import { versionTrail } from '../src/diff.js';
import { Log } from './helpers.js';

/**
 * A detected claim is a reading of words the student already wrote.
 *
 * So accepting one retypes their thought rather than creating a new one, and
 * the identity survives: the same object, one version later, now a claim. That
 * is slice 00's identity-versus-version split earning its keep.
 */

const idea = (log: Log, text: string): ObjectId => {
  const objectId = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: log.id<VersionId>(), type: 'IDEA',
      text, note: '', position: { x: 0, y: 0 },
    },
  });
  return objectId;
};

const detect = (log: Log, target: ObjectId): ProposalId => {
  const proposalId = log.id<ProposalId>();
  log.push('coach', {
    type: 'proposal.raised',
    payload: {
      proposalId, kind: 'claim', suggestedType: 'CLAIM', targetObjectId: target,
      rationale: 'This asserts something that could be disagreed with.',
    },
  });
  return proposalId;
};

describe('accepting a detected claim retypes, never re-creates', () => {
  it('keeps the identity and mints a version', () => {
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    const proposalId = detect(log, objectId);
    const before = log.state.thoughts[objectId];

    log.push('student', {
      type: 'thought.retyped',
      payload: {
        objectId, versionId: log.id<VersionId>(),
        parentVersionId: before?.currentVersionId as VersionId, type: 'CLAIM',
      },
    });
    log.push('student', { type: 'proposal.accepted', payload: { proposalId, objectId } });

    const after = log.state.thoughts[objectId];
    expect(after?.objectId).toBe(objectId);
    expect(after?.type).toBe('CLAIM');
    // The words are untouched: accepting is a decision about them, not a rewrite.
    expect(after?.text).toBe(before?.text);
    expect(log.state.versions[objectId]).toHaveLength(2);
    expect(log.state.proposals[proposalId]?.acceptedAs).toBe(objectId);
  });

  it('refuses a coach retyping a student\'s thought', () => {
    // Changing what a thought *is* changes what the student is committed to.
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    const current = log.state.thoughts[objectId]?.currentVersionId as VersionId;

    expect(() =>
      log.push('coach', {
        type: 'thought.retyped',
        payload: {
          objectId, versionId: log.id<VersionId>(),
          parentVersionId: current, type: 'CLAIM',
        },
      }),
    ).toThrow(/i\.authorship/);
    expect(log.state.thoughts[objectId]?.type).toBe('IDEA');
  });

  it('refuses a retype branching from a version that is no longer current', () => {
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    const stale = log.state.thoughts[objectId]?.currentVersionId as VersionId;

    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId, versionId: log.id<VersionId>(), parentVersionId: stale,
        text: 'Early AI assistance narrows the hypotheses graduate students try.', note: '',
      },
    });

    expect(() =>
      log.push('student', {
        type: 'thought.retyped',
        payload: {
          objectId, versionId: log.id<VersionId>(), parentVersionId: stale, type: 'CLAIM',
        },
      }),
    ).toThrow(/vi\.identity/);
  });

  it('shows the retype as a step in the trail with the words unchanged', () => {
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    log.push('student', {
      type: 'thought.retyped',
      payload: {
        objectId, versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[objectId]?.currentVersionId as VersionId,
        type: 'CLAIM',
      },
    });

    const trail = versionTrail(log.state, objectId);
    expect(trail).toHaveLength(2);
    expect(trail[1]?.retyped).toBe(true);
    expect(trail[1]?.summary?.added).toBe(0);
    expect(trail[1]?.summary?.removed).toBe(0);
  });
});

describe('the record counts a claim however it arrived', () => {
  it('counts one typed as a claim and one retyped into a claim', () => {
    const log = new Log();

    log.push('student', {
      type: 'thought.created',
      payload: {
        objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(), type: 'CLAIM',
        text: 'Written as a claim from the start.', note: '', position: { x: 0, y: 0 },
      },
    });

    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    log.push('student', {
      type: 'thought.retyped',
      payload: {
        objectId, versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[objectId]?.currentVersionId as VersionId,
        type: 'CLAIM',
      },
    });

    const record = observableRecord(log.state, log.events);
    expect(record.claimsCreated).toBe(2);
    // The difference between the two is observable, and is still only a count.
    expect(record.claimsFromDetection).toBe(1);
  });

  it('does not count a retype to something that is not a claim', () => {
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    log.push('student', {
      type: 'thought.retyped',
      payload: {
        objectId, versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[objectId]?.currentVersionId as VersionId,
        type: 'ASSUMPTION',
      },
    });

    const record = observableRecord(log.state, log.events);
    expect(record.claimsCreated).toBe(0);
    expect(record.claimsFromDetection).toBe(0);
  });

  it('still says nothing about whether the student chose well', () => {
    const log = new Log();
    const objectId = idea(log, 'Early AI assistance narrows the hypotheses students try.');
    detect(log, objectId);
    for (const key of Object.keys(observableRecord(log.state, log.events))) {
      expect(key).not.toMatch(/score|level|grade|rating|ability|capabilit/i);
    }
  });
});
