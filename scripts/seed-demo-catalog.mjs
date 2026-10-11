import pg from "pg";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../lib/db-pool.mjs";
import { inspectionPoolOptions, metadataQueries } from "./inspect-tigerdata.mjs";
import { inspectDemoCatalog, insertMissingDemoCatalog } from "../lib/demo-catalog.mjs";

export const CONFIRMATION = "SEED SYMORA DEMO CATALOG";
export const CATALOG_LOCK = "LOCK TABLE public.symptoms IN SHARE ROW EXCLUSIVE MODE";
export function parseSeedArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--preflight")) return "preflight";
  if (args.length === 2 && args.includes("--execute") && args.includes("--approve-demo-catalog")) return "execute";
  throw new Error("Use --preflight or both --execute and --approve-demo-catalog after approval.");
}

function connectDatabase(options, onError) {
  return createDatabase({
    Pool: class extends pg.Pool { constructor() { super(options); } },
    readConnectionString: () => "validated-demo-catalog-options", cache: {}, logError: onError,
  });
}

export async function runSeed({ args = [], confirmation = "", expectedHost, expectedDatabase,
  connectionString, makeDatabase = connectDatabase, log = console.log, logError = console.error }) {
  let database, client, mode, summary;
  let transaction = false, success = false, commitAttempted = false, committed = false, connectionFailed = false;
  let stage = "configuration/approval";
  const onError = () => { connectionFailed = true; };
  try {
    mode = parseSeedArguments(args);
    if (expectedDatabase !== "tsdb" || (mode === "execute" && confirmation !== CONFIRMATION)) throw new Error("Unapproved target or execution.");
    const options = inspectionPoolOptions(connectionString, expectedHost, expectedDatabase);
    options.application_name = "symora-demo-catalog";
    options.query_timeout = 35_000;
    options.options = "-c default_transaction_read_only=on -c search_path=public -c lock_timeout=5000 -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000";
    database = makeDatabase(options, onError);
    stage = "connection/TLS";
    client = await database.getPool().connect();
    client.on?.("error", onError);
    if (!client.connection?.stream?.encrypted || client.connection.stream.authorized !== true) throw new Error("TLS required.");
    await client.query(mode === "execute" ? "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    stage = "database identity";
    const identity = (await client.query(metadataQueries.identity, ["tsdb"])).rows[0];
    if (identity?.database !== "tsdb" || identity.database_matches !== true || identity.selected_schema !== "public"
      || identity.search_path !== "public" || identity.tls !== true || identity.read_only !== (mode === "preflight")
      || identity.can_connect !== true || identity.can_generate_uuid !== true) throw new Error("Unexpected database identity.");
    stage = "catalog inspection";
    // Serializes competing seed/DML operations while allowing ordinary reads.
    // Read-only preflight never takes this lock or executes an INSERT.
    if (mode === "execute") await client.query(CATALOG_LOCK);
    const before = await inspectDemoCatalog(client);
    if (connectionFailed) throw new Error("Connection failed.");
    let inserted = 0;
    if (mode === "execute") {
      stage = "catalog insertion/verification";
      inserted = await insertMissingDemoCatalog(client, before.missing);
      const after = await inspectDemoCatalog(client);
      if (after.missing.length !== 0 || connectionFailed) throw new Error("Catalog verification failed.");
      stage = "commit";
      commitAttempted = true;
      const result = await client.query("COMMIT");
      if (result.command !== "COMMIT") throw new Error("Commit unconfirmed.");
      committed = true;
    } else {
      await client.query("ROLLBACK");
    }
    transaction = false;
    summary = {
      status: mode === "execute" ? "DEMO_CATALOG_COMMITTED" : "DEMO_CATALOG_PREFLIGHT_NO_CHANGES",
      existingCodes: before.existing.map(({ code }) => code),
      missingCodes: mode === "execute" ? [] : before.missing.map(({ code }) => code),
      inserted,
    };
    success = true;
  } catch {
    logError(commitAttempted && !committed
      ? "Catalog commit outcome is unknown. Do not retry automatically; inspect read-only first."
      : `Catalog seed stopped during ${stage}. No commit was confirmed. Existing data will not be overwritten.`);
  } finally {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { success = false; logError("Rollback unconfirmed; discarding the connection. Inspect before retrying."); }
    }
    if (client) {
      try { client.release(!success); } catch { success = false; logError("Connection cleanup failed."); }
    }
    try { await database?.closePool(); } catch { success = false; logError("Pool cleanup failed."); }
    client?.removeListener?.("error", onError);
    if (connectionFailed) success = false;
  }
  if (success) log(JSON.stringify(summary, null, 2));
  else if (committed) logError("Catalog commit succeeded but cleanup failed; do not assume it was rolled back.");
  return success;
}

export async function main() {
  const args = process.argv.slice(2), mode = parseSeedArguments(args);
  if (!process.stdin.isTTY) throw new Error("Interactive terminal required.");
  console.log(`Demo catalog ${mode}: enter development target details only, never a password or connection string.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let expectedHost, expectedDatabase, confirmation = "";
  try {
    expectedHost = (await terminal.question("Expected TigerData development hostname: ")).trim();
    expectedDatabase = (await terminal.question("Expected database (tsdb): ")).trim();
    if (mode === "execute") confirmation = await terminal.question(`After separate approval, type ${CONFIRMATION}: `);
  } finally { terminal.close(); }
  return runSeed({ args, confirmation, expectedHost, expectedDatabase, connectionString: process.env.DATABASE_URL });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await main()) ? 0 : 1; } catch {
    console.error("Catalog seed stopped. Use supported arguments in an interactive terminal. No credentials are displayed.");
    process.exitCode = 1;
  }
}
