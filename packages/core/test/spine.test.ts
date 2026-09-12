import { describe, expect, it } from 'vitest';
import type { MoveId, ObjectId, RelationId, VersionId } from '../src/ids.js';
import { COACH_MOVE_KINDS, HINT_LADDER, RELATIONS } from '../src/types.js';
import {
  REFINEMENT_CHECKS, RUNG_KIND, SPINE, SPINE_RELATION, SPINE_STAGES,
  currentStage, draftFrame, establishedPieces, isOnSpine, previousStage,
  spineComplete, spineOf, spineProgress,
} from '../src/spine.js';
import { Log } from './helpers.js';

/** Write one stage the way the server's `/spine` route does. */
function stage(log: Log, s: (typeof SPINE_STAGES)[number], text: string): ObjectId {
  const objectId = log.id<ObjectId>();
  const prior = previousStage(s);
  const from = prior === null ? undefined : spineOf(log.state)[prior];

  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId, versionId: log.id<VersionId>(), type: s, text, note: '',
      position: { x: 0, y: 0 },
    },
  });
  if (from !== undefined && s !== 'NOTICE') {
    log.push('student', {
      type: 'relation.created',
      payload: {
        relationId: log.id<RelationId>(), from: from.objectId, to: objectId,
        relation: SPINE_RELATION[s],
      },
    });
  }
  log.push('coach', {
    type: 'coach.moved',
    payload: {
      moveId: log.id<MoveId>(), kind: 'reflect', targetObjectId: objectId,
      hintLevel: 0, body: SPINE[s].hints[0], flag: null,
    },
  });
  log.push('coach', {
    type: 'coach.moved',
    payload: {
      moveId: log.id<MoveId>(), kind: 'ask', targetObjectId: objectId,
      hintLevel: 0, body: SPINE[s].after, flag: null,
    },
  });
  return objectId;
}

const WALK: Array<[(typeof SPINE_STAGES)[number], string]> = [
  ['NOTICE', 'Students complete assignments much faster when they use AI.'],
  ['WONDER', 'Are they actually learning more?'],
  ['TENSION', 'Performance increases, but independent learning may not.'],
  ['UNKNOWN', 'Can students perform the same reasoning without AI?'],
  ['QUESTION', 'How does generative AI use during literature synthesis affect graduate students?'],
];

const walk = (log: Log, upTo = WALK.length): Log => {
  for (const [s, text] of WALK.slice(0, upTo)) stage(log, s, text);
  return log;
};

describe('the framing spine is the same graph the map uses', () => {
  it('walks the five stages in order and refuses to skip', () => {
    const log = new Log();
    expect(currentStage(log.state)).toBe('NOTICE');

    walk(log, 1);
    expect(currentStage(log.state)).toBe('WONDER');

    walk(log);
    expect(currentStage(log.state)).toBeNull();
    expect(spineComplete(log.state)).toBe(true);
  });

  it('attaches each stage to the one before it with a relation from the shared vocabulary', () => {
    const log = walk(new Log());
    const spine = spineOf(log.state);

    for (const s of SPINE_STAGES) {
      if (s === 'NOTICE') continue;
      const relation = SPINE_RELATION[s];
      expect(RELATIONS).toContain(relation);
      const edge = Object.values(log.state.relations).find((r) => r.to === spine[s]?.objectId);
      expect(edge?.relation).toBe(relation);
    }
  });

  it('reads the walk back off the graph rather than from a stored cursor', () => {
    const log = walk(new Log());
    for (const s of SPINE_STAGES) {
      const t = spineOf(log.state)[s];
      expect(t).toBeDefined();
      expect(isOnSpine(log.state, t!.objectId)).toBe(true);
    }
  });

  it('is not displaced by a later branch of the same type', () => {
    const log = walk(new Log(), 2);
    const original = spineOf(log.state).WONDER;

    // A second WONDER branched off later must not take the stage's place.
    stageless(log, 'WONDER', 'A second, later wonder.');
    expect(spineOf(log.state).WONDER?.objectId).toBe(original?.objectId);
  });
});

