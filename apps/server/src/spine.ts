import {
  SPINE, SPINE_RELATION, coachMoves, currentStage, draftFrame, spineOf,
  type MoveId, type ObjectId, type ProjectId, type RelationId,
  type SpineStage, type VersionId,
} from '@coral/core';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * The framing walk, server-side.
 *
 * Writing a stage is four appends that belong together: the student's thought,
 * the relation attaching it to the stage before, the coach's reflection on what
 * they wrote, and the handoff question that opens the next stage. Doing them
 * here rather than in the browser keeps every word the coach says in the log,
 * which is what lets `promptedBy` chain the walk: each stage records the
 * handoff that prompted it.
 *
 * No model is involved. The prose is the v1 prototype's, read out of `SPINE`,
 * and it goes through the same guarded append as anything else — so the ladder
 * guard governs these rungs exactly as it governs slice 02's.
 */

export interface StageWriteBody {
  stage: SpineStage;
  text: string;
}

export class StageOutOfOrder extends Error {
  constructor(readonly expected: SpineStage | null, readonly got: SpineStage) {
    super(
      expected === null
        ? `the framing walk is finished; ${got} is already written`
        : `the walk is at ${expected}, not ${got}`,
    );
    this.name = 'StageOutOfOrder';
  }
}

/** The handoff move that opened this stage, so the thought records what prompted it. */
function openingMoveFor(view: ProjectView, stage: SpineStage): MoveId | null {
  const prior = priorStage(stage);
  if (prior === null) return null;
  const previous = spineOf(view.state)[prior];
  if (previous === undefined) return null;
  return [...coachMoves(view.state)]
    .reverse()
    .find((m) => m.targetObjectId === previous.objectId && m.kind === 'ask')
    ?.moveId ?? null;
}

/**
 * Write one stage of the walk.
 *
 * The stage is checked against the walk's own position rather than trusted from
 * the caller, for the same reason the coach route computes the rung itself: a
 * client that simply asks to be at QUESTION should not arrive there.
 */
export async function writeStage(
  projectId: ProjectId,
  body: StageWriteBody,
): Promise<ProjectView> {
  const before = await loadProject(projectId);
  const expected = currentStage(before.state);
  if (expected !== body.stage) throw new StageOutOfOrder(expected, body.stage);

  const text = body.text.trim();
  if (text === '') throw new Error('a stage needs words in it');

  const objectId = crypto.randomUUID() as ObjectId;
  const copy = SPINE[body.stage];
  const promptedBy = openingMoveFor(before, body.stage);

  let view = await appendEvent(projectId, {
    actor: 'student',
    type: 'thought.created',
    promptedBy,
    payload: {
      objectId,
      versionId: crypto.randomUUID() as VersionId,
      type: body.stage,
      text,
      note: '',
      position: positionFor(body.stage),
    },
  });

  // Attach it to the stage before. The walk picks the relation; everywhere else
  // on the map the student does.
  const previous = spineOf(before.state);
  const prior = priorStage(body.stage);
  const from = prior === null ? undefined : previous[prior];
  if (from !== undefined && prior !== null) {
    view = await appendEvent(projectId, {
      actor: 'student',
      type: 'relation.created',
      payload: {
        relationId: crypto.randomUUID() as RelationId,
        from: from.objectId,
        to: objectId,
        relation: SPINE_RELATION[body.stage as Exclude<SpineStage, 'NOTICE'>],
      },
    });
  }

  // Rung zero: a reflection on what they actually wrote. Volunteered, because
  // rung zero is the one rung that may be.
  view = await appendEvent(projectId, {
    actor: 'coach',
    type: 'coach.moved',
    payload: {
      moveId: crypto.randomUUID() as MoveId,
      kind: 'reflect',
      targetObjectId: objectId,
      hintLevel: 0,
      body: copy.hints[0],
      flag: null,
    },
  });

  // The handoff. Still rung zero, and still a question rather than an answer.
  view = await appendEvent(projectId, {
    actor: 'coach',
    type: 'coach.moved',
    payload: {
      moveId: crypto.randomUUID() as MoveId,
      kind: 'ask',
      targetObjectId: objectId,
      hintLevel: 0,
      body: copy.after,
      flag: null,
    },
  });

  return view;
}

const ORDER = ['NOTICE', 'WONDER', 'TENSION', 'UNKNOWN', 'QUESTION'] as const;

const priorStage = (stage: SpineStage): SpineStage | null => {
  const i = ORDER.indexOf(stage);
  return i <= 0 ? null : (ORDER[i - 1] as SpineStage);
};

/** Laid out down the canvas so the walk reads as a spine when the map opens. */
const positionFor = (stage: SpineStage): { x: number; y: number } => ({
  x: 240,
  y: 80 + ORDER.indexOf(stage) * 150,
});

/**
 * Draft the Problem Frame.
 *
 * Assembled, never generated: the question is the student's QUESTION thought
 * word for word, and an assumption exists only where the student answered a
 * refinement prompt. The coach is the actor because assembling is a coach
 * action, but every string in the payload was written by the student — which is
 * the distinction invariant iv turns on.
 */
export async function draftProblemFrame(
  projectId: ProjectId,
  answers: Record<string, string>,
): Promise<ProjectView> {
  const view = await loadProject(projectId);
  const draft = draftFrame(view.state, answers);
  if (draft === null) throw new Error('there is no question to frame yet');

  return appendEvent(projectId, {
    actor: 'coach',
    type: 'frame.drafted',
    payload: draft,
  });
}
