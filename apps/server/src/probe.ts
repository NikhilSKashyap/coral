/**
 * What retrieval actually returns, and at what level.
 *
 *   pnpm --filter @coral/server probe "your query"
 *
 * Prints the access level of every result. The point of reading this output is
 * the levels: a paper that is open access somewhere still arrives as `abstract`
 * unless we are holding its text, and `offered` shows how often OpenAlex says
 * full text exists while we decline to claim it. Set OPENALEX_API_KEY to see
 * the difference a content key makes.
 */
import { canRetrieveFullText, search } from './openalex.js';

const query = process.argv.slice(2).join(' ').trim()
  || 'generative AI effect on student independent reasoning';

console.log(`\nquery: ${query}`);
console.log(`full-text key: ${canRetrieveFullText() ? 'present' : 'absent — nothing can reach open_full_text'}\n`);

const results = await search(query, { limit: 6, withFullText: true });

for (const r of results) {
  const pad = ''.padEnd(16);
  console.log(`  ${r.access.padEnd(16)}${r.cite}`);
  console.log(`  ${pad}${r.title.slice(0, 76)}`);
  console.log(
    `  ${pad}abstract=${r.abstract === null ? 'none' : `${String(r.abstract.length)} chars`}`
    + `  doi=${r.doi ?? 'none'}  full text offered=${String(r.fullTextOffered)}`,
  );
  if (r.passage !== null) {
    console.log(`  ${pad}passage [${r.passage.locator}] ${r.passage.text.slice(0, 88)}…`);
  }
  console.log();
}

const levels = results.reduce<Record<string, number>>(
  (acc, r) => ({ ...acc, [r.access]: (acc[r.access] ?? 0) + 1 }), {},
);
console.log(`levels: ${JSON.stringify(levels)}`);
console.log(
  `offered but not held: ${String(results.filter((r) => r.fullTextOffered && r.passage === null).length)}\n`,
);
