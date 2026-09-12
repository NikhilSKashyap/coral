import { gunzipSync } from 'node:zlib';
import { abstractFromInvertedIndex, accessFrom, type SourceAccess } from '@coral/core';

/**
 * Literature retrieval against OpenAlex.
 *
 * Metadata needs no key and no email. Full text does: OpenAlex advertises
 * `has_fulltext` and a `content_urls` pair on many works, but downloading
 * either the PDF or the GROBID XML answers 401 without one. So this module has
 * two tiers, and the difference between them is exactly the difference the
 * access level is supposed to record.
 *
 * Without a key, a result is `metadata` or `abstract` and the student uploads
 * the paper to go further. With one, we fetch the structured text and a passage
 * becomes quotable with a real section heading behind it.
 *
 * Nothing here asserts an access level. It reports what it managed to hold and
 * `accessFrom` in `@coral/core` decides, which is why a work claiming
 * `is_oa: true` behind a publisher wall cannot arrive as `open_full_text`.
 */

const API = 'https://api.openalex.org';
const CONTENT = 'https://content.openalex.org';

/** OpenAlex asks for a contact in the UA for its polite pool. A repo URL qualifies. */
const UA = 'Coral/0.1 (https://github.com/NikhilSKashyap/coral)';

export interface SourceCandidate {
  cite: string;
  title: string;
  method: string | null;
  abstract: string | null;
  externalUrl: string | null;
  doi: string | null;
  access: SourceAccess;
  /** Set only when the text is genuinely in hand. */
  passage: { text: string; locator: string } | null;
  /** OpenAlex's own id, so full text can be fetched later without re-searching. */
  workId: string;
  /** True when OpenAlex says text exists but we could not hold it. Advisory only. */
  fullTextOffered: boolean;
}

interface OpenAlexWork {
  id?: string;
  display_name?: string | null;
  title?: string | null;
  doi?: string | null;
  publication_year?: number | null;
  type?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  has_fulltext?: boolean | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: { display_name?: string | null } | null;
  } | null;
  best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null;
  open_access?: { is_oa?: boolean | null; oa_url?: string | null } | null;
}

const apiKey = (): string | undefined => {
  const key = process.env['OPENALEX_API_KEY']?.trim();
  return key === undefined || key === '' ? undefined : key;
};

export const canRetrieveFullText = (): boolean => apiKey() !== undefined;

/** A citation string a student would recognise: author, year. */
function citeOf(work: OpenAlexWork): string {
  const first = work.authorships?.[0]?.author?.display_name?.trim();
  const year = work.publication_year;
  const surname = first === undefined || first === '' ? null : (first.split(/\s+/).pop() ?? null);
  const many = (work.authorships?.length ?? 0) > 2;

  if (surname === null) return year === null || year === undefined ? 'Unknown source' : `Anon., ${year}`;
  const names = many ? `${surname} et al.` : surname;
  return year === null || year === undefined ? names : `${names}, ${String(year)}`;
}

const fetchJson = async (url: string, timeoutMs = 12_000): Promise<unknown> => {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`OpenAlex answered ${String(res.status)} for ${url}`);
  return res.json();
};

export interface SearchOptions {
  /** How many results to return. OpenAlex pages at 25 by default. */
  limit?: number;
  /** Fetch full text for open results. Costs a request per work, so it is opt-in. */
  withFullText?: boolean;
}

/**
 * Search the literature.
 *
 * Results come back at whatever level we can actually support, including
 * `metadata` for a work with no abstract. Surfacing those is deliberate: the
 * flow says search returns everything and the gate decides what can become
 * evidence, so a student can see before clicking whether a paper can back a
 * claim or only be noted.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<SourceCandidate[]> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
  const url = `${API}/works?search=${encodeURIComponent(query)}&per-page=${String(limit)}`
    + '&filter=type:article|preprint|book-chapter|conference-paper';

  const payload = await fetchJson(url);
  const works = (payload as { results?: OpenAlexWork[] }).results ?? [];

  const candidates = works.map(toCandidate);

  if (options.withFullText !== true || !canRetrieveFullText()) return candidates;

  // Sequential on purpose. This is a courtesy request against a free service on
  // behalf of one student, not a crawl.
  const filled: SourceCandidate[] = [];
  for (const candidate of candidates) {
    filled.push(candidate.fullTextOffered ? await withPassage(candidate) : candidate);
  }
  return filled;
}

function toCandidate(work: OpenAlexWork): SourceCandidate {
  const abstract = abstractFromInvertedIndex(work.abstract_inverted_index);
  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '') ?? null;

  return {
    cite: citeOf(work),
    title: (work.display_name ?? work.title ?? 'Untitled').trim(),
    method: work.primary_location?.source?.display_name?.trim() ?? null,
    abstract,
    externalUrl: work.best_oa_location?.landing_page_url
      ?? work.primary_location?.landing_page_url
      ?? work.open_access?.oa_url
      ?? (doi === null ? null : `https://doi.org/${doi}`),
    doi,
    // Derived, never asserted: no text held yet, so this is at most `abstract`.
    access: accessFrom({
      hasAbstract: abstract !== null,
      hasRetrievedText: false,
      uploaded: false,
    }),
    passage: null,
    workId: work.id ?? '',
    fullTextOffered: work.has_fulltext === true,
  };
}

/**
 * Try to hold the text, and say so honestly if it did not work.
 *
 * A failure here is not an error the student needs to see. It means the source
 * stays at the level it already earned, and the affordance becomes "upload the
 * paper" rather than a broken promise of a passage.
 */
