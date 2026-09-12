import type { PassageProvenance, SourceAccess } from '@noesis/core';

/**
 * Stand-in search results until real retrieval lands in slice 03.
 *
 * The point of the fixture is the spread of access levels. Two of these carry a
 * retrievable passage and two do not, so the evidence gate can be exercised
 * against both cases without a network call. Titles and findings are the ones
 * the v2 prototype used.
 */
export interface FixturePaper {
  cite: string;
  title: string;
  method: string;
  access: SourceAccess;
  abstract: string;
  passage: { text: string; locator: string; provenance: PassageProvenance } | null;
}

export const FIXTURE_PAPERS: FixturePaper[] = [
  {
    cite: 'Smith et al., 2025',
    title: 'AI Assistance and Hypothesis Generation',
    method: 'Experimental',
    access: 'open_full_text',
    abstract: 'A controlled comparison of hypothesis generation with and without generated examples.',
    passage: {
      text: 'Students exposed to generated examples produced fewer unique hypotheses than an unaided control group.',
      locator: 'p. 4, Results',
      provenance: 'retrieved',
    },
  },
  {
    cite: 'Okoro & Lind, 2024',
    title: 'Task Speed, Effort, and Perceived Learning',
    method: 'Mixed methods',
    access: 'abstract',
    abstract: 'Self-reported cognitive effort fell by a third while completion time halved; comprehension scores were unchanged.',
    passage: null,
  },
  {
    cite: 'Marek, 2026',
    title: 'Transfer After Scaffolded Analysis',
    method: 'Longitudinal',
    access: 'metadata',
    abstract: '',
    passage: null,
  },
  {
    cite: 'Halvorsen, 2023',
    title: 'What Graduate Readers Do With Disagreement',
    method: 'Qualitative',
    access: 'open_full_text',
    abstract: 'An interview study of how graduate readers handle conflicting sources.',
    passage: {
      text: 'Readers who summarised each source separately rarely surfaced contradictions between them.',
      locator: 'p. 12, Findings',
      provenance: 'retrieved',
    },
  },
];
