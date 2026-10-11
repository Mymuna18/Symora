import pg from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../lib/db-pool.mjs";
import { inspectionPoolOptions, metadataQueries } from "./inspect-tigerdata.mjs";
import { DATABASE, SCHEMA, TABLES, OBJECT_NAMES, TYPE_NAMES, MIGRATION_SHA256, verifySchema } from "../lib/migration-contract.mjs";
import {
  BROWSER_AUTH_TABLES, BROWSER_AUTH_OBJECT_NAMES, BROWSER_AUTH_TYPE_NAMES, verifyBrowserAuthSchema,
} from "../lib/browser-auth-migration-contract.mjs";
import {
  FOLLOW_UP_TABLES, FOLLOW_UP_OBJECT_NAMES, FOLLOW_UP_TYPE_NAMES, verifyFollowUpSchema,
} from "../lib/follow-up-migration-contract.mjs";

export const CONFIRMATION = "APPLY SYMORA 001 TO tsdb.public";
export const MIGRATION_URL = new URL("../db/migrations/001_initial_schema.sql", import.meta.url);
export const BROWSER_AUTH_CONFIRMATION = "APPLY SYMORA 002 TO tsdb.public";
export const BROWSER_AUTH_MIGRATION_URL = new URL("../db/migrations/002_browser_auth_state.sql", import.meta.url);
export const FOLLOW_UP_CONFIRMATION = "APPLY SYMORA 003 TO tsdb.public";
export const FOLLOW_UP_MIGRATION_URL = new URL("../db/migrations/003_participant_follow_up_responses.sql", import.meta.url);
const MIGRATIONS = Object.freeze({
  "001": { url: MIGRATION_URL, sha256: MIGRATION_SHA256, tables: TABLES, objects: OBJECT_NAMES, types: TYPE_NAMES },
  "002": { url: BROWSER_AUTH_MIGRATION_URL, sha256: "2e68869d2bb21672c88456f85ed84d12d97da335deacc61d346ad0a49e698351",
    tables: BROWSER_AUTH_TABLES, objects: BROWSER_AUTH_OBJECT_NAMES, types: BROWSER_AUTH_TYPE_NAMES },
  "003": { url: FOLLOW_UP_MIGRATION_URL, sha256: "da3893a28c406eda97a5abf6a960ab8b30cf4f6b4b7583f7c60a7bdb44b421a0",
    tables: FOLLOW_UP_TABLES, objects: FOLLOW_UP_OBJECT_NAMES, types: FOLLOW_UP_TYPE_NAMES },
});

export function parseMigrationSelection(args) {
  const versionFlags = args.filter((arg) => arg.startsWith("--migration="));
  if (versionFlags.length > 1 || args.some((arg) => arg.startsWith("--migration=") && !["--migration=001", "--migration=002", "--migration=003"].includes(arg))) {
    throw new Error("Unsupported migration version.");
  }
  const version = versionFlags[0]?.slice("--migration=".length) ?? "001";
  const commandArgs = args.filter((arg) => !arg.startsWith("--migration="));
  if (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === "--preflight")) return { mode: "preflight", version };
  if (commandArgs.length === 2 && new Set(commandArgs).size === 2
    && commandArgs.includes("--execute") && commandArgs.includes(`--approve-migration=${version}`)) {
    return { mode: "execute", version };
  }
  throw new Error(`Use --migration=${version} for preflight, or --migration=${version} --execute --approve-migration=${version} after approval.`);
}
export function parseMigrationArguments(args) { return parseMigrationSelection(args).mode; }

