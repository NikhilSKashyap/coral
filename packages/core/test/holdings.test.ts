import { describe, expect, it } from 'vitest';
import { abstractFromInvertedIndex, accessFrom, accessRank } from '../src/holdings.js';
import { canBackEvidence } from '../src/types.js';

describe('the access level is earned, not asserted', () => {
  it('starts at metadata when we hold nothing but a record', () => {
    expect(accessFrom({ hasAbstract: false, hasRetrievedText: false, uploaded: false }))
      .toBe('metadata');
  });

  it('reaches abstract on an abstract alone, which cannot back evidence', () => {
    const access = accessFrom({ hasAbstract: true, hasRetrievedText: false, uploaded: false });
    expect(access).toBe('abstract');
    expect(canBackEvidence(access)).toBe(false);
  });

  it('reaches open_full_text only with text in hand', () => {
    const access = accessFrom({ hasAbstract: true, hasRetrievedText: true, uploaded: false });
    expect(access).toBe('open_full_text');
    expect(canBackEvidence(access)).toBe(true);
  });

  it('lets an upload outrank whatever retrieval managed', () => {
    expect(accessFrom({ hasAbstract: false, hasRetrievedText: false, uploaded: true }))
      .toBe('user_upload');
  });

  it('has no way to say "open access but we do not have it"', () => {
    // The structural point of the module. A record claiming is_oa with a
    // publisher link we cannot fetch has no field to arrive in, so it lands at
    // abstract or metadata like any other text we do not hold.
    const holdings = { hasAbstract: true, hasRetrievedText: false, uploaded: false };
    expect(Object.keys(holdings)).not.toContain('isOpenAccess');
    expect(canBackEvidence(accessFrom(holdings))).toBe(false);
  });

  it('ranks the levels in the order they are earned', () => {
    expect(accessRank('metadata')).toBeLessThan(accessRank('abstract'));
    expect(accessRank('abstract')).toBeLessThan(accessRank('open_full_text'));
    expect(accessRank('open_full_text')).toBeLessThan(accessRank('user_upload'));
  });
});

describe('an abstract is reconstructed, never summarised', () => {
  it('rebuilds the sentence from word positions', () => {
    expect(abstractFromInvertedIndex({
      Self: [0], reported: [1], effort: [2], fell: [3],
    })).toBe('Self reported effort fell');
  });

  it('handles a word that appears more than once', () => {
    expect(abstractFromInvertedIndex({ the: [0, 2], of: [1], study: [3] }))
      .toBe('the of the study');
  });

  it('returns null when there is nothing to rebuild', () => {
    expect(abstractFromInvertedIndex(null)).toBeNull();
    expect(abstractFromInvertedIndex(undefined)).toBeNull();
    expect(abstractFromInvertedIndex({})).toBeNull();
  });

  it('refuses a gapped index rather than inventing the missing words', () => {
    // Position 1 is absent. Joining what is left would produce a sentence the
    // paper does not contain, so there is no abstract instead of a wrong one.
    expect(abstractFromInvertedIndex({ effort: [0], fell: [2] })).toBeNull();
  });

  it('ignores nonsense positions instead of trusting them', () => {
    expect(abstractFromInvertedIndex({ effort: [-1] })).toBeNull();
  });
});
