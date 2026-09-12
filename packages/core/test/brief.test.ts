import { describe, expect, it } from 'vitest';
import { assembleBrief, briefGaps, briefIsAnswerable, omittedFrom } from '../src/brief.js';
import type { BriefLine } from '../src/brief.js';
import { structuralGaps } from '../src/gaps.js';
import type {
  ObjectId, PassageId, RelationId, SourceId, VersionId,
} from '../src/ids.js';
import { Log } from './helpers.js';

/* ------------------------------------------------------------------ */

const think = (log: Log, type: string, text: string): ObjectId => {
  const objectId = log.id<ObjectId>();
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: log.id<VersionId>(), type,
      text, note: '', position: { x: 0, y: 0 },
    },
  });
  return objectId;
};

const join = (log: Log, from: ObjectId, to: ObjectId, relation: string): void => {
  log.push('student', {
    type: 'relation.created',
    payload: { relationId: log.id<RelationId>(), from, to, relation },
  });
};

/** A source held at full text, with a passage, ready to back evidence. */
const sourceWithPassage = (log: Log): { sourceId: SourceId; passageId: PassageId } => {
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
  log.push('student', { type: 'source.saved', payload: { sourceId } });
  log.push('coach', {
    type: 'passage.captured',
    payload: {
      passageId, sourceId,
      text: 'Comprehension scores were unchanged while completion time halved.',
      locator: 'p. 11', provenance: 'retrieved',
    },
  });
  return { sourceId, passageId };
};

