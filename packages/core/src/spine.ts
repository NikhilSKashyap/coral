import type { ObjectId } from './ids.js';
import { childrenOf, coachMoves, liveThoughts, parentsOf, versionsOf } from './selectors.js';
import type { CoachMoveKind, ProjectState, Relation, Thought, ThoughtType } from './types.js';

/**
 * The framing spine: five stages a student walks before the map opens.
 *
 * The Figma flow puts an editable Problem Frame between the student's first
 * words and the box marked "Open Research Studio". Everything before that box is
 * this file. It is a guided walk over the same node store the map uses, so
 * nothing here needs a second schema — a stage is a thought type, and the walk
 * is a chain of ordinary relations.
 *
 * The copy is quoted from the v1 studio prototype rather than rewritten. It is
 * the pedagogy this slice exists to test, and no model is in the loop: the
 * hints below are the whole coach until slice 02.
 */

export const SPINE_STAGES = ['NOTICE', 'WONDER', 'TENSION', 'UNKNOWN', 'QUESTION'] as const;
export type SpineStage = (typeof SPINE_STAGES)[number];

export const isSpineStage = (type: ThoughtType): type is SpineStage =>
  (SPINE_STAGES as readonly ThoughtType[]).includes(type);

/**
 * How each stage attaches to the one before it.
 *
 * The student picks relations everywhere else in the product. Here the walk
 * picks, because the sequence is the lesson: an observation raises a wonder, a
 * wonder suggests a tension, a tension leaves something uncertain, and that
 * gap leads to the question.
 *
 * The v1 prototype wrote the third of these as "reveals", which is not one of
 * the eight relations in the shared vocabulary. Rather than widen the
 * vocabulary for one walk, it maps onto `suggests`, which carries the same
 * direction of travel.
 */
export const SPINE_RELATION: Record<Exclude<SpineStage, 'NOTICE'>, Relation> = {
  WONDER: 'raises',
  TENSION: 'suggests',
  UNKNOWN: 'leaves_uncertain',
  QUESTION: 'leads_to',
};

export interface StageCopy {
  /** What this kind of thought is, and what it is not. Shown above the prompt. */
  guidance: string;
  /** The question the student is answering right now. */
  prompt: string;
  /** Shown in the empty slot on the spine, before the stage is reached. */
  slot: string;
  /** Where the coach reads the student as standing when this stage opens. */
  state: string;
  /** What to do next, in one line. */
  next: string;
  /** Said once, after the stage is written, to hand over to the next one. */
  after: string;
  /**
   * The four rungs, in order: a reflection, a question, a structure, a sentence
   * frame. Rung four is never volunteered — `assertHintLadder` enforces that the
   * student has to climb.
   */
  hints: readonly [string, string, string, string];
  /** The objection the coach raises when the student asks to be argued with. */
  challenge: { assumption: string; question: string };
}