export function verifyMigrationBytes(bytes, version = "001") {
  if (!MIGRATIONS[version] || !Buffer.isBuffer(bytes)
    || createHash("sha256").update(bytes).digest("hex") !== MIGRATIONS[version].sha256) {
    throw new Error("Reviewed migration checksum mismatch.");
  }
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
  connectionString, loadMigration = (version) => readFile(MIGRATIONS[version].url), makeDatabase = databaseFor,
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
  let version;
  let migration;
  try {
    ({ mode, version } = parseMigrationSelection(args));
    migration = MIGRATIONS[version];
    const requiredConfirmation = version === "001" ? CONFIRMATION
      : version === "002" ? BROWSER_AUTH_CONFIRMATION : FOLLOW_UP_CONFIRMATION;
    if (expectedDatabase !== DATABASE || (mode === "execute" && confirmation !== requiredConfirmation)) throw new Error("Approval or target mismatch.");
    const options = inspectionPoolOptions(connectionString, expectedHost, expectedDatabase);
    const sql = verifyMigrationBytes(await loadMigration(version), version);
    // Keep startup default read-only in BOTH modes. Only the explicit approved
    // transaction below can enable writes. URL and inherited PG* overrides cannot.
    options.application_name = `symora-migration-${version}`;
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
    if (version === "002" || version === "003") {
      stage = "base-schema verification";
      const baseline = {};
      for (const key of ["tables", "columns", "constraints", "indexes"]) baseline[key] = (await client.query(queries[key], [SCHEMA, TABLES])).rows;
      verifySchema(baseline);
    }
    if (version === "003") {
      stage = "browser-auth schema verification";
      const baseline = {};
      for (const key of ["tables", "columns", "constraints", "indexes"]) {
        baseline[key] = (await client.query(queries[key], [SCHEMA, BROWSER_AUTH_TABLES])).rows;
      }
      verifyBrowserAuthSchema(baseline);
    }
    stage = "identity/permissions/conflicts";
    const conflicts = (await client.query(metadataQueries.conflicts, [SCHEMA, migration.objects, migration.types])).rows;
    if (conflicts.length !== 0 || connectionFailed) throw new Error("Migration conflict.");
    if (mode === "execute") {
      stage = "migration";
      // Execute the very same bytes that were hashed; never reload a changed file.
      await client.query(sql);
      stage = "schema verification";
      const snapshot = {};
      const allTables = version === "001" ? TABLES
        : version === "002" ? [...TABLES, ...BROWSER_AUTH_TABLES]
          : [...TABLES, ...BROWSER_AUTH_TABLES, ...FOLLOW_UP_TABLES];
      for (const key of ["tables", "columns", "constraints", "indexes"]) snapshot[key] = (await client.query(queries[key], [SCHEMA, allTables])).rows;
      if (version === "001") verifySchema(snapshot);
      else if (version === "002") {
        const baseSnapshot = {};
        const authSnapshot = {};
        for (const key of ["tables", "columns", "constraints", "indexes"]) {
          const tableOf = key === "tables" ? (row) => row.name : (row) => row.table;
          baseSnapshot[key] = snapshot[key].filter((row) => TABLES.includes(tableOf(row)));
          authSnapshot[key] = snapshot[key].filter((row) => BROWSER_AUTH_TABLES.includes(tableOf(row)));
        }
        stage = "base schema verification";
        verifySchema(baseSnapshot);
        stage = "browser-auth schema verification";
        verifyBrowserAuthSchema(authSnapshot);
      } else {
        const baseSnapshot = {};
        const authSnapshot = {};
        const followUpSnapshot = {};
        for (const key of ["tables", "columns", "constraints", "indexes"]) {
          const tableOf = key === "tables" ? (row) => row.name : (row) => row.table;
          baseSnapshot[key] = snapshot[key].filter((row) => TABLES.includes(tableOf(row)));
          authSnapshot[key] = snapshot[key].filter((row) => BROWSER_AUTH_TABLES.includes(tableOf(row)));
          followUpSnapshot[key] = snapshot[key].filter((row) => FOLLOW_UP_TABLES.includes(tableOf(row)));
        }
        stage = "base schema verification";
        verifySchema(baseSnapshot);
        stage = "browser-auth schema verification";
        verifyBrowserAuthSchema(authSnapshot);
        stage = "participant follow-up schema verification";
        verifyFollowUpSchema(followUpSnapshot);
      }
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
    status: mode === "execute" ? `MIGRATION_${version}_COMMITTED` : `PREFLIGHT_${version}_PASSED_NO_CHANGES`,
    database_matches_expected: true, schema: SCHEMA, tls_verified: true,
    migration_sha256: migration.sha256, postgres_major: 18,
    note: mode === "execute" ? "Migration tables, constraints, and indexes verified before commit. No seed or grants performed." : "DDL has not been executed or validated on this server. Separate execution approval is required.",
  }, null, 2));
  else if (committed) logError("Migration committed, but cleanup failed. Do not rerun the migration.");
  return success;
}

export async function main() {
  const args = process.argv.slice(2);
  const { mode, version } = parseMigrationSelection(args);
  if (!process.stdin.isTTY) throw new Error("Interactive confirmation required.");
  const requiredConfirmation = version === "001" ? CONFIRMATION
    : version === "002" ? BROWSER_AUTH_CONFIRMATION : FOLLOW_UP_CONFIRMATION;
  console.log(`Symora ${version} ${mode}. Enter expected development details from TigerData's console. Never enter a password or connection string.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let expectedHost, expectedDatabase, confirmation = "";
  try {
    expectedHost = (await terminal.question("Expected development hostname: ")).trim();
    expectedDatabase = (await terminal.question("Expected database name (reviewed target: tsdb): ")).trim();
    if (mode === "execute") confirmation = await terminal.question(`Only after separate approval, type ${requiredConfirmation}: `);
  } finally { terminal.close(); }
  return runMigration({ args, expectedHost, expectedDatabase, confirmation, connectionString: process.env.DATABASE_URL });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await main()) ? 0 : 1; } catch {
    console.error("Runner stopped. Use an interactive terminal and supported arguments. No credentials are displayed.");
    process.exitCode = 1;
  }
}
