import cors from '@fastify/cors';
import Fastify from 'fastify';
import { InvariantViolation } from '@coral/core';
import { pool } from './db.js';
import { ensureSeats } from './repo.js';
import { routes } from './routes.js';
import { MAX_PDF_BYTES } from './upload.js';

const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'warn' } });

/**
 * Registered before any route plugin: Fastify copies the handler into each child
 * context at registration time, so one set afterwards never reaches them.
 *
 * A refused write is a 422 and the invariant name is the whole explanation. The
 * `name` check rather than `instanceof` alone keeps this working if the core
 * package is ever loaded through two module instances.
 */
app.setErrorHandler((error: unknown, _request, reply) => {
  const named = error as { name?: string; message?: string; invariant?: string; code?: unknown };
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof InvariantViolation || named.name === 'InvariantViolation') {
    return reply.status(422).send({ invariant: named.invariant ?? 'unknown', message });
  }
  // Constraints and triggers the database enforces surface the same way.
  if (typeof named.code === 'string' && (named.code.startsWith('23') || named.code === 'P0001')) {
    return reply.status(422).send({ invariant: 'database', message });
  }
  app.log.error(error);
  return reply.status(500).send({ invariant: null, message });
});

await app.register(cors, { origin: true });

/**
 * A PDF arrives as its own bytes, not wrapped in a multipart part.
 *
 * Registered before the routes so the upload handler receives a Buffer. The cap
 * is enforced here as well as in the handler, so an oversized body is rejected
 * before it is all in memory.
 */
app.addContentTypeParser(
  'application/pdf',
  { parseAs: 'buffer', bodyLimit: MAX_PDF_BYTES },
  (_request, body, done) => { done(null, body); },
);

await app.register(routes);

app.get('/health', async () => {
  const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
  return { ok: rows[0]?.ok === 1 };
});

await ensureSeats();
const port = Number(process.env['PORT'] ?? 8787);
await app.listen({ port, host: '0.0.0.0' });
console.log(`coral server on http://localhost:${port}`);
