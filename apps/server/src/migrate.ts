import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'migrations');

/**
 * An arbitrary but stable key. Two migrate processes racing on a fresh database
 * would otherwise both read an empty applied set and both try to create the same
 * enums; the second one fails on a duplicate type name.
 */
const MIGRATION_LOCK = 4_872_310_017;

async function main(): Promise<void> {
  const lock = await pool.connect();
  await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
  try {
    await runPending();
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    lock.release();
  }
  await pool.end();
}

async function runPending(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('select name from schema_migration');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migration (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`  apply ${file}`);
    } catch (error) {
      await client.query('rollback');
      console.error(`  FAIL  ${file}`);
      throw error;
    } finally {
      client.release();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
