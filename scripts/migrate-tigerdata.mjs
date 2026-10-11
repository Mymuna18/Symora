import pg from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../lib/db-pool.mjs";
import { inspectionPoolOptions, metadataQueries } from "./inspect-tigerdata.mjs";
import { DATABASE, SCHEMA, TABLES, OBJECT_NAMES, TYPE_NAMES, MIGRATION_SHA256, verifySchema } from "../lib/migration-contract.mjs";

export const CONFIRMATION = "APPLY SYMORA 001 TO tsdb.public";
export const MIGRATION_URL = new URL("../db/migrations/001_initial_schema.sql", import.meta.url);
export function parseMigrationArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--preflight")) return "preflight";
  if (args.length === 2 && new Set(args).size === 2 && args.includes("--execute") && args.includes("--approve-migration=001")) return "execute";
  throw new Error("Use --preflight, or both --execute and --approve-migration=001 after approval.");
}
export function verifyMigrationBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || createHash("sha256").update(bytes).digest("hex") !== MIGRATION_SHA256) throw new Error("Reviewed migration checksum mismatch.");
  return bytes.toString("utf8");
}

export const queries = Object.freeze({
  permissions: `SELECT has_schema_privilege($1, 'USAGE') AS can_use,
    has_schema_privilege($1, 'CREATE') AS can_create,
    current_setting('server_version_num')::integer AS version,
    EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a
      WHERE d.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
        AND d.defaclobjtype = 'r'
        AND (d.defaclnamespace = 0 OR d.defaclnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1))
        AND a.grantee <> d.defaclrole) AS external_default_grants`,
  lock: "SELECT pg_catalog.pg_try_advisory_xact_lock(1398361423, 1) AS locked",
  tables: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    c.relpersistence AS persistence, c.relrowsecurity AS row_security,
    c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owned
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname`,
  columns: `SELECT c.relname AS table, a.attname AS name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`,
  constraints: `SELECT c.relname AS table, k.conname AS name, k.contype AS kind,
    k.convalidated AS validated, COALESCE((to_jsonb(k)->>'conenforced')::boolean, true) AS enforced,
    k.condeferrable AS deferrable, k.condeferred AS deferred,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(num, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.num ORDER BY u.ord) AS columns,
    rn.nspname AS target_schema, rc.relname AS target,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(num, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = rc.oid AND a.attnum = u.num ORDER BY u.ord) AS target_columns,
    k.confdeltype AS deletion, k.confupdtype AS update, k.confmatchtype AS match,
    pg_catalog.pg_get_expr(k.conbin, k.conrelid) AS expression
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class rc ON rc.oid = k.confrelid
    LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname, k.conname`,
  indexes: `SELECT n.nspname AS schema, c.relname AS table, ic.relname AS name,
    i.indisunique AS unique, i.indisvalid AS valid, i.indisready AS ready, am.amname AS method,
    i.indpred IS NOT NULL AS partial, i.indexprs IS NOT NULL AS expression,
    i.indnatts <> i.indnkeyatts AS included,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY u(num, ord)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.num ORDER BY u.ord) AS columns,
    ARRAY(SELECT (u.flag & 1) <> 0 FROM unnest(i.indoption::smallint[]) WITH ORDINALITY u(flag, ord) ORDER BY u.ord) AS descending,
    ARRAY(SELECT (u.flag & 2) <> 0 FROM unnest(i.indoption::smallint[]) WITH ORDINALITY u(flag, ord) ORDER BY u.ord) AS nulls_first
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname, ic.relname`,
});

function databaseFor(options, onError) {
  return createDatabase({
    Pool: class extends pg.Pool { constructor() { super(options); } },
    readConnectionString: () => "validated-migration-options", cache: {}, logError: onError,
  });
}

export async function runMigration({ args = [], confirmation = "", expectedHost, expectedDatabase,
  connectionString, loadMigration = () => readFile(MIGRATION_URL), makeDatabase = databaseFor,
  log = console.log, logError = console.error }) {
  let database;
  let client;
  let transaction = false;
  let success = false;
  let commitAttempted = false;
  let committed = false;
  let connectionFailed = false;
  const onConnectionError = () => { connectionFailed = true; };
  let stage = "configuration/checksum/approval";
  let mode;
  try {
    mode = parseMigrationArguments(args);
    if (expectedDatabase !== DATABASE || (mode === "execute" && confirmation !== CONFIRMATION)) throw new Error("Approval or target mismatch.");
    const options = inspectionPoolOptions(connectionString, expectedHost, expectedDatabase);
    const sql = verifyMigrationBytes(await loadMigration());
    // Keep startup default read-only in BOTH modes. Only the explicit approved
    // transaction below can enable writes. URL and inherited PG* overrides cannot.
    options.application_name = "symora-migration-001";
    options.query_timeout = 35_000;
    options.options = "-c default_transaction_read_only=on -c search_path=public -c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000";
    database = makeDatabase(options, onConnectionError);
    stage = "connection/TLS";
    client = await database.getPool().connect();
    // A checked-out pg client needs its own listener, separate from pool idle
    // errors. Consume raw driver errors without ever printing their contents.
    client.on?.("error", onConnectionError);
    if (!client.connection?.stream?.encrypted || client.connection.stream.authorized !== true) throw new Error("TLS failed.");
    stage = "transaction";
    await client.query(mode === "execute" ? "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    if (mode === "execute" && (await client.query(queries.lock)).rows[0]?.locked !== true) throw new Error("Another migration is active.");
    stage = "identity/permissions/conflicts";
    const identity = (await client.query(metadataQueries.identity, [DATABASE])).rows[0];
    if (identity?.database !== DATABASE || identity.database_matches !== true || identity.selected_schema !== SCHEMA
      || identity.search_path !== SCHEMA || identity.tls !== true || identity.read_only !== (mode === "preflight")
      || identity.can_connect !== true || identity.can_generate_uuid !== true) throw new Error("Identity or permission mismatch.");
    const permissions = (await client.query(queries.permissions, [SCHEMA])).rows[0];
    if (!permissions?.can_use || !permissions.can_create || permissions.external_default_grants !== false
      || !Number.isInteger(permissions.version) || Math.floor(permissions.version / 10000) !== 18) throw new Error("Permissions or PostgreSQL version require review.");
    const conflicts = (await client.query(metadataQueries.conflicts, [SCHEMA, OBJECT_NAMES, TYPE_NAMES])).rows;
    if (conflicts.length !== 0 || connectionFailed) throw new Error("Migration conflict.");
    if (mode === "execute") {
      stage = "migration";
      // Execute the very same bytes that were hashed; never reload a changed file.
      await client.query(sql);
      stage = "schema verification";
      const snapshot = {};
      for (const key of ["tables", "columns", "constraints", "indexes"]) snapshot[key] = (await client.query(queries[key], [SCHEMA, TABLES])).rows;
      verifySchema(snapshot);
      if (connectionFailed) throw new Error("Connection failed.");
      stage = "commit";
      commitAttempted = true;
      const result = await client.query("COMMIT");
      if (result.command !== "COMMIT") throw new Error("Commit not confirmed.");
      committed = true;
      transaction = false;
    } else {
      stage = "preflight rollback";
      await client.query("ROLLBACK");
      transaction = false;
    }
    success = true;
  } catch {
    if (commitAttempted && !committed) {
      logError("Commit outcome is unknown. Do not retry; perform a read-only inspection before deciding what to do next.");
    } else {
      logError(`Migration runner stopped during ${stage}. No commit was confirmed. No credentials or SQL errors are displayed.`);
    }
  } finally {
    if (client) {
      let destroy = !success;
      if (transaction) {
        try { await client.query("ROLLBACK"); } catch {
          success = false; destroy = true;
          logError("Rollback could not be confirmed; discarding the connection. Inspect the database before retrying.");
        }
      }
      try { client.release(destroy); } catch { success = false; logError("Connection cleanup failed."); }
    }
    try { await database?.closePool(); } catch { success = false; logError("Pool cleanup failed."); }
    client?.removeListener?.("error", onConnectionError);
    if (connectionFailed) success = false;
  }
  if (success) log(JSON.stringify({
    status: mode === "execute" ? "MIGRATION_001_COMMITTED" : "PREFLIGHT_PASSED_NO_CHANGES",
    database_matches_expected: true, schema: SCHEMA, tls_verified: true,
    migration_sha256: MIGRATION_SHA256, postgres_major: 18,
    note: mode === "execute" ? "Five tables and their constraints/indexes verified before commit. No seed or grants performed." : "DDL has not been executed or validated on this server. Separate execution approval is required.",
  }, null, 2));
  else if (committed) logError("Migration committed, but cleanup failed. Do not rerun the migration.");
  return success;
}

export async function main() {
  const args = process.argv.slice(2);
  const mode = parseMigrationArguments(args);
  if (!process.stdin.isTTY) throw new Error("Interactive confirmation required.");
  console.log(`Symora 001 ${mode}. Enter expected development details from TigerData's console. Never enter a password or connection string.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let expectedHost, expectedDatabase, confirmation = "";
  try {
    expectedHost = (await terminal.question("Expected development hostname: ")).trim();
    expectedDatabase = (await terminal.question("Expected database name (reviewed target: tsdb): ")).trim();
    if (mode === "execute") confirmation = await terminal.question(`Only after separate approval, type ${CONFIRMATION}: `);
  } finally { terminal.close(); }
  return runMigration({ args, expectedHost, expectedDatabase, confirmation, connectionString: process.env.DATABASE_URL });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await main()) ? 0 : 1; } catch {
    console.error("Runner stopped. Use an interactive terminal and supported arguments. No credentials are displayed.");
    process.exitCode = 1;
  }
}
