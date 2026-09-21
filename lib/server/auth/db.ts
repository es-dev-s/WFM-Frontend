import pg from "pg";
import { databaseUrl } from "@/lib/server/auth/types";

const { Pool } = pg;

declare global {
  var __wfmPgPool: pg.Pool | undefined;
}

export function getPool(): pg.Pool {
  if (globalThis.__wfmPgPool) return globalThis.__wfmPgPool;
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on("error", (error) => {
    console.error("postgres pool error", error.message);
  });
  globalThis.__wfmPgPool = pool;
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the original error matters more */
    }
    throw error;
  } finally {
    client.release();
  }
}
