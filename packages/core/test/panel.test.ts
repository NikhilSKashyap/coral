import { describe, expect, it } from 'vitest';
import { evidencePanel, thinkingTimeline } from '../src/panel.js';
import type {
  CommentId, ObjectId, PassageId, RelationId, SnapshotId, SourceId, VersionId,
} from '../src/ids.js';
import { Log } from './helpers.js';

/**
 * The panel is where a score would feel natural, so this is where the refusal
 * has to be tested hardest.
 */

function session(): { log: Log; claim: ObjectId; question: ObjectId } {
  const log = new Log();

  const question = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId: question, versionId: log.id<VersionId>(), type: 'QUESTION',
      text: 'How does drafting with AI affect unaided synthesis?',
      note: '', position: { x: 0, y: 0 },
    },
  });

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

  // A source read but never cited.
  const sourceId = log.id<SourceId>();
  log.push('coach', {
    type: 'source.discovered',
    payload: {
      sourceId, access: 'abstract', cite: 'Marek, 2026',
      title: 'Transfer After Scaffolded Analysis', method: null,
      abstract: 'An abstract.', externalUrl: null, doi: null,
    },
  });
  log.push('student', { type: 'source.saved', payload: { sourceId } });

  // A source cited as evidence.
  const backing = log.id<SourceId>();
  const passageId = log.id<PassageId>();
  log.push('coach', {
    type: 'source.discovered',
    payload: {
      sourceId: backing, access: 'open_full_text', cite: 'Okoro & Lind, 2024',
      title: 'Task Speed, Effort, and Perceived Learning', method: null,
      abstract: null, externalUrl: null, doi: null,
    },
  });
  log.push('coach', {
    type: 'passage.captured',
    payload: {
      passageId, sourceId: backing, text: 'Comprehension scores were unchanged.',
      locator: 'p. 11', provenance: 'retrieved',
    },
  });
  const evidence = log.id<ObjectId>();
  log.push('student', {
    type: 'evidence.created',
    payload: {
      objectId: evidence, versionId: log.id<VersionId>(), sourceId: backing, passageId,
      interpretation: 'Speed rose while comprehension stayed flat.',
      warrant: 'Licenses a claim about effort, not understanding.',
      position: { x: 0, y: 0 },
    },
  });
  log.push('student', {
    type: 'relation.created',
    payload: { relationId: log.id<RelationId>(), from: evidence, to: claim, relation: 'supports' },
  });

  log.push('student', {
    type: 'thought.revised',
    payload: {
      objectId: claim, versionId: log.id<VersionId>(), parentVersionId: v1,
      text: 'Drafting with AI narrows the hypotheses graduate students try.', note: '',
    },
  });

  return { log, claim, question };
}