async function withPassage(candidate: SourceCandidate): Promise<SourceCandidate> {
  const passage = await firstParagraph(candidate.workId).catch(() => null);
  if (passage === null) return candidate;

  return {
    ...candidate,
    passage,
    access: accessFrom({
      hasAbstract: candidate.abstract !== null,
      hasRetrievedText: true,
      uploaded: false,
    }),
  };
}

/**
 * Pull one substantive paragraph out of OpenAlex's GROBID XML, with the section
 * heading it sat under.
 *
 * The heading is what makes a locator honest: "p. 9, Results" is findable
 * again, and a passage nobody can find is not much better than one we invented.
 * Parsed with regular expressions rather than an XML dependency because we want
 * one paragraph and its heading, not a document model.
 */
export async function firstParagraph(
  workId: string,
): Promise<{ text: string; locator: string } | null> {
  const key = apiKey();
  if (key === undefined || workId === '') return null;

  const id = workId.replace(/^https?:\/\/openalex\.org\//, '');
  const res = await fetch(`${CONTENT}/works/${id}.grobid-xml`, {
    headers: { 'user-agent': UA, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;

  const xml = decompress(new Uint8Array(await res.arrayBuffer()));
  const body = xml.slice(xml.indexOf('<body'));

  // Walk divs so a paragraph keeps the heading above it.
  const divs = body.split(/<div\b/).slice(1);
  for (const div of divs) {
    const heading = strip(/<head[^>]*>([\s\S]*?)<\/head>/.exec(div)?.[1] ?? '');
    for (const match of div.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      const text = strip(match[1] ?? '');
      if (!quotable(text)) continue;
      return {
        text: text.slice(0, 1200),
        locator: heading === '' ? 'body text' : heading.slice(0, 80),
      };
    }
  }
  return null;
}

/**
 * Is this paragraph worth offering as a passage?
 *
 * GROBID keeps front matter in the body: author lists, affiliations, funding
 * notes and copyright blocks all arrive as long paragraphs under a real heading.
 * Offering one as the quotable passage is not dishonest, but it is useless — a
 * student cannot build evidence on a list of email addresses.
 *
 * The tests are for prose rather than for topic: contact details, a high density
 * of capitalised tokens (which is what a byline looks like), and text with no
 * sentence in it are all skipped. A fragment that starts mid-sentence is skipped
 * too, since a quote that begins in the middle of a clause reads as a misquote.
 */
function quotable(text: string): boolean {
  if (text.length < 220) return false;
  if (text.includes('@')) return false;
  // Real prose contains sentences.
  if ((text.match(/[.?!]\s+[A-Z]/g) ?? []).length < 2) return false;
  // A byline or affiliation block is mostly capitalised tokens.
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length < 40) return false;
  const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (capitalised / words.length > 0.3) return false;
  // Starts mid-sentence.
  if (!/^[A-Z"'(\u201c]/.test(text)) return false;
  return true;
}

/**
 * The content endpoint serves a gzip *file*, not a gzip-encoded response.
 *
 * `content-type: application/gzip` with no `content-encoding`, so fetch does not
 * unwrap it and `res.text()` yields binary. Sniffing the magic bytes rather than
 * trusting the header means a future switch to plain XML keeps working.
 */
function decompress(bytes: Uint8Array): string {
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const raw = gzipped ? gunzipSync(bytes) : bytes;
  return new TextDecoder('utf-8').decode(raw);
}

/** XML to plain text. Entities that matter in prose, tags dropped. */
const strip = (xml: string): string =>
  xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
