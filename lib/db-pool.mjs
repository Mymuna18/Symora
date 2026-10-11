import pg from "pg";

const poolCacheKey = Symbol.for("symora.postgres.pool");

// Shared Node implementation. Next.js code must import through lib/db.mjs.
// Dependencies are injectable so tests never read credentials or open sockets.
export function createDatabase({
  Pool = pg.Pool,
  readConnectionString = () => process.env.DATABASE_URL,
  cache = globalThis,
  logError = (message) => console.error(message),
} = {}) {
  function getPool() {
    const connectionString = readConnectionString()?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL must be configured before using PostgreSQL.");
    }

    if (!cache[poolCacheKey]) {
      const pool = new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      // pg removes the failed idle client itself. Keep the pool available and
      // never log the error/client: either can contain connection credentials.
      pool.on("error", () => {
        logError("PostgreSQL idle connection failed; the pool removed the affected client.");
      });
      cache[poolCacheKey] = pool;
    }
    return cache[poolCacheKey];
  }

  // For standalone scripts/tests, not per-request cleanup in the app.
  async function closePool() {
    const pool = cache[poolCacheKey];
    if (pool) {
      delete cache[poolCacheKey];
      await pool.end();
    }
  }

  return { getPool, closePool };
}

export const { getPool, closePool } = createDatabase();
