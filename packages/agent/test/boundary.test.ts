import { describe, expect, it } from 'vitest';
import { COACH_MOVE_KINDS, SPINE, THOUGHT_TYPES } from '@coral/core';
import { MOVE_SCHEMA, MalformedMove, parseMove } from '../src/move.js';
import { StaticProvider, type CoachProvider } from '../src/providers.js';
import { requestMove } from '../src/index.js';
import { CONSTITUTION, rungInstruction } from '../src/constitution.js';

const ask = (rung: 0 | 1 | 2 | 3, context: string, adversarial = false) => ({
  context, rung, adversarial,
});

const TENSION = 'THE THOUGHT THEY ARE WORKING ON\n  type: TENSION\n  text: something';

/**
 * The schema is the boundary between Coral and whatever model the student has
 * installed. These tests assert what it cannot express, because that is the
 * property the product rests on — not the wording of the constitution.
 */
describe('the move schema cannot carry a student\'s thought', () => {
  it('exposes a closed set of fields and refuses anything else', () => {
    expect(MOVE_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(MOVE_SCHEMA.properties).sort()).toEqual(
      ['body', 'flag', 'kind', 'query', 'relation', 'suggestedType'].sort(),
    );
  });

  it('has no field a thought\'s text could arrive in', () => {
    // `body` is the coach's own prose. Every other field is an enum or a search
    // query. There is no free-text field that a thought could be smuggled into
    // and then written to the graph, because nothing reads these as thought text.
    const free = Object.entries(MOVE_SCHEMA.properties)
      .filter(([, spec]) => !('enum' in spec))
      .map(([name]) => name);
    expect(free.sort()).toEqual(['body', 'query']);
  });

  it('offers every move kind the vocabulary declares, and no others', () => {
    expect(MOVE_SCHEMA.properties.kind.enum).toEqual([...COACH_MOVE_KINDS]);
  });

  it('will not let a branch be proposed as evidence', () => {
    // Evidence is gated on a real passage plus a written interpretation, so a
    // model must not be able to suggest one as a next thought at all.
    expect(MOVE_SCHEMA.properties.suggestedType.enum).not.toContain('EVIDENCE');
    expect(MOVE_SCHEMA.properties.suggestedType.enum).toHaveLength(THOUGHT_TYPES.length - 1);
  });
});

describe('nothing a provider returns is trusted', () => {
  it('drops fields the schema does not declare', () => {
    const move = parseMove({
      kind: 'ask',
      body: 'What would tell those apart?',
      // A model that decided to write the thought anyway.
      text: 'Although performance rises, learning may not.',
      thought: 'Although performance rises, learning may not.',
      assessment: 'developing',
      hintLevel: 3,
    });

    expect(Object.keys(move).sort()).toEqual(['body', 'kind']);
    expect(JSON.stringify(move)).not.toContain('Although');
    expect(JSON.stringify(move)).not.toContain('developing');
  });

  it('cannot be talked into a rung by the reply', () => {
    // The rung is computed from the log server-side. Even if a model asserts
    // one, there is nowhere for it to land.
    const move = parseMove({ kind: 'offer_sentence_frame', body: 'Try: Although ___, ___.', rung: 0 });
    expect(move).not.toHaveProperty('rung');
    expect(move).not.toHaveProperty('hintLevel');
  });

  it.each([
    ['a string instead of an object', 'reflect'],
    ['null', null],
    ['an array', [{ kind: 'ask', body: 'x' }]],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseMove(raw)).toThrow(MalformedMove);
  });

  it('refuses a kind outside the closed set', () => {
    expect(() => parseMove({ kind: 'write_the_thought', body: 'Here it is.' }))
      .toThrow(/unknown move kind/);
  });

  it('refuses an empty or whitespace body', () => {
    expect(() => parseMove({ kind: 'ask', body: '   ' })).toThrow(/empty body/);
  });

  it('refuses a branch with no type and a flag with no gap', () => {
    expect(() => parseMove({ kind: 'propose_branch', body: 'Try a tension.' }))
      .toThrow(/needs a suggestedType/);
    expect(() => parseMove({ kind: 'flag', body: 'Something is missing.' }))
      .toThrow(/needs a named structural gap/);
  });

  it('discards an out-of-vocabulary relation rather than passing it through', () => {
    const move = parseMove({
      kind: 'propose_branch', body: 'A tension might follow.',
      suggestedType: 'TENSION', relation: 'reveals',
    });
    expect(move.suggestedType).toBe('TENSION');
    expect(move.relation).toBeUndefined();
  });
});

