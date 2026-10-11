import pg from "pg";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../lib/db-pool.mjs";

const schema = "public";
const tableNames = ["participants", "reports", "symptoms", "report_symptoms", "review_history"];
const objectNames = [
  ...tableNames,
  ...tableNames.map((name) => `${name}_pkey`),
  "participants_participant_code_key", "symptoms_code_key",
  "reports_participant_submitted_idx", "reports_review_queue_idx", "reports_submitted_at_idx",
  "report_symptoms_symptom_report_idx", "review_history_report_created_idx",
];

// Explicit options prevent PG* variables, URL query overrides, password files,
// and insecure TLS modes from changing the approved connection target.
export function inspectionPoolOptions(connectionString, expectedHost, expectedDatabase) {
  const url = new URL(connectionString);
  const host = expectedHost.trim().toLowerCase();
  const database = expectedDatabase.trim();
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    || url.hostname.toLowerCase() !== host || !database || url.hash
    || decodeURIComponent(url.pathname.slice(1)) !== database
    || !url.username || !url.password) throw new Error("Invalid inspection configuration.");
  for (const [key, value] of url.searchParams) {
    if (key !== "sslmode" || !["require", "verify-full"].includes(value)) {
      throw new Error("Unsupported connection option.");
    }
  }
  return {
    host, port: Number(url.port || 5432), database,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: host },
    max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000,
    query_timeout: 15_000,
    application_name: "symora-read-only-inspection", client_encoding: "UTF8",
    // pg_catalog is implicitly searched before public; it cannot be shadowed.
    options: "-c default_transaction_read_only=on -c search_path=public -c statement_timeout=10000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000",
  };
}

