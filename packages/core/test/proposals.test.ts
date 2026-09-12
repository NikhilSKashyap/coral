import { describe, expect, it } from 'vitest';
import type { MoveId, ObjectId, ProposalId, RelationId, VersionId } from '../src/ids.js';
import { observableRecord } from '../src/metrics.js';
import {
  challengesRaised, openProposals, proposalsFor, unansweredChallenges,
} from '../src/selectors.js';
import { Log } from './helpers.js';

/**
 * The proposal lifecycle, which is how a coach suggestion becomes a thought.
 *
 * Slice 02's claim is that the model cannot write a student's thought even when
 * asked. The guard for that is invariant iii, and this file drives the only
 * sequence that satisfies it: the coach names a type, the student writes the
 * sentence, and the acceptance links the two.
 */

const seed = (log: Log): ObjectId => {
  const objectId = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: log.id<VersionId>(), type: 'TENSION',
      text: 'Performance increases, but independent learning may not.',
      note: '', position: { x: 0, y: 0 },
    },
  });
  return objectId;
};

/** What the server does when a move comes back as `propose_branch`. */
const propose = (
  log: Log,
  target: ObjectId,
  suggestedType: 'CHALLENGE' | 'ALTERNATIVE' | 'ASSUMPTION' = 'ALTERNATIVE',
  kind: 'branch' | 'challenge' = 'branch',
): ProposalId => {
  const proposalId = log.id<ProposalId>();
  log.push('coach', {
    type: 'coach.moved',
    payload: {
      moveId: log.id<MoveId>(),
      kind: kind === 'challenge' ? 'challenge' : 'propose_branch',
      targetObjectId: target,
      hintLevel: 0,
      body: 'Two readings of the same observation are live here.',
      flag: null,
    },
  });
  log.push('coach', {
    type: 'proposal.raised',
    payload: {
      proposalId, kind, suggestedType, targetObjectId: target,
      rationale: 'Two readings of the same observation are live here.',
    },
  });
  return proposalId;
};

/** What the accept route does: the student's words, then the link. */
const accept = (
  log: Log,
  proposalId: ProposalId,
  target: ObjectId,
  suggestedType: 'CHALLENGE' | 'ALTERNATIVE' | 'ASSUMPTION',
  text: string,
  relation: 'challenges' | 'suggests' = 'suggests',
): ObjectId => {
  const objectId = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: log.id<VersionId>(), type: suggestedType,
      text, note: '', position: { x: 0, y: 0 },
    },
  });
  log.push('student', {
    type: 'relation.created',
    payload: { relationId: log.id<RelationId>(), from: target, to: objectId, relation },
  });
  log.push('student', { type: 'proposal.accepted', payload: { proposalId, objectId } });
  return objectId;
};

describe('iii. a proposal is a type, and the sentence stays the student\'s', () => {
  it('sits open until the student rules on it', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target);

    expect(openProposals(log.state)).toHaveLength(1);
    expect(log.state.proposals[proposalId]?.status).toBe('open');
    expect(proposalsFor(log.state, target)).toHaveLength(1);
  });

  it('creates a thought whose type is the coach\'s and whose text is the student\'s', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target, 'ALTERNATIVE');
    const mine = 'Maybe the assignment got easier, not the students weaker.';
    const objectId = accept(log, proposalId, target, 'ALTERNATIVE', mine);

    const thought = log.state.thoughts[objectId];
    expect(thought?.type).toBe('ALTERNATIVE');
    expect(thought?.text).toBe(mine);
    // Authorship is recorded on the version, and it is the student's.
    expect(log.state.versions[objectId]?.[0]?.authoredBy).toBe('student');
    // The coach's rationale is nowhere in the thought.
    expect(thought?.text).not.toContain('Two readings');
  });

  it('marks the proposal accepted and points it at the object that answered it', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target);
    const objectId = accept(log, proposalId, target, 'ALTERNATIVE', 'A different reading.');

    expect(log.state.proposals[proposalId]?.status).toBe('accepted');
    expect(log.state.proposals[proposalId]?.acceptedAs).toBe(objectId);
    expect(openProposals(log.state)).toHaveLength(0);
  });

  it('refuses the coach accepting its own proposal', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target);

    expect(() =>
      log.push('coach', {
        type: 'proposal.accepted',
        payload: { proposalId, objectId: log.id<ObjectId>() },
      }),
    ).toThrow(/iii\.proposal/);
    expect(log.state.proposals[proposalId]?.status).toBe('open');
  });

  it('refuses accepting the same proposal twice', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target);
    accept(log, proposalId, target, 'ALTERNATIVE', 'A different reading.');

    expect(() =>
      log.push('student', {
        type: 'proposal.accepted',
        payload: { proposalId, objectId: log.id<ObjectId>() },
      }),
    ).toThrow(/already accepted/);
  });

  it('refuses accepting one that was dismissed, and keeps the dismissal on the record', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target);
    log.push('student', { type: 'proposal.dismissed', payload: { proposalId } });

    expect(log.state.proposals[proposalId]?.status).toBe('dismissed');
    expect(() =>
      log.push('student', {
        type: 'proposal.accepted',
        payload: { proposalId, objectId: log.id<ObjectId>() },
      }),
    ).toThrow(/already dismissed/);
  });
});

