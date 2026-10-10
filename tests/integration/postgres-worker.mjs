// Internal child of scripts/test-postgres.mjs. Never run against an existing DB.
import { readFile } from "node:fs/promises";
import { workerPoolOptions } from "./local-postgres.mjs";
import { seedFixtures } from "./fixtures.mjs";
import { runPostgresSuite } from "./postgres-suite.mjs";

let pool;
try {
  if (process.env.SYMORA_ISOLATED_SQL_APPROVED !== "yes") throw new Error("Approval missing.");
  // Check names only; never read inherited production credentials or their values.
  if (Object.keys(process.env).some((key) => /^PG|^DATABASE_URL$|^NODE_OPTIONS$/.test(key))) throw new Error("Unsafe inherited environment.");
  const received = JSON.parse(process.env.SYMORA_ISOLATED_PG ?? "null");
  const options = workerPoolOptions(received);
  delete process.env.SYMORA_ISOLATED_PG;
  const { default: pg } = await import("pg");
  pool = new pg.Pool(options);
  pool.on("error", () => { console.error("An isolated PostgreSQL connection failed."); process.exitCode = 1; });

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await pool.query("SELECT 1"); ready = true; break; } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error("Local PostgreSQL did not become ready.");
  const identity = await pool.query("SELECT current_database() AS database, current_user AS username");
  if (identity.rows[0].database !== options.database || identity.rows[0].username !== options.user) throw new Error("Database identity mismatch.");
  const existing = await pool.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public'");
  if (existing.rows[0].count !== 0) throw new Error("Refusing a nonempty database.");

  const migration = await readFile(new URL("../../db/migrations/001_initial_schema.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  await seedFixtures(pool);
  await runPostgresSuite(pool);
} catch {
  // Never dump a driver exception, environment, or pool configuration.
  console.error("Isolated PostgreSQL preparation failed. Verify approval, the fresh local container, and the migration.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
