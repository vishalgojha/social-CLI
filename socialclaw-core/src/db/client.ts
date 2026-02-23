import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