describe('a challenge is answered on the map, not in the thread', () => {
  it('counts as unanswered until the student writes a thought against it', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target, 'CHALLENGE', 'challenge');

    expect(challengesRaised(log.state)).toHaveLength(1);
    expect(unansweredChallenges(log.state)).toHaveLength(1);

    accept(
      log, proposalId, target, 'CHALLENGE',
      'The cohort changed between the two assignments, which the speed reading ignores.',
      'challenges',
    );

    expect(unansweredChallenges(log.state)).toHaveLength(0);
  });

  it('wires the challenge to the thought it contests', () => {
    const log = new Log();
    const target = seed(log);
    const proposalId = propose(log, target, 'CHALLENGE', 'challenge');
    const objectId = accept(
      log, proposalId, target, 'CHALLENGE', 'The cohort changed.', 'challenges',
    );

    const edge = Object.values(log.state.relations).find((r) => r.to === objectId);
    expect(edge?.from).toBe(target);
    expect(edge?.relation).toBe('challenges');
    expect(edge?.authoredBy).toBe('student');
  });

  it('lets several objections stand against one thought at once', () => {
    const log = new Log();
    const target = seed(log);
    const first = propose(log, target, 'CHALLENGE', 'challenge');
    accept(log, first, target, 'CHALLENGE', 'The cohort changed.', 'challenges');
    const second = propose(log, target, 'CHALLENGE', 'challenge');
    accept(log, second, target, 'CHALLENGE', 'The rubric changed too.', 'challenges');

    // Challenge is a node, not a mode: nothing about it is stored on the project.
    expect(observableRecord(log.state, log.events).challengesExplored).toBe(2);
    expect(log.state).not.toHaveProperty('challengeMode');
  });
});

describe('the record counts what the student did with the suggestions', () => {
  it('reports raised against accepted, dismissed and still open', () => {
    const log = new Log();
    const target = seed(log);

    const accepted = propose(log, target);
    accept(log, accepted, target, 'ALTERNATIVE', 'A different reading.');
    const dismissed = propose(log, target);
    log.push('student', { type: 'proposal.dismissed', payload: { proposalId: dismissed } });
    propose(log, target);

    const record = observableRecord(log.state, log.events);
    expect(record.proposalsRaised).toBe(3);
    expect(record.proposalsAccepted).toBe(1);
    expect(record.proposalsDismissed).toBe(1);
    expect(record.proposalsOpen).toBe(1);
  });

  it('says nothing about whether the student chose well', () => {
    const log = new Log();
    const target = seed(log);
    propose(log, target);

    const record = observableRecord(log.state, log.events);
    for (const value of Object.values(record)) expect(typeof value).toBe('number');
    for (const key of Object.keys(record)) {
      expect(key).not.toMatch(/score|level|grade|rating|ability|capabilit/i);
    }
  });
});