describe('every figure can be opened', () => {
  it('carries the objects behind each count', () => {
    const { log, claim } = session();
    const panel = evidencePanel(log.state, log.events);

    const claims = panel.find((e) => e.id === 'claims');
    expect(claims?.value).toBe(1);
    expect(claims?.objectIds).toEqual([claim]);

    const revised = panel.find((e) => e.id === 'claims_revised');
    expect(revised?.value).toBe(1);
    expect(revised?.objectIds).toEqual([claim]);
  });

  it('resolves every object it names to something on the map', () => {
    const { log } = session();
    for (const item of evidencePanel(log.state, log.events)) {
      for (const objectId of item.objectIds) {
        expect(log.state.thoughts[objectId]).toBeDefined();
      }
      for (const sourceId of item.sourceIds) {
        expect(log.state.sources[sourceId]).toBeDefined();
      }
      // A figure is its own objects, never a total of other figures.
      expect(item.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('separates a source cited from a source merely saved', () => {
    const { log } = session();
    const panel = evidencePanel(log.state, log.events);

    expect(panel.find((e) => e.id === 'sources_cited')?.value).toBe(1);
    const uncited = panel.find((e) => e.id === 'sources_saved_never_cited');
    expect(uncited?.value).toBe(1);
    expect(log.state.sources[uncited?.sourceIds[0] as SourceId]?.cite).toBe('Marek, 2026');
  });

  it('reports no claim as unsupported once evidence is attached', () => {
    const { log } = session();
    expect(evidencePanel(log.state, log.events).find((e) => e.id === 'claims_without_evidence')?.value)
      .toBe(0);
  });
});

describe('vii. the panel describes the work and never the worker', () => {
  it('has no figure that reads as a score', () => {
    const { log } = session();
    for (const item of evidencePanel(log.state, log.events)) {
      expect(item.id).not.toMatch(/score|level|grade|rating|ability|capabilit|quality/i);
      expect(item.label).not.toMatch(/score|grade|strong|weak|good|poor|excellent|proficien/i);
      expect(item.note).not.toMatch(/\bthey (are|seem|struggle|lack)\b/i);
    }
  });

  it('states plainly that neither taking nor declining a suggestion is better', () => {
    const { log } = session();
    const declined = evidencePanel(log.state, log.events)
      .find((e) => e.id === 'proposals_dismissed');
    expect(declined?.note).toMatch(/Neither number is better/);
  });

  it('counts asking for help without calling it needing help', () => {
    const { log } = session();
    const hints = evidencePanel(log.state, log.events).find((e) => e.id === 'hints_requested');
    expect(hints?.note).toMatch(/counts the asking, not the needing/);
  });
});

describe('the thinking evolution reads as what the student did', () => {
  it('records the moves that changed the shape of the argument, in order', () => {
    const { log } = session();
    const timeline = thinkingTimeline(log.state, log.events);

    expect(timeline.map((m) => m.kind)).toEqual(['framed', 'claimed', 'evidenced', 'revised']);
    const seqs = timeline.map((m) => m.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('quotes the student rather than paraphrasing them', () => {
    const { log } = session();
    const claimed = thinkingTimeline(log.state, log.events).find((m) => m.kind === 'claimed');
    expect(claimed?.quote).toBe('Drafting with AI narrows the hypotheses students try.');
  });

  it('leaves the coach out of it', () => {
    // A timeline padded with prompts would read as a record of what the student
    // was told rather than what they did.
    const { log, claim } = session();
    log.push('coach', {
      type: 'coach.moved',
      payload: {
        moveId: log.id<VersionId>(), kind: 'ask', targetObjectId: claim,
        hintLevel: 0, body: 'Which students?', flag: null,
      },
    });
    const kinds = thinkingTimeline(log.state, log.events).map((m) => m.kind);
    expect(kinds).not.toContain('coached');
    expect(thinkingTimeline(log.state, log.events)).toHaveLength(4);
  });

  it('shows a submission and the feedback loop that followed it', () => {
    const { log, claim } = session();
    const current = log.state.thoughts[claim]?.currentVersionId as VersionId;

    const snapshot = log.id<SnapshotId>();
    log.push('student', {
      type: 'checkpoint.submitted',
      payload: {
        snapshotId: snapshot, assignmentId: null,
        entries: [{ objectId: claim, versionId: current }],
      },
    });
    const commentId = log.id<CommentId>();
    log.push('instructor', {
      type: 'comment.created',
      payload: {
        commentId, snapshotId: snapshot, objectId: claim, versionId: current,
        kind: 'question', body: 'Compared with what?',
      },
    });
    const answering = log.id<VersionId>();
    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId: claim, versionId: answering, parentVersionId: current,
        text: 'Drafting with AI narrows the hypotheses graduate students try unaided.', note: '',
      },
    });
    log.push('student', {
      type: 'comment.resolved',
      payload: { commentId, byVersionId: answering },
    });

    const kinds = thinkingTimeline(log.state, log.events).map((m) => m.kind);
    expect(kinds.slice(-4)).toEqual(['submitted', 'reviewed', 'revised', 'resolved']);
  });
});