export const SPINE: Record<SpineStage, StageCopy> = {
  NOTICE: {
    guidance:
      'A notice is something you actually observed or encountered. It is not yet an explanation of what you observed.',
    prompt: 'What exactly did you observe?',
    slot: 'What have you noticed?',
    state: "You're starting from an observation.",
    next: 'Describe what you saw, before explaining it.',
    after:
      'You have named something you observed. Does what you observed necessarily mean something improved?',
    hints: [
      'You seem to be noticing that AI changes how quickly work gets finished.',
      'What did you actually observe here, as opposed to what you inferred from it?',
      'Separate the event from your explanation of it. Only the event belongs in a notice.',
      'Try completing: I noticed that ___, which I did not expect because ___.',
    ],
    challenge: {
      assumption: 'You are treating speed as the salient feature of what you saw.',
      question: 'What else changed at the same time that you did not record?',
    },
  },
  WONDER: {
    guidance:
      'A wonder is an open question about your observation. It is not a hypothesis you already believe.',
    prompt: 'What about this feels unresolved?',
    slot: 'What feels unresolved about it?',
    state: "You've identified a phenomenon.",
    next: 'Try to articulate what about it feels unresolved.',
    after:
      'That reads as an open question rather than a conclusion. Which two things here are hard to hold together?',
    hints: [
      'You seem to be noticing that faster completion may not be the same thing as better learning.',
      'What about this feels unresolved?',
      'Consider whether the thing you observed necessarily implies what it appears to imply.',
      'Try completing: I wonder whether ___ actually means ___.',
    ],
    challenge: {
      assumption:
        'You are assuming the interesting question is about learning rather than about the task itself.',
      question: 'What would make the task, not the learner, the thing that changed?',
    },
  },
  TENSION: {
    guidance:
      'A strong tension contains two ideas that are both plausible but difficult to reconcile.',
    prompt: 'What exactly is in tension here?',
    slot: 'What two things are hard to reconcile?',
    state: "You've opened a genuine question.",
    next: 'Name the two claims that are hard to hold together.',
    after: 'What would you need to know to distinguish those two possibilities?',
    hints: [
      'You seem to be holding two things at once: a visible gain and a possible hidden cost.',
      'Which two claims here are hard to hold together?',
      'Consider whether performance and learning necessarily move together.',
      'Try completing: Although ___, ___.',
    ],
    challenge: {
      assumption:
        'You are currently assuming that AI-assisted performance may conceal weaker independent ability.',
      question: 'What alternative explanation could produce the same observation?',
    },
  },
  UNKNOWN: {
    guidance:
      'An unknown names what you would have to find out to tell the two sides of your tension apart. It is a gap, not a topic.',
    prompt: 'What would you need to know to distinguish those possibilities?',
    slot: 'What would you need to find out?',
    state: 'You are holding a real tension.',
    next: 'Say what you would have to find out to settle it.',
    after:
      'That is a gap evidence could close. Now the question — I will list what you have established, but the wording should be yours.',
    hints: [
      'Your tension sets up two possibilities that currently look the same from the outside.',
      'What observation would tell those two possibilities apart?',
      'An unknown is not a subject area. It is something a study could establish or fail to establish.',
      'Try completing: It is not yet known whether ___ can ___ without ___.',
    ],
    challenge: {
      assumption: 'You are assuming the unknown is about ability rather than about willingness or effort.',
      question: 'How would you tell an inability apart from a choice not to?',
    },
  },
  QUESTION: {
    guidance:
      'A researchable question names who you are studying, what is uncertain, and under what conditions. Write it from the pieces you already have.',
    prompt: 'Write your question in your own words.',
    slot: 'Write your question.',
    state: 'You have the pieces of a question.',
    next: 'Write it yourself — I will not assemble it for you.',
    after:
      'That is a first version, not a finished one. Some terms in it are still doing more than one job.',
    hints: [
      'You have an observation, a tension and an unknown. The question is the unknown, made specific.',
      'Who exactly are you asking about, and during what activity?',
      'A question that could be answered yes or no by anyone with an opinion is not yet researchable. What would evidence have to show?',
      'Try completing: For ___, how does ___ affect ___ during ___?',
    ],
    challenge: {
      assumption: 'Your question assumes the effect runs in one direction.',
      question: 'What would it look like if the effect ran the other way?',
    },
  },
};

/**
 * The rung a hint lands on, by index.
 *
 * This is the same ladder as `HINT_LADDER` in `types.ts`, named here as move
 * kinds so a stage's four hints can be turned into four coach moves without the
 * caller deciding what kind each one is.
 */
export const RUNG_KIND: readonly [CoachMoveKind, CoachMoveKind, CoachMoveKind, CoachMoveKind] = [
  'reflect', 'ask', 'offer_structure', 'offer_sentence_frame',
];

/**
 * The prompts in the refinement panel, once a question exists.
 *
 * Reflective prompts, not fields that have to be filled. They are read from the
 * student's answers into the Problem Frame's assumptions, and an unanswered one
 * is simply left out rather than invented.
 */
export const REFINEMENT_CHECKS = [
  'Who or what are you studying?',
  'What exactly is uncertain?',
  'Why does this uncertainty matter?',
  'What boundaries are necessary?',
  'Could evidence realistically answer this question?',
] as const;

/* ------------------------------------------------------------------ */
/* Reading the walk back off the graph                                 */
/* ------------------------------------------------------------------ */

/**
 * The thought occupying each stage, or undefined where the walk has not
 * reached yet.
 *
 * A stage is occupied by the oldest live thought of that type that sits on the
 * spine, so a CHALLENGE branched off a WONDER later does not displace it. Read
 * off the graph rather than stored, because storing a cursor would be a second
 * source of truth for something the log already knows.
 */
export function spineOf(state: ProjectState): Record<SpineStage, Thought | undefined> {
  const out = {} as Record<SpineStage, Thought | undefined>;
  const live = liveThoughts(state).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const stage of SPINE_STAGES) {
    out[stage] = live.find((t) => t.type === stage);
  }
  return out;
}