// Only pg_catalog metadata is read. No dynamic SQL or application row queries.
export const metadataQueries = Object.freeze({
  identity: `SELECT current_database() AS database,
    current_database() = $1 AS database_matches,
    current_schema() AS selected_schema,
    current_setting('search_path') AS search_path,
    current_setting('transaction_read_only') = 'on' AS read_only,
    current_setting('server_version') AS server_version,
    EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) AS tls,
    has_database_privilege(current_database(), 'CONNECT') AS can_connect,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'pg_catalog' AND p.proname = 'gen_random_uuid' AND p.pronargs = 0
      AND has_function_privilege(p.oid, 'EXECUTE')) AS can_generate_uuid`,
  schemas: `SELECT nspname AS schema,
    has_schema_privilege(oid, 'USAGE') AS can_use,
    has_schema_privilege(oid, 'CREATE') AS can_create
    FROM pg_catalog.pg_namespace
    WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
    ORDER BY nspname LIMIT 1001`,
  objects: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    c.relrowsecurity AS row_security,
    CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(c.oid, 'SELECT') END AS can_select,
    CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(c.oid, 'INSERT') END AS can_insert,
    CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(c.oid, 'UPDATE') END AS can_update,
    CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(c.oid, 'DELETE') END AS can_delete
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, c.relname LIMIT 1001`,
  conflicts: `SELECT 'relation' AS kind, c.relname AS name
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[])
    UNION ALL
    SELECT 'type' AS kind, t.typname AS name
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = $1 AND t.typname = ANY($3::text[])
    ORDER BY kind, name`,
  columns: `SELECT c.relname AS table_name, a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum LIMIT 1001`,
  constraints: `SELECT c.relname AS table_name, k.conname AS name, k.contype AS kind,
    k.convalidated AS validated
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = ANY($2::text[])
    ORDER BY c.relname, k.conname LIMIT 1001`,
});

// Extension membership is determined by PostgreSQL dependencies, not names.
// Internal/automatic children (such as extension-table indexes) are excluded too.
// The separate migration-conflict query intentionally remains unfiltered.
export const conciseQueries = Object.freeze({
  schemas: `SELECT nspname AS schema,
    has_schema_privilege(oid, 'USAGE') AS can_use,
    has_schema_privilege(oid, 'CREATE') AS can_create
    FROM pg_catalog.pg_namespace WHERE nspname = $1`,
  objects: `WITH RECURSIVE extension_members(classid, objid) AS (
    SELECT d.classid, d.objid FROM pg_catalog.pg_depend d
    WHERE d.refclassid = 'pg_catalog.pg_extension'::regclass AND d.deptype = 'e'
    UNION
    SELECT d.classid, d.objid FROM pg_catalog.pg_depend d
    JOIN extension_members e ON e.classid = d.refclassid AND e.objid = d.refobjid
    WHERE d.deptype IN ('a', 'i')
  )
    SELECT c.relname AS name, c.relkind AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f','S','i','I')
      AND NOT EXISTS (SELECT 1 FROM extension_members e
        WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid)
    ORDER BY c.relkind, c.relname LIMIT 1001`,
});

export function parseInspectionArguments(args) {
  if (args.length === 0) return { concise: false };
  if (args.length === 1 && args[0] === "--concise") return { concise: true };
  throw new Error("Only the optional --concise flag is supported.");
}

function conciseReport(report) {
  const publicSchema = report.schemas.find((entry) => entry.schema === schema);
  const kinds = { r: "table", p: "partitioned table", v: "view", m: "materialized view", f: "foreign table", S: "sequence", i: "index", I: "partitioned index" };
  return {
    status: report.status,
    identity: {
      database_matches_expected: report.identity.database_matches,
      selected_schema: report.identity.selected_schema,
      read_only: report.identity.read_only,
      server_version: report.identity.server_version,
    },
    tls: { encrypted: report.identity.tls, certificate_verified: true },
    public_schema: {
      exists: Boolean(publicSchema),
      can_use: publicSchema?.can_use ?? false,
      can_create: publicSchema?.can_create ?? false,
      can_connect_database: report.identity.can_connect,
      can_generate_uuid: report.identity.can_generate_uuid,
    },
    objects: report.objects.slice(0, 1000).map(({ name, kind }) => ({ name, kind: kinds[kind] ?? kind })),
    objects_truncated: report.objects.length > 1000,
    conflicts: report.conflicts.map(({ name, kind }) => ({ name, kind })),
    blockers: report.blockers,
    note: "Public relations only; extension-owned objects are hidden, but conflicts include them. No database changes were made.",
  };
}

export async function inspectMetadata({ openPool, closePool, expectedDatabase, concise = false, log = console.log, logError = console.error }) {
  let client;
  let began = false;
  let succeeded = false;
  let report;
  let stage = "connection/TLS";
  try {
    client = await openPool().connect();
    // Check the authenticated TLS socket before issuing any SQL.
    if (!client.connection?.stream?.encrypted || client.connection.stream.authorized !== true) {
      throw new Error("TLS verification failed.");
    }
    stage = "read-only transaction";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    stage = "database identity";
    const identity = (await client.query(metadataQueries.identity, [expectedDatabase])).rows[0];
    if (!identity?.database_matches || identity.database !== expectedDatabase || !identity.read_only || !identity.tls) {
      throw new Error("Identity or read-only verification failed.");
    }
    stage = "metadata";
    const schemas = (await client.query(concise ? conciseQueries.schemas : metadataQueries.schemas, concise ? [schema] : undefined)).rows;
    const objects = (await client.query(concise ? conciseQueries.objects : metadataQueries.objects, concise ? [schema] : undefined)).rows;
    const conflicts = (await client.query(metadataQueries.conflicts, [schema, objectNames, [...tableNames, ...tableNames.map((name) => `_${name}`)]])).rows;
    const columns = concise ? [] : (await client.query(metadataQueries.columns, [schema, tableNames])).rows;
    const constraints = concise ? [] : (await client.query(metadataQueries.constraints, [schema, tableNames])).rows;
    const target = schemas.find((entry) => entry.schema === schema);
    const blockers = [];
    if (identity.selected_schema !== schema || !target?.can_use) blockers.push("Target public schema is absent or unavailable.");
    if (!identity.can_connect || !target?.can_create) blockers.push("Connecting role lacks required database/schema privileges.");
    if (!identity.can_generate_uuid) blockers.push("Built-in UUID generation is unavailable to this role.");
    if (conflicts.length) blockers.push("Migration object names already exist; do not apply the initial migration.");
    if ([schemas, objects, columns, constraints].some((rows) => rows.length > 1000)) blockers.push("Metadata inventory exceeded its limit; manual review is required.");
    report = {
      status: blockers.length ? "BLOCKED" : "READY_FOR_MIGRATION_PLAN_REVIEW_ONLY",
      identity, schemas, objects, conflicts, columns, constraints, blockers,
      note: "No migration or seed was executed. Team review and separate write approval are still required.",
    };
    succeeded = true;
  } catch {
    // Never log driver errors: they can contain SQL, credentials, or URL values.
    logError(`Inspection failed during ${stage}. No readiness claim; no migration or seed was attempted.`);
  } finally {
    if (client) {
      let destroy = !succeeded;
      if (began) {
        try { await client.query("ROLLBACK"); } catch {
          succeeded = false; destroy = true;
          logError("Inspection rollback failed; the connection will be discarded.");
        }
      }
      try { client.release(destroy); } catch { succeeded = false; logError("Inspection connection cleanup failed."); }
    }
    try { await closePool(); } catch { succeeded = false; logError("Inspection pool cleanup failed."); }
  }
  // Only report readiness after transaction and connection cleanup succeeded.
  if (succeeded) log(JSON.stringify(concise ? conciseReport(report) : report, null, 2));
  return succeeded && report.blockers.length === 0;
}

export async function main() {
  let mode;
  try { mode = parseInspectionArguments(process.argv.slice(2)); } catch {
    console.error("Only the optional --concise flag is supported. Never pass credentials as arguments.");
    return false;
  }
  if (!process.stdin.isTTY) {
    console.error("Run interactively, optionally with --concise. Do not pass credentials on the command line.");
    return false;
  }
  console.log("Read-only Symora inspection. Enter expected service details from the TigerData console, not your connection string. Never enter a password.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let expectedHost;
  let expectedDatabase;
  try {
    expectedHost = (await terminal.question("Expected development service hostname (hostname only): ")).trim();
    expectedDatabase = (await terminal.question("Expected development database name: ")).trim();
  } finally { terminal.close(); }
  let options;
  try {
    options = inspectionPoolOptions(process.env.DATABASE_URL, expectedHost, expectedDatabase);
  } catch {
    console.error("Configuration check failed before connecting. Check DATABASE_URL availability, expected hostname/database, and supported TLS options privately. No connection details are printed.");
    return false;
  }
  // Reuse existing lazy connection infrastructure with a private cache and a
  // constrained pool constructor. No environment-file loader exists here.
  let idleFailed = false;
  const database = createDatabase({
    Pool: class extends pg.Pool { constructor() { super(options); } },
    readConnectionString: () => "inspection-options-already-validated",
    cache: {},
    logError: () => { idleFailed = true; console.error("Inspection idle connection failed."); },
  });
  const success = await inspectMetadata({ openPool: database.getPool, closePool: database.closePool, expectedDatabase, ...mode });
  return success && !idleFailed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await main()) ? 0 : 1; } catch {
    console.error("Inspection stopped. No migration or seed was attempted.");
    process.exitCode = 1;
  }
}