describe('v. the ladder advances one rung per request', () => {
  it('climbs to the sentence frame one step at a time', () => {
    const log = walk(new Log(), 1);
    const notice = spineOf(log.state).NOTICE!.objectId;

    for (let rung = 1; rung <= 3; rung += 1) {
      log.push('coach', {
        type: 'coach.moved',
        payload: {
          moveId: log.id<MoveId>(), kind: RUNG_KIND[rung], targetObjectId: notice,
          hintLevel: rung, body: SPINE.NOTICE.hints[rung], flag: null,
        },
      });
    }
    expect(spineProgress(log.state).deepestRung).toBe(3);
  });

  it('refuses a jump straight to the sentence frame', () => {
    const log = walk(new Log(), 1);
    const notice = spineOf(log.state).NOTICE!.objectId;

    expect(() =>
      log.push('coach', {
        type: 'coach.moved',
        payload: {
          moveId: log.id<MoveId>(), kind: 'offer_sentence_frame', targetObjectId: notice,
          hintLevel: 3, body: SPINE.NOTICE.hints[3], flag: null,
        },
      }),
    ).toThrow(/v\.ladder/);
  });
});

describe('the copy is the ladder, and the ladder is the vocabulary', () => {
  it('gives every stage four rungs in the order the ladder declares', () => {
    expect(RUNG_KIND).toEqual([...HINT_LADDER]);
    for (const kind of RUNG_KIND) expect(COACH_MOVE_KINDS).toContain(kind);
    for (const s of SPINE_STAGES) {
      expect(SPINE[s].hints).toHaveLength(4);
      for (const hint of SPINE[s].hints) expect(hint.trim()).not.toBe('');
    }
  });

  it('ends every stage on a sentence frame and never on an answer', () => {
    for (const s of SPINE_STAGES) {
      expect(SPINE[s].hints[3]).toMatch(/^Try completing:/);
      expect(SPINE[s].hints[3]).toContain('___');
    }
  });
});

describe('iv. the Problem Frame is assembled, never generated', () => {
  it('takes the question verbatim from the student\'s own thought', () => {
    const log = walk(new Log());
    const draft = draftFrame(log.state, {});
    expect(draft?.question).toBe(WALK[4]![1]);
  });

  it('has nothing to frame before a question exists', () => {
    const log = walk(new Log(), 4);
    expect(draftFrame(log.state, {})).toBeNull();
  });

  it('leaves an unanswered prompt out rather than inventing one', () => {
    const log = walk(new Log());
    const answered = REFINEMENT_CHECKS[0];
    const draft = draftFrame(log.state, { [answered]: 'Graduate students in a synthesis seminar.' });

    expect(draft?.assumptions).toHaveLength(1);
    expect(draft?.assumptions[0]).toContain('Graduate students in a synthesis seminar.');
    expect(draft?.assumptions.join(' ')).not.toContain(REFINEMENT_CHECKS[1]);
  });

  it('lists the established pieces without assembling them into a sentence', () => {
    const log = walk(new Log());
    const pieces = establishedPieces(log.state);

    expect(pieces.map((p) => p.stage)).toEqual(['NOTICE', 'WONDER', 'TENSION', 'UNKNOWN']);
    for (const piece of pieces) {
      expect(WALK.map(([, text]) => text)).toContain(piece.text);
    }
  });
});

describe('vii. the walk records work, never the worker', () => {
  it('reports counts the log can prove and nothing that reads as a score', () => {
    const log = walk(new Log(), 2);
    const notice = spineOf(log.state).NOTICE!.objectId;
    log.push('coach', {
      type: 'coach.moved',
      payload: {
        moveId: log.id<MoveId>(), kind: 'ask', targetObjectId: notice,
        hintLevel: 1, body: SPINE.NOTICE.hints[1], flag: null,
      },
    });
    log.push('student', {
      type: 'thought.revised',
      payload: {
        objectId: notice,
        versionId: log.id<VersionId>(),
        parentVersionId: log.state.thoughts[notice]!.currentVersionId,
        text: 'Students submitted three days earlier once the tool was available.',
        note: '',
      },
    });

    const progress = spineProgress(log.state);
    expect(progress).toEqual({
      stage: 'TENSION',
      written: 2,
      revisions: 1,
      deepestRung: 1,
      hintsRequested: 5,
    });
    expect(Object.keys(progress)).not.toContain('level');
  });
});

/** A thought of a stage's type that is deliberately not part of the walk. */
function stageless(log: Log, type: (typeof SPINE_STAGES)[number], text: string): void {
  log.push('student', {
    type: 'thought.created',
    payload: {
      objectId: log.id<ObjectId>(), versionId: log.id<VersionId>(), type, text, note: '',
      position: { x: 0, y: 0 },
    },
  });
}
