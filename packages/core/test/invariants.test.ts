import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../src/invariants.js';
import { append } from '../src/state.js';
import type { ObjectId, PassageId, SourceId, VersionId } from '../src/ids.js';
import { Log } from './helpers.js';

const seedSource = (log: Log, access: 'metadata' | 'abstract' | 'open_full_text') => {
  const sourceId = log.id<SourceId>();
  log.push('coach', {
    type: 'source.discovered',
    payload: {
      sourceId, access, cite: 'Smith et al., 2025',
      title: 'AI Assistance and Hypothesis Generation',
      method: 'Experimental', abstract: null, externalUrl: null, doi: null,
    },
  });
  return sourceId;
};

const capture = (log: Log, sourceId: SourceId) => {
  const passageId = log.id<PassageId>();
  log.push('coach', {
    type: 'passage.captured',
    payload: {
      passageId, sourceId,
      text: 'Students exposed to generated examples produced fewer unique hypotheses.',
      locator: 'p. 4', provenance: 'retrieved',
    },
  });
  return passageId;
};

describe('i. the coach never writes thought text', () => {
  it('rejects a thought created by the coach', () => {
    const log = new Log();
    const bad = log.draft('coach', {
      type: 'thought.created',
      payload: {
        objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(),
        type: 'WONDER', text: 'Are they actually learning more?', note: '',
        position: { x: 0, y: 0 },
      },
    });
    expect(() => append(log.state, bad)).toThrow(InvariantViolation);
    expect(() => append(log.state, bad)).toThrow(/i\.authorship/);
  });

  it('accepts the same thought from the student', () => {
    const log = new Log();
    expect(() => log.push('student', {
      type: 'thought.created',
      payload: {
        objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(),
        type: 'WONDER', text: 'Are they actually learning more?', note: '',
        position: { x: 0, y: 0 },
      },
    })).not.toThrow();
  });

  it('lets the coach write an objection, because that is not the student thought', () => {
    const log = new Log();
    expect(() => log.push('coach', {
      type: 'coach.moved',
      payload: {
        moveId: log.id(), kind: 'challenge', targetObjectId: null, hintLevel: 0,
        body: 'What alternative explanation could produce the same observation?',
        flag: null,
      },
    })).not.toThrow();
  });

  it('does not let an instructor touch the graph', () => {
    const log = new Log();
    const bad = log.draft('instructor', {
      type: 'thought.created',
      payload: {
        objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(),
        type: 'CLAIM', text: 'Rewritten by the grader.', note: '', position: { x: 0, y: 0 },
      },
    });
    expect(() => append(log.state, bad)).toThrow(/i\.authorship/);
  });
});

describe('ii. evidence needs real text and a written interpretation', () => {
  const buildEvidence = (
    log: Log, sourceId: SourceId, passageId: PassageId,
    over: Partial<{ interpretation: string; warrant: string }> = {},
  ) => log.draft('student', {
    type: 'evidence.created',
    payload: {
      objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(),
      sourceId, passageId,
      interpretation: 'Generated examples narrowed the range of hypotheses students tried.',
      warrant: 'This licenses a claim about variety, not about understanding.',
      position: { x: 0, y: 0 },
      ...over,
    },
  });

  it('refuses a source held only at abstract level', () => {
    const log = new Log();
    const sourceId = seedSource(log, 'abstract');
    const passageId = log.id<PassageId>();
    expect(() => append(log.state, buildEvidence(log, sourceId, passageId)))
      .toThrow(/ii\.evidence/);
  });

  it('refuses when no passage was ever captured', () => {
    const log = new Log();
    const sourceId = seedSource(log, 'open_full_text');
    const passageId = log.id<PassageId>();
    expect(() => append(log.state, buildEvidence(log, sourceId, passageId)))
      .toThrow(/never implies text it has not retrieved/);
  });

  it('refuses an empty warrant', () => {
    const log = new Log();
    const sourceId = seedSource(log, 'open_full_text');
    const passageId = capture(log, sourceId);
    expect(() => append(log.state, buildEvidence(log, sourceId, passageId, { warrant: '   ' })))
      .toThrow(/warrant is empty/);
  });

  it('accepts full text plus both fields', () => {
    const log = new Log();
    const sourceId = seedSource(log, 'open_full_text');
    const passageId = capture(log, sourceId);
    expect(() => { log.state = append(log.state, buildEvidence(log, sourceId, passageId)); })
      .not.toThrow();
  });

  it('accepts an upload that promotes a paywalled source', () => {
    const log = new Log();
    const sourceId = seedSource(log, 'metadata');
    log.push('student', { type: 'source.uploaded', payload: { sourceId } });
    expect(log.state.sources[sourceId]?.access).toBe('user_upload');
    const passageId = log.id<PassageId>();
    log.push('coach', {
      type: 'passage.captured',
      payload: {
        passageId, sourceId, text: 'Comprehension scores were unchanged.',
        locator: 'p. 11', provenance: 'uploaded',
      },
    });
    expect(() => { log.state = append(log.state, buildEvidence(log, sourceId, passageId)); })
      .not.toThrow();
  });
});

describe('iii. a detected claim is a proposal until accepted', () => {
  it('refuses a proposal the coach accepts on the student behalf', () => {
    const log = new Log();
    const proposalId = log.id();
    log.push('coach', {
      type: 'proposal.raised',
      payload: {
        proposalId, kind: 'claim', suggestedType: 'CLAIM', targetObjectId: null,
        rationale: 'This reads like a claim rather than a note.',
      },
    });
    const bad = log.draft('coach', {
      type: 'proposal.accepted',
      payload: { proposalId, objectId: log.id<ObjectId>() },
    });
    expect(() => append(log.state, bad)).toThrow(/iii\.proposal/);
  });
});

describe('v. support escalates one rung at a time', () => {
  it('refuses a jump straight to the sentence frame', () => {
    const log = new Log();
    const objectId = log.id<ObjectId>();
    log.push('student', {
      type: 'thought.created',
      payload: {
        objectId, versionId: log.id<VersionId>(), type: 'TENSION',
        text: 'Performance increases, but independent learning may not.',
        note: '', position: { x: 0, y: 0 },
      },
    });
    const bad = log.draft('coach', {
      type: 'coach.moved',
      payload: {
        moveId: log.id(), kind: 'offer_sentence_frame', targetObjectId: objectId,
        hintLevel: 3, body: 'Try completing: Although ___, ___.', flag: null,
      },
    });
    expect(() => append(log.state, bad)).toThrow(/v\.ladder/);
  });
});

describe('vi. identities are minted once and revisions branch from current', () => {
  it('refuses a revision against a stale parent', () => {
    const log = new Log();
    const objectId = log.id<ObjectId>();
    const v1 = log.id<VersionId>();
    log.push('student', {
      type: 'thought.created',
      payload: {
        objectId, versionId: v1, type: 'QUESTION',
        text: 'Does AI reduce independent thinking?', note: '', position: { x: 0, y: 0 },
      },
    });
    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId, versionId: log.id<VersionId>(), parentVersionId: v1,
        text: 'Does AI reduce independent idea generation?', note: '',
      },
    });
    const bad = log.draft('student', {
      type: 'thought.revised',
      payload: {
        objectId, versionId: log.id<VersionId>(), parentVersionId: v1,
        text: 'A third edit branching off a version that is no longer current.', note: '',
      },
    });
    expect(() => append(log.state, bad)).toThrow(/is not current/);
  });
});
