import { liveThoughts, type ObjectId, type ProjectState, type Thought } from '@coral/core';

/**
 * Claim detection.
 *
 * The flow asks the coach to "detect a possible claim without auto-accepting
 * it". Detection is therefore not authorship and not assessment: it reads the
 * student's own thoughts and says which ones are already doing the work of a
 * claim — asserting something that could be argued with and needs support.
 *
 * A detected claim becomes a proposal to *retype* an existing thought. The
 * words are already the student's; what a proposal offers is a reading of them,
 * and the student either agrees, revises first, or declines.
 *
 * This is the cheap, high-frequency half of the coach, so it runs on the
 * smallest model available rather than the one that makes judgement calls.
 */

/**
 * The only shape detection may return.
 *
 * `ref` is an index into the numbered list we showed, not an object id. That is
 * deliberate: a model cannot invent an index that resolves to something real,
 * and an out-of-range one is discarded rather than looked up. There is no field
 * for text anywhere, so detection cannot smuggle in a claim of its own.
 */
export const DETECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'rationale'],
        properties: {
          ref: {
            type: 'integer',
            description: 'The number of the thought in the list, exactly as shown.',
          },
          rationale: {
            type: 'string',
            description:
              'One sentence on what makes this read as a claim. Describe the thought, never the student.',
          },
        },
      },
    },
  },
} as const;

export interface ClaimCandidate {
  objectId: ObjectId;
  rationale: string;
}

export const DETECTION_INSTRUCTION = `Read the student's thoughts below and say which ones are already doing the work of a CLAIM.

A claim asserts something that could be disagreed with and that would need evidence to hold up. It is not a claim if it is an observation of what happened, an open question, a tension being held, or a gap the student has named — those have their own types and are fine as they are.

Return at most a few, and return none if none qualify. A thought already typed CLAIM is not a candidate.

For each one, give the number exactly as shown and one sentence on what makes it read as a claim. Describe the thought. Never describe the student, their ability, or their progress.

Do not write, rewrite, or improve any thought. You are reading, not editing.`;

/** Types worth examining. The rest have a settled job already. */
const DETECTABLE = ['IDEA', 'NOTICE', 'WONDER', 'SYNTHESIS', 'ASSUMPTION'] as const;

/**
 * The numbered list the model reads, and the mapping back.
 *
 * Returned together so the caller cannot resolve a ref against a different list
 * than the one that was rendered.
 */
export function renderCandidates(
  state: ProjectState,
): { prompt: string; refs: Thought[] } {
  const refs = liveThoughts(state)
    .filter((t) => (DETECTABLE as readonly string[]).includes(t.type))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (refs.length === 0) return { prompt: 'The student has written nothing to examine.', refs };

  const lines = refs.map((t, i) => `${String(i + 1)}. [${t.type}] ${t.text}`);
  return {
    prompt: ['THE STUDENT\'S THOUGHTS', ...lines].join('\n'),
    refs,
  };
}

/** A detection reply that was not usable. Never trusted, always caught. */
export class MalformedDetection extends Error {
  constructor(readonly raw: unknown, message: string) {
    super(message);
    this.name = 'MalformedDetection';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Resolve a reply against the list that produced it.
 *
 * Anything that does not land on a real row is dropped rather than repaired: an
 * out-of-range ref, a duplicate, a blank rationale, a thought that is already a
 * claim. Dropping is safe because a missed detection costs nothing — the student
 * can type a claim whenever they like — while a fabricated one puts a proposal
 * on the board that refers to nothing.
 */
export function parseDetection(raw: unknown, refs: readonly Thought[]): ClaimCandidate[] {
  if (!isRecord(raw)) throw new MalformedDetection(raw, 'expected an object');
  const candidates = raw['candidates'];
  if (!Array.isArray(candidates)) throw new MalformedDetection(raw, 'expected a candidates array');

  const seen = new Set<string>();
  const out: ClaimCandidate[] = [];

  for (const entry of candidates) {
    if (!isRecord(entry)) continue;
    const ref = entry['ref'];
    if (typeof ref !== 'number' || !Number.isInteger(ref)) continue;

    const thought = refs[ref - 1];
    if (thought === undefined) continue;
    if (thought.type === 'CLAIM') continue;
    if (seen.has(thought.objectId as string)) continue;

    const rationale = typeof entry['rationale'] === 'string' ? entry['rationale'].trim() : '';
    if (rationale === '') continue;

    seen.add(thought.objectId as string);
    out.push({ objectId: thought.objectId, rationale });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Contradiction                                                       */
/* ------------------------------------------------------------------ */

/**
 * Two claims that resist each other.
 *
 * The one structural flag the graph cannot prove: whether two claims conflict
 * is a matter of what they mean, so it needs reading. Same shape as claim
 * detection — a pair of row numbers and a reason — so a model can neither name
 * a claim that does not exist nor write one.
 *
 * A contradiction is reported, never resolved. Holding two claims that resist
 * each other is often the most interesting place a student can be, and the
 * product's job is to make sure they have noticed rather than to pick a winner.
 */
export const CONTRADICTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pairs'],
  properties: {
    pairs: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b', 'rationale'],
        properties: {
          a: { type: 'integer', description: 'The number of the first claim, exactly as shown.' },
          b: { type: 'integer', description: 'The number of the second claim, exactly as shown.' },
          rationale: {
            type: 'string',
            description:
              'One sentence on what cannot be true at the same time. Describe the claims, never the student.',
          },
        },
      },
    },
  },
} as const;

export interface ContradictionPair {
  a: ObjectId;
  b: ObjectId;
  rationale: string;
}

export const CONTRADICTION_INSTRUCTION = `Read the claims below and say which pairs cannot comfortably both be true.

A contradiction is a real tension in what the claims assert: accepting one makes the other harder to hold. Two claims about different things are not a contradiction, and neither are two claims that simply sit at different levels of detail.

Return none if none conflict. Most sets of claims do not.

Give the two numbers exactly as shown and one sentence naming what cannot hold at once. Describe the claims. Never describe the student, and never say which one is right — that is theirs to work out.`;

/** The numbered claim list the contradiction scan reads. */
export function renderClaims(state: ProjectState): { prompt: string; refs: Thought[] } {
  const refs = liveThoughts(state)
    .filter((t) => t.type === 'CLAIM')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (refs.length < 2) return { prompt: 'There are not two claims to compare.', refs };

  const lines = refs.map((t, i) => `${String(i + 1)}. ${t.text}`);
  return { prompt: ['THE CLAIMS ON THE MAP', ...lines].join('\n'), refs };
}

export function parseContradictions(
  raw: unknown,
  refs: readonly Thought[],
): ContradictionPair[] {
  if (!isRecord(raw)) throw new MalformedDetection(raw, 'expected an object');
  const pairs = raw['pairs'];
  if (!Array.isArray(pairs)) throw new MalformedDetection(raw, 'expected a pairs array');

  const seen = new Set<string>();
  const out: ContradictionPair[] = [];

  for (const entry of pairs) {
    if (!isRecord(entry)) continue;
    const a = entry['a'];
    const b = entry['b'];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue;

    const first = refs[a - 1];
    const second = refs[b - 1];
    if (first === undefined || second === undefined) continue;

    // A pair is unordered: flagging the same two claims twice is noise.
    const key = [first.objectId, second.objectId].sort().join('|');
    if (seen.has(key)) continue;

    const rationale = typeof entry['rationale'] === 'string' ? entry['rationale'].trim() : '';
    if (rationale === '') continue;

    seen.add(key);
    out.push({ a: first.objectId, b: second.objectId, rationale });
  }
  return out;
}
