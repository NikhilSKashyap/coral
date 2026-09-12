import type { MoveId, ObjectId, VersionId } from './ids.js';
import { coachMoves, versionsOf } from './selectors.js';
import type { ProjectState, ThoughtType, ThoughtVersion } from './types.js';

/**
 * What changed between two revisions.
 *
 * Splitting identity from version bought a promise the interface has owed since
 * slice 00: an instructor comments on v2, the student is at v5, and both should
 * be able to see what moved. A count of revisions is not that. This is.
 *
 * Word-level rather than character-level, because the unit a reader cares about
 * in a claim is the word that changed, and a character diff turns a reworded
 * sentence into confetti.
 */

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffSpan {
  kind: DiffKind;
  text: string;
}

/**
 * Tokenise into words and the whitespace between them.
 *
 * Whitespace rides along with its preceding word so that rejoining the spans
 * reproduces the input exactly. A diff that cannot round-trip is a diff you
 * cannot trust to render.
 */
function tokenise(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * Longest common subsequence over tokens.
 *
 * The straightforward dynamic program. Claims are sentences, not documents, so
 * the quadratic table is a few thousand cells at worst; a guard below keeps a
 * pathological input from building a large one anyway.
 */
function lcsTable(a: string[], b: string[]): Int32Array[] {
  const table: Int32Array[] = Array.from(
    { length: a.length + 1 },
    () => new Int32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i] as Int32Array;
    const next = table[i + 1] as Int32Array;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j]
        ? (next[j + 1] as number) + 1
        : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  return table;
}

/** Above this, fall back to reporting a wholesale replacement. */
const DIFF_TOKEN_LIMIT = 2000;

/**
 * The spans that turn `before` into `after`.
 *
 * Adjacent spans of the same kind are merged, so a reworded phrase reads as one
 * removal and one addition rather than as alternating words.
 */
export function diffWords(before: string, after: string): DiffSpan[] {
  if (before === after) return before === '' ? [] : [{ kind: 'same', text: before }];

  const a = tokenise(before);
  const b = tokenise(after);

  if (a.length + b.length > DIFF_TOKEN_LIMIT) {
    return merge([
      ...(before === '' ? [] : [{ kind: 'removed' as const, text: before }]),
      ...(after === '' ? [] : [{ kind: 'added' as const, text: after }]),
    ]);
  }

  const table = lcsTable(a, b);
  const spans: DiffSpan[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      spans.push({ kind: 'same', text: a[i] as string });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      spans.push({ kind: 'removed', text: a[i] as string });
      i += 1;
    } else {
      spans.push({ kind: 'added', text: b[j] as string });
      j += 1;
    }
  }
  while (i < a.length) { spans.push({ kind: 'removed', text: a[i] as string }); i += 1; }
  while (j < b.length) { spans.push({ kind: 'added', text: b[j] as string }); j += 1; }

  return merge(spans);
}

function merge(spans: DiffSpan[]): DiffSpan[] {
  const out: DiffSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === span.kind) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

/** How much moved, for an interface that wants to summarise before expanding. */
export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  /** True when nothing survived, which reads as a rewrite rather than an edit. */
  rewritten: boolean;
}

export function summariseDiff(spans: readonly DiffSpan[]): DiffSummary {
  const words = (text: string): number => (text.match(/\S+/g) ?? []).length;
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const span of spans) {
    if (span.kind === 'added') added += words(span.text);
    else if (span.kind === 'removed') removed += words(span.text);
    else unchanged += words(span.text);
  }
  return { added, removed, unchanged, rewritten: unchanged === 0 && (added > 0 || removed > 0) };
}

/* ------------------------------------------------------------------ */
/* The trail                                                          */
/* ------------------------------------------------------------------ */

/**
 * One step in a thought's history.
 *
 * Carries what changed and what prompted it, because a version list that only
 * says "v3, 11:42" is the clutter the slice is supposed to avoid. `promptedBy`
 * resolves to the coach move that immediately preceded the write, which is how
 * provenance becomes readable rather than merely recorded.
 */
export interface TrailStep {
  versionId: VersionId;
  /** 1-based, the way the interface counts. */
  number: number;
  type: ThoughtType;
  text: string;
  note: string;
  at: string;
  authoredBy: ThoughtVersion['authoredBy'];
  /** Null on the first version, which had nothing to change. */
  diff: DiffSpan[] | null;
  summary: DiffSummary | null;
  /** True when this step changed the type rather than the words. */
  retyped: boolean;
  prompt: { moveId: MoveId; kind: string; body: string } | null;
}

export function versionTrail(state: ProjectState, objectId: ObjectId): TrailStep[] {
  const versions = versionsOf(state, objectId);
  const moves = new Map(coachMoves(state).map((m) => [m.moveId as string, m]));

  return versions.map((version, index) => {
    const previous = index === 0 ? undefined : versions[index - 1];
    const diff = previous === undefined ? null : diffWords(previous.text, version.text);
    const move = version.promptedBy === null
      ? undefined
      : moves.get(version.promptedBy as string);

    return {
      versionId: version.versionId,
      number: index + 1,
      type: version.type,
      text: version.text,
      note: version.note,
      at: version.at,
      authoredBy: version.authoredBy,
      diff,
      summary: diff === null ? null : summariseDiff(diff),
      retyped: previous !== undefined && previous.type !== version.type,
      prompt: move === undefined
        ? null
        : { moveId: move.moveId, kind: move.kind, body: move.body },
    };
  });
}

/**
 * The comparison an instructor comment owes the student.
 *
 * Not "3 revisions since" but the words that moved, between the version that was
 * read and the one that is live.
 */
export interface ReviewDiff {
  reviewedNumber: number;
  currentNumber: number;
  reviewedText: string;
  currentText: string;
  diff: DiffSpan[];
  summary: DiffSummary;
}

export function diffSinceReview(
  state: ProjectState,
  objectId: ObjectId,
  reviewedVersionId: VersionId,
): ReviewDiff | undefined {
  const versions = versionsOf(state, objectId);
  const reviewedIndex = versions.findIndex((v) => v.versionId === reviewedVersionId);
  if (reviewedIndex < 0 || versions.length === 0) return undefined;

  const reviewed = versions[reviewedIndex] as ThoughtVersion;
  const current = versions[versions.length - 1] as ThoughtVersion;
  const diff = diffWords(reviewed.text, current.text);

  return {
    reviewedNumber: reviewedIndex + 1,
    currentNumber: versions.length,
    reviewedText: reviewed.text,
    currentText: current.text,
    diff,
    summary: summariseDiff(diff),
  };
}
