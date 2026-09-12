import { accessFrom, type PassageId, type ProjectId, type SourceId } from '@coral/core';
import { FIXTURE_PAPERS } from './fixtures.js';
import { canRetrieveFullText, search, type SourceCandidate } from './openalex.js';
import { appendEvent, loadProject, type ProjectView } from './repo.js';

/**
 * Literature search, with a floor under it.
 *
 * Same shape as the coach: try the real thing, fall back to something that
 * always works, and say which one answered. A laptop with no network still gets
 * four papers spread across the access levels, so the evidence gate can be
 * exercised on a plane.
 *
 * Results are written as coach events, because discovering a source is a coach
 * action. A passage is captured only where the text is genuinely held — there is
 * no branch in this file that writes a passage from an abstract, a landing page,
 * or a promise of full text.
 */

export interface SearchBody {
  /** Defaults to the project's own research question. */
  query?: string;
}

export interface SearchResult extends ProjectView {
  query: string;
  source: 'openalex' | 'fixture';
  /** Set when retrieval was attempted and could not answer. */
  reason?: string;
  found: number;
  added: number;
  /** How many results OpenAlex said had full text that we declined to claim. */
  offeredButNotHeld: number;
}

/** The fixture, in the shape retrieval returns, for the offline path. */
const fixtureCandidates = (): SourceCandidate[] =>
  FIXTURE_PAPERS.map((paper) => ({
    cite: paper.cite,
    title: paper.title,
    method: paper.method,
    abstract: paper.abstract === '' ? null : paper.abstract,
    externalUrl: null,
    doi: null,
    access: paper.access,
    passage: paper.passage === null
      ? null
      : { text: paper.passage.text, locator: paper.passage.locator },
    workId: '',
    fullTextOffered: paper.passage !== null,
  }));

export async function runSearch(
  projectId: ProjectId,
  body: SearchBody,
): Promise<SearchResult> {
  let view = await loadProject(projectId);
  const query = (body.query ?? '').trim() === ''
    ? view.state.title
    : (body.query ?? '').trim();

  let candidates: SourceCandidate[];
  let from: 'openalex' | 'fixture' = 'openalex';
  let reason: string | undefined;

  try {
    candidates = await search(query, { limit: 8, withFullText: true });
    if (candidates.length === 0) {
      candidates = fixtureCandidates();
      from = 'fixture';
      reason = `OpenAlex returned nothing for "${query}"`;
    }
  } catch (error) {
    candidates = fixtureCandidates();
    from = 'fixture';
    reason = error instanceof Error ? error.message : String(error);
  }

  // Don't re-add what a previous search already found. Matched on DOI where
  // there is one and on title otherwise, since a repeat search of the same
  // question should not fill the panel with duplicates.
  const held = new Set(
    Object.values(view.state.sources).flatMap((s) => [
      s.doi === null ? null : `doi:${s.doi.toLowerCase()}`,
      `title:${s.title.toLowerCase()}`,
    ]).filter((k): k is string => k !== null),
  );

  let added = 0;
  for (const candidate of candidates) {
    const keys = [
      candidate.doi === null ? null : `doi:${candidate.doi.toLowerCase()}`,
      `title:${candidate.title.toLowerCase()}`,
    ].filter((k): k is string => k !== null);
    if (keys.some((k) => held.has(k))) continue;
    for (const k of keys) held.add(k);

    const sourceId = crypto.randomUUID() as SourceId;

    // The level is recomputed here from what this record actually carries,
    // rather than trusted from the candidate, so the one place it can be set is
    // the one function that derives it.
    const access = accessFrom({
      hasAbstract: candidate.abstract !== null,
      hasRetrievedText: candidate.passage !== null,
      uploaded: false,
    });

    view = await appendEvent(projectId, {
      actor: 'coach',
      type: 'source.discovered',
      payload: {
        sourceId,
        access,
        cite: candidate.cite,
        title: candidate.title,
        method: candidate.method,
        abstract: candidate.abstract,
        externalUrl: candidate.externalUrl,
        doi: candidate.doi,
      },
    });

    if (candidate.passage !== null) {
      view = await appendEvent(projectId, {
        actor: 'coach',
        type: 'passage.captured',
        payload: {
          passageId: crypto.randomUUID() as PassageId,
          sourceId,
          text: candidate.passage.text,
          locator: candidate.passage.locator,
          // Retrieved, because we fetched the characters. The only other way to
          // get here is an upload or the student typing a quote.
          provenance: 'retrieved',
        },
      });
    }
    added += 1;
  }

  return {
    ...view,
    query,
    source: from,
    ...(reason === undefined ? {} : { reason }),
    found: candidates.length,
    added,
    offeredButNotHeld: candidates.filter((c) => c.fullTextOffered && c.passage === null).length,
  };
}

export { canRetrieveFullText };
