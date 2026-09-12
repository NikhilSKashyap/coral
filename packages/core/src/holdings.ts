import { SOURCE_ACCESS, type SourceAccess } from './types.js';

/**
 * What we actually hold for a source.
 *
 * The access level on a Source is the difference between "this paper is free
 * somewhere" and "we have the text". Retrieval is full of the first: a record
 * can say `is_oa: true` and carry a publisher PDF link that refuses our
 * request. If that stood in for the second, the evidence gate would start
 * passing sources nobody can quote, which is the exact failure invariant ii
 * exists to prevent.
 *
 * So the level is derived from this structure and never asserted by a caller.
 * Note what the structure cannot express: there is no field for "open access",
 * "has a PDF url", or "the publisher offers full text". The only thing that
 * earns `open_full_text` is text in hand.
 */
export interface Holdings {
  /** An abstract we can show, as text. Not a machine summary of one. */
  hasAbstract: boolean;
  /**
   * Passage text actually retrieved and held.
   *
   * Set this from a successful fetch that produced characters, never from a
   * flag on a metadata record that promised one.
   */
  hasRetrievedText: boolean;
  /** The student supplied the document themselves. */
  uploaded: boolean;
}

/**
 * The access level a source has earned.
 *
 * Ordered by what it licenses: only the last two can back an Evidence object,
 * and `canBackEvidence` is the predicate that says so.
 */
export function accessFrom(holdings: Holdings): SourceAccess {
  if (holdings.uploaded) return 'user_upload';
  if (holdings.hasRetrievedText) return 'open_full_text';
  if (holdings.hasAbstract) return 'abstract';
  return 'metadata';
}

/**
 * Rebuild an abstract from OpenAlex's inverted index.
 *
 * OpenAlex publishes abstracts as a word-to-positions map rather than a string,
 * for licensing reasons. Reconstructing it is lossless for our purposes — the
 * positions are complete — and it matters that this is a reconstruction of text
 * the source actually carries rather than a summary of it.
 *
 * Returns null rather than an empty string when there is nothing to rebuild, so
 * a caller cannot accidentally treat an absent abstract as a present blank one.
 */
export function abstractFromInvertedIndex(
  index: Record<string, number[]> | null | undefined,
): string | null {
  if (index === null || index === undefined) return null;

  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0) continue;
      words[position] = word;
    }
  }
  // Gaps would mean the index was malformed. Dropping them silently would
  // fabricate a sentence the paper does not contain, so bail instead.
  //
  // Checked with `in` rather than a value test: assigning by position leaves a
  // sparse array, and `some` skips holes, so it would report a gapped index as
  // complete.
  if (words.length === 0) return null;
  for (let i = 0; i < words.length; i += 1) {
    if (!(i in words)) return null;
  }

  const text = words.join(' ').trim();
  return text === '' ? null : text;
}

/** The four levels, in the order they are earned. Handy for interfaces that rank. */
export const ACCESS_ORDER: readonly SourceAccess[] = SOURCE_ACCESS;

export const accessRank = (access: SourceAccess): number => ACCESS_ORDER.indexOf(access);