/** A project with a question, a claim, its evidence, and an answered objection. */
function fullProject(): { log: Log; ids: Record<string, ObjectId> } {
  const log = new Log();
  const notice = think(log, 'NOTICE', 'Students submitted drafts three days earlier.');
  const wonder = think(log, 'WONDER', 'Are they understanding the sources better?');
  const question = think(log, 'QUESTION', 'How does drafting with AI affect unaided synthesis?');
  const claim = think(log, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');

  const { sourceId, passageId } = sourceWithPassage(log);
  const evidence = log.id<ObjectId>();
  log.push('student', {
    type: 'evidence.created',
    payload: {
      objectId: evidence, versionId: log.id<VersionId>(), sourceId, passageId,
      interpretation: 'Speed rose while comprehension stayed flat.',
      warrant: 'Licenses a claim about effort, not about understanding.',
      position: { x: 0, y: 0 },
    },
  });
  join(log, evidence, claim, 'supports');

  const challenge = think(log, 'CHALLENGE', 'The cohort changed between the two assignments.');
  join(log, claim, challenge, 'challenges');
  const answer = think(log, 'ALTERNATIVE', 'The rubric changed too, which would explain it.');
  join(log, challenge, answer, 'suggests');

  return { log, ids: { notice, wonder, question, claim, evidence, challenge, answer } };
}

const allText = (brief: ReturnType<typeof assembleBrief>): string[] => {
  const out: string[] = [];
  const walk = (lines: readonly BriefLine[]): void => {
    for (const l of lines) { out.push(l.text); walk(l.children); }
  };
  for (const s of brief.sections) walk(s.lines);
  return out;
};

/* ------------------------------------------------------------------ */

describe('iv. the brief is assembled, never generated', () => {
  it('contains no string the project does not already hold', () => {
    // The invariant, as a test. Every line must be findable in the state: a
    // thought's text, a passage, a student's interpretation or warrant, or a
    // citation. Anything else would be prose this module wrote.
    const { log } = fullProject();
    const brief = assembleBrief(log.state);

    const known = new Set<string>([
      ...Object.values(log.state.thoughts).map((t) => t.text),
      ...Object.values(log.state.passages).map((p) => p.text),
      ...Object.values(log.state.sources).map((s) => s.cite),
      ...Object.values(log.state.thoughts).flatMap((t) =>
        t.evidence === undefined ? [] : [t.evidence.interpretation, t.evidence.warrant]),
    ]);

    const lines = allText(brief);
    expect(lines.length).toBeGreaterThan(5);
    for (const text of lines) expect(known).toContain(text);
  });

  it('quotes the question word for word', () => {
    const { log, ids } = fullProject();
    const brief = assembleBrief(log.state);
    expect(brief.question).toBe(log.state.thoughts[ids['question'] as ObjectId]?.text);
  });

  it('traces every line to the object it came from', () => {
    const { log } = fullProject();
    const brief = assembleBrief(log.state);
    for (const objectId of brief.cited) {
      expect(log.state.thoughts[objectId]).toBeDefined();
    }
    expect(brief.cited.length).toBeGreaterThan(0);
  });

  it('puts the passage under the claim with the student\'s reading beneath it', () => {
    const { log } = fullProject();
    const claims = assembleBrief(log.state).sections.find((s) => s.id === 'claims');
    const support = claims?.lines[0]?.children ?? [];

    expect(support[0]?.role).toContain('Okoro & Lind');
    expect(support[0]?.text).toContain('Comprehension scores were unchanged');
    expect(support[0]?.children.map((c) => c.role)).toEqual(['your reading', 'what it licenses']);
  });
});

describe('an empty section is a gap, not prose', () => {
  it('renders a prompt rather than covering for the hole', () => {
    const log = new Log();
    think(log, 'NOTICE', 'Students submitted drafts three days earlier.');
    const brief = assembleBrief(log.state);

    const claims = brief.sections.find((s) => s.id === 'claims');
    expect(claims?.gap).toBe(true);
    expect(claims?.lines).toHaveLength(0);
    expect(claims?.gapPrompt).toMatch(/No claims yet/);
  });

  it('names every section still open', () => {
    const log = new Log();
    think(log, 'QUESTION', 'How does drafting with AI affect unaided synthesis?');
    const brief = assembleBrief(log.state);

    const open = briefGaps(brief).map((s) => s.id);
    expect(open).toContain('claims');
    expect(open).toContain('synthesis');
    expect(open).not.toContain('question');
  });

  it('is answerable once there is a question and a claim, however thin', () => {
    const log = new Log();
    expect(briefIsAnswerable(assembleBrief(log.state))).toBe(false);

    think(log, 'QUESTION', 'How does drafting with AI affect unaided synthesis?');
    expect(briefIsAnswerable(assembleBrief(log.state))).toBe(false);

    think(log, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');
    // Thin is not incomplete: no objections and no synthesis is still answerable.
    expect(briefIsAnswerable(assembleBrief(log.state))).toBe(true);
  });

  it('leaves nothing on the map silently out of the brief', () => {
    const { log } = fullProject();
    const brief = assembleBrief(log.state);
    const omitted = omittedFrom(log.state, brief);
    // Everything in this project belongs to a section.
    expect(omitted.map((t) => t.type)).toEqual([]);
  });
});

describe('the gaps the graph can prove', () => {
  it('flags a claim with no evidence, on the claim itself', () => {
    const log = new Log();
    const claim = think(log, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');
    const brief = assembleBrief(log.state);

    expect(structuralGaps(log.state).map((g) => g.flag)).toContain('claim_without_evidence');
    const line = brief.sections.find((s) => s.id === 'claims')?.lines[0];
    expect(line?.objectId).toBe(claim);
    expect(line?.flags).toContain('claim_without_evidence');
  });

  it('does not flag a claim that has evidence', () => {
    const { log } = fullProject();
    expect(structuralGaps(log.state).map((g) => g.flag)).not.toContain('claim_without_evidence');
  });

  it('flags an objection nobody answered, and clears it once answered', () => {
    const log = new Log();
    const claim = think(log, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');
    const challenge = think(log, 'CHALLENGE', 'The cohort changed between the assignments.');
    join(log, claim, challenge, 'challenges');

    expect(structuralGaps(log.state).map((g) => g.flag)).toContain('unresolved_challenge');

    const answer = think(log, 'ALTERNATIVE', 'The rubric changed too.');
    join(log, challenge, answer, 'suggests');
    expect(structuralGaps(log.state).map((g) => g.flag)).not.toContain('unresolved_challenge');
  });

  it('flags a source saved and never cited', () => {
    const log = new Log();
    sourceWithPassage(log);
    expect(structuralGaps(log.state).map((g) => g.flag)).toContain('source_saved_never_cited');
  });

  it('flags a question that has been substantially rewritten', () => {
    const log = new Log();
    const question = think(log, 'QUESTION', 'Does AI help students learn?');
    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId: question, versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[question]?.currentVersionId as VersionId,
        text: 'For graduate students, how does drafting with generative AI affect unaided synthesis of conflicting sources?',
        note: '',
      },
    });
    const drift = structuralGaps(log.state).find((g) => g.flag === 'question_drift');
    expect(drift).toBeDefined();
    expect(drift?.objectIds).toContain(question);
  });

  it('does not flag a question that only gained a word', () => {
    const log = new Log();
    const question = think(log, 'QUESTION', 'How does drafting with AI affect unaided synthesis of sources?');
    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId: question, versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[question]?.currentVersionId as VersionId,
        text: 'How does drafting with AI affect unaided synthesis of conflicting sources?',
        note: '',
      },
    });
    expect(structuralGaps(log.state).map((g) => g.flag)).not.toContain('question_drift');
  });

  it('names a synthesis opening once two claims stand with none written', () => {
    const log = new Log();
    think(log, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');
    expect(assembleBrief(log.state).synthesisOpening).toBe(false);

    think(log, 'CLAIM', 'Unaided synthesis surfaces more contradictions.');
    expect(assembleBrief(log.state).synthesisOpening).toBe(true);

    think(log, 'SYNTHESIS', 'Both hold if the effect is about effort rather than ability.');
    expect(assembleBrief(log.state).synthesisOpening).toBe(false);
  });

  it('describes the work and never the worker', () => {
    const { log } = fullProject();
    const log2 = new Log();
    think(log2, 'CLAIM', 'Drafting with AI narrows the hypotheses students try.');

    for (const gap of [...structuralGaps(log.state), ...structuralGaps(log2.state)]) {
      expect(gap.detail).not.toMatch(/\byou (are|seem|have not|should)\b/i);
      expect(gap.detail).not.toMatch(/score|grade|level|ability|weak|strong/i);
    }
  });
});