describe('the built-in ladder is the floor under every provider', () => {
  it('answers the four rungs from the framing copy, in order', async () => {
    const coach = new StaticProvider();
    for (const rung of [0, 1, 2, 3] as const) {
      const move = await coach.move(ask(rung, TENSION));
      expect(move.body).toBe(SPINE.TENSION.hints[rung]);
    }
  });

  it('never climbs past the sentence frame, however often it is asked', async () => {
    const coach = new StaticProvider();
    const top = await coach.move(ask(3, TENSION));
    expect(top.kind).toBe('offer_sentence_frame');
    expect(top.body).toContain('___');
  });

  it('argues about the reasoning when asked, and names an assumption', async () => {
    const move = await new StaticProvider().move(ask(0, TENSION, true));
    expect(move.kind).toBe('challenge');
    expect(move.body).toBe(
      `${SPINE.TENSION.challenge.assumption} ${SPINE.TENSION.challenge.question}`,
    );
  });

  it('answers for a type that is not on the framing walk', async () => {
    const move = await new StaticProvider().move(
      ask(0, 'THE THOUGHT THEY ARE WORKING ON\n  type: SYNTHESIS\n  text: x'),
    );
    expect(move.body.trim()).not.toBe('');
  });
});

describe('a provider that misbehaves falls back rather than failing', () => {
  const hostile = (behaviour: () => never): CoachProvider => ({
    id: 'claude-code',
    label: 'Hostile',
    available: async () => true,
    move: async () => behaviour(),
  });

  it('falls back when the reply is outside the allowed move set', async () => {
    const outcome = await requestMove(ask(1, TENSION), 'claude-code', [
      hostile(() => { throw new MalformedMove({}, 'not a move'); }),
    ]);

    expect(outcome.provider).toBe('static');
    expect(outcome.fellBackFrom).toBe('claude-code');
    expect(outcome.reason).toMatch(/outside the allowed move set/);
    expect(outcome.move.body).toBe(SPINE.TENSION.hints[1]);
  });

  it('falls back when the agent errors, and says why', async () => {
    const outcome = await requestMove(ask(0, TENSION), 'claude-code', [
      hostile(() => { throw new Error('quota exhausted'); }),
    ]);

    expect(outcome.provider).toBe('static');
    expect(outcome.reason).toBe('quota exhausted');
    expect(outcome.move.body).toBe(SPINE.TENSION.hints[0]);
  });

  it('falls back when nothing is installed', async () => {
    const outcome = await requestMove(ask(0, TENSION), 'codex', []);
    expect(outcome.provider).toBe('static');
    expect(outcome.reason).toMatch(/not installed/);
  });

  it('does not call a provider at all when the ladder is chosen', async () => {
    let called = false;
    const outcome = await requestMove(ask(0, TENSION), 'static', [
      { id: 'claude-code', label: 'x', available: async () => { called = true; return true; },
        move: async () => { called = true; throw new Error('should not run'); } },
    ]);
    expect(called).toBe(false);
    expect(outcome.provider).toBe('static');
  });
});

describe('the constitution states the refusals it cannot enforce', () => {
  it('forbids authoring and assessment in so many words', () => {
    expect(CONSTITUTION).toMatch(/Never write the student's thought/);
    expect(CONSTITUTION).toMatch(/Never assess the student/);
    expect(CONSTITUTION).toMatch(/unless its text is quoted/);
  });

  it('tells the model the rung rather than asking it to choose one', () => {
    expect(rungInstruction(0, false)).toMatch(/has not asked for help/);
    expect(rungInstruction(3, false)).toMatch(/as far as support goes/);
    for (const rung of [0, 1, 2] as const) {
      expect(rungInstruction(rung, false)).not.toMatch(/offer a sentence frame with blanks/);
    }
  });

  it('makes the adversarial stance last exactly one move', () => {
    expect(rungInstruction(1, true)).toMatch(/this one move only/);
    expect(rungInstruction(1, true)).toMatch(/never about the student/);
  });
});
