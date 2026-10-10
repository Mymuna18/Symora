import { pathToFileURL } from "node:url";
import { getPool, closePool } from "../lib/db-pool.mjs";

// This diagnostic intentionally does not load .env files. A live run requires
// explicit authorization and DATABASE_URL supplied by the caller's environment.
export async function checkDatabase({
  openPool = getPool,
  endPool = closePool,
  log = (message) => console.log(message),
  logError = (message) => console.error(message),
} = {}) {
  let passed = false;
  try {
    log("Checking PostgreSQL connectivity...");
    const result = await openPool().query("SELECT 1 AS connection_ok");
    if (result.rows[0]?.connection_ok !== 1) {
      throw new Error("Unexpected connectivity response.");
    }
    passed = true;
  } catch {
    logError("PostgreSQL connection check failed. Verify server-side configuration and database availability.");
  } finally {
    try {
      await endPool();
    } catch {
      passed = false;
      logError("PostgreSQL pool cleanup failed.");
    }
  }
  if (passed) log("SUCCESS! PostgreSQL connection and cleanup completed.");
  return passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = (await checkDatabase()) ? 0 : 1;
}
