import { Pool } from 'pg';

export const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://noesis:noesis@localhost:5433/noesis';

export const pool = new Pool({ connectionString });

export async function withTransaction<T>(fn: (q: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export type TxClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
