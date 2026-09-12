import {
  COACH_MOVE_KINDS, RELATIONS, STRUCTURAL_FLAGS, THOUGHT_TYPES,
  type CoachMoveKind, type HintLevel, type Relation, type StructuralFlag, type ThoughtType,
} from '@coral/core';

/**
 * The only shape an agent may return.
 *
 * This schema is the whole security boundary between Coral and whatever model
 * the student has installed. Note what it cannot express: there is no field
 * anywhere that carries the text of a thought the student owns. `propose_branch`
 * names a type and a relation and gives a reason; the student still writes the
 * thought.
 *
 * Handed verbatim to the provider, so the model is constrained at generation
 * time rather than corrected afterwards.
 */
export const MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'body'],
  properties: {
    kind: {
      type: 'string',
      enum: [...COACH_MOVE_KINDS],
      description: 'The single move you are making.',
    },
    body: {
      type: 'string',
      description:
        'One or two sentences addressed to the student. For propose_branch this is your reason for suggesting it, never the thought itself.',
    },
    suggestedType: {
      type: 'string',
      enum: THOUGHT_TYPES.filter((t) => t !== 'EVIDENCE'),
      description: 'propose_branch only: the kind of thought the student might write next.',
    },
    relation: {
      type: 'string',
      enum: [...RELATIONS],
      description: 'propose_branch only: how the new thought would relate to the current one.',
    },
    flag: {
      type: 'string',
      enum: [...STRUCTURAL_FLAGS],
      description: 'flag only: the structural gap you noticed.',
    },
    query: {
      type: 'string',
      description: 'retrieve only: a literature search query.',
    },
  },
} as const;

export interface CoachMoveResult {
  kind: CoachMoveKind;
  body: string;
  suggestedType?: ThoughtType;
  relation?: Relation;
  flag?: StructuralFlag;
  query?: string;
}

/** A provider returned something outside the closed set. Never trusted, always caught. */
export class MalformedMove extends Error {
  constructor(readonly raw: unknown, message: string) {
    super(message);
    this.name = 'MalformedMove';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Validate whatever came back. A local CLI is an untrusted boundary even though
 * it runs as the student: it can be any version, any model, or a stub.
 */
export function parseMove(raw: unknown): CoachMoveResult {
  if (!isRecord(raw)) throw new MalformedMove(raw, 'expected an object');

  const kind = str(raw['kind']);
  if (kind === undefined || !(COACH_MOVE_KINDS as readonly string[]).includes(kind)) {
    throw new MalformedMove(raw, `unknown move kind "${String(raw['kind'])}"`);
  }
  const body = str(raw['body'])?.trim();
  if (body === undefined || body === '') throw new MalformedMove(raw, 'empty body');

  const move: CoachMoveResult = { kind: kind as CoachMoveKind, body };

  const suggestedType = str(raw['suggestedType']);
  if (suggestedType !== undefined && (THOUGHT_TYPES as readonly string[]).includes(suggestedType)) {
    move.suggestedType = suggestedType as ThoughtType;
  }
  const relation = str(raw['relation']);
  if (relation !== undefined && (RELATIONS as readonly string[]).includes(relation)) {
    move.relation = relation as Relation;
  }
  const flag = str(raw['flag']);
  if (flag !== undefined && (STRUCTURAL_FLAGS as readonly string[]).includes(flag)) {
    move.flag = flag as StructuralFlag;
  }
  const query = str(raw['query']);
  if (query !== undefined && query.trim() !== '') move.query = query.trim();

  if (move.kind === 'propose_branch' && move.suggestedType === undefined) {
    throw new MalformedMove(raw, 'propose_branch needs a suggestedType');
  }
  if (move.kind === 'flag' && move.flag === undefined) {
    throw new MalformedMove(raw, 'flag needs a named structural gap');
  }
  return move;
}

export interface CoachRequest {
  /** The reasoning graph, already rendered. Never a chat transcript. */
  context: string;
  /** Chosen by the student pressing for help, never by the model. */
  rung: HintLevel;
  /** Set when the student asked to be argued with. */
  adversarial: boolean;
}
