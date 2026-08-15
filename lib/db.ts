import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

/**
 * Lazily-created singleton pool, reused across warm Next.js serverless
 * invocations. Throws (rather than silently connecting to nothing) if
 * DATABASE_URL isn't configured — callers should surface that as a clear
 * "DATABASE UNAVAILABLE" state, never fall back to fake data.
 */
function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Cheap connectivity check for the /demo status panel. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