/** The stage the student is being asked to write, or null once all five exist. */
export function currentStage(state: ProjectState): SpineStage | null {
  const spine = spineOf(state);
  return SPINE_STAGES.find((stage) => spine[stage] === undefined) ?? null;
}

/** The stage before this one, which is what a new thought attaches to. */
export function previousStage(stage: SpineStage): SpineStage | null {
  const index = SPINE_STAGES.indexOf(stage);
  return index <= 0 ? null : (SPINE_STAGES[index - 1] as SpineStage);
}

/** True once all five stages are written. The map is worth opening from here. */
export const spineComplete = (state: ProjectState): boolean => currentStage(state) === null;

/**
 * The pieces the student has established, ready to be shown while they write
 * the question.
 *
 * The coach lists these and stops. Assembling them into a sentence is exactly
 * the step this product refuses to take, which is why the return type is a list
 * of labelled fragments and not a string.
 */
export function establishedPieces(
  state: ProjectState,
): Array<{ label: string; stage: SpineStage; text: string; objectId: ObjectId }> {
  const spine = spineOf(state);
  const labels: Record<SpineStage, string> = {
    NOTICE: 'OBSERVED',
    WONDER: 'UNRESOLVED',
    TENSION: 'IN TENSION',
    UNKNOWN: 'NOT YET KNOWN',
    QUESTION: 'ASKED',
  };
  return SPINE_STAGES.flatMap((stage) => {
    const t = spine[stage];
    if (t === undefined || stage === 'QUESTION') return [];
    return [{ label: labels[stage], stage, text: t.text, objectId: t.objectId }];
  });
}

/**
 * A Problem Frame drafted strictly from objects that already exist.
 *
 * Invariant iv in miniature: this is a template fill over the graph with no
 * generation step. The question is the student's QUESTION thought verbatim, the
 * concepts are the terms they defined, and the assumptions are answers they
 * actually wrote. A stage they skipped leaves a gap rather than prose.
 */
export function draftFrame(
  state: ProjectState,
  answers: Partial<Record<string, string>> = {},
): { question: string; concepts: string[]; assumptions: string[] } | null {
  const spine = spineOf(state);
  const question = spine.QUESTION;
  if (question === undefined) return null;

  const assumptions = REFINEMENT_CHECKS
    .map((check) => {
      const answer = answers[check]?.trim() ?? '';
      return answer === '' ? null : `${check} ${answer}`;
    })
    .filter((a): a is string => a !== null);

  const concepts = childrenOf(state, question.objectId)
    .map((edge) => state.thoughts[edge.to])
    .filter((t): t is Thought => t !== undefined && t.type === 'ASSUMPTION' && !t.archived)
    .map((t) => t.text);

  return { question: question.text, concepts, assumptions };
}

/**
 * The observable record of the walk itself.
 *
 * Counts, never a judgment. Every number here is something the log can prove,
 * which is invariant vii holding at the one moment it is most tempting to
 * break: the student has just finished framing and an assessment would fit
 * naturally right here.
 */
export interface SpineProgress {
  stage: SpineStage | null;
  written: number;
  revisions: number;
  /** Highest rung reached on any spine thought, and how many times help was asked for. */
  deepestRung: number;
  hintsRequested: number;
}

export function spineProgress(state: ProjectState): SpineProgress {
  const spine = spineOf(state);
  const occupied = SPINE_STAGES.map((s) => spine[s]).filter((t): t is Thought => t !== undefined);

  const revisions = occupied.reduce(
    (sum, t) => sum + Math.max(0, versionsOf(state, t.objectId).length - 1),
    0,
  );

  const onSpine = new Set(occupied.map((t) => t.objectId as string));
  const moves = coachMoves(state).filter(
    (m) => m.targetObjectId !== null && onSpine.has(m.targetObjectId),
  );

  return {
    stage: currentStage(state),
    written: occupied.length,
    revisions,
    deepestRung: moves.reduce((max, m) => Math.max(max, m.hintLevel), 0),
    hintsRequested: moves.length,
  };
}

/** Whether a thought sits on the spine, for views that treat the walk specially. */
export function isOnSpine(state: ProjectState, id: ObjectId): boolean {
  const spine = spineOf(state);
  return SPINE_STAGES.some((stage) => spine[stage]?.objectId === id);
}

/** The relation that attached a spine thought to the one before it, if any. */
export function spineRelationInto(state: ProjectState, id: ObjectId): Relation | null {
  return parentsOf(state, id)[0]?.relation ?? null;
}
