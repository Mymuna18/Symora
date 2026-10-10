import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runMigration, parseMigrationArguments, verifyMigrationBytes, queries, CONFIRMATION } from "../scripts/migrate-tigerdata.mjs";
import { metadataQueries } from "../scripts/inspect-tigerdata.mjs";
import { columns, checks, keys, foreignKeys, indexes, TABLES, checkTree, verifySchema } from "../lib/migration-contract.mjs";

const migration = readFileSync(new URL("../db/migrations/001_initial_schema.sql", import.meta.url));
const secret = "MOCK_SECRET_NEVER_LOG";
const expectedHost = "synthetic.example.invalid";
const execute = ["--execute", "--approve-migration=001"];

function snapshot18() {
  const base = { validated: true, enforced: true, deferrable: false, deferred: false };
  return {
    tables: TABLES.map((name) => ({ name, schema: "public", kind: "r", persistence: "p", owned: true, row_security: false })),
    columns: Object.entries(columns).flatMap(([table, entries]) => entries.map(([name, type, not_null, default_expression]) => ({ table, name, type, not_null, default_expression }))),
    constraints: [
      ...keys.map((key) => ({ ...base, ...key })),
      ...foreignKeys.map((key) => ({ ...base, ...key, target_schema: "public", target_columns: ["id"], update: "a", match: "s" })),
      ...Object.entries(checks).flatMap(([table, entries]) => Object.entries(entries).map(([name, expression]) => ({ ...base, table, name, expression, kind: "c" }))),
      ...Object.entries(columns).flatMap(([table, entries]) => entries.filter((entry) => entry[2]).map(([name]) => ({ ...base, table, name: `${table}_${name}_not_null`, kind: "n", columns: [name] }))),
    ],
    indexes: indexes.map((index) => ({ ...index, schema: "public", nulls_first: index.descending, method: "btree", valid: true, ready: true, partial: false, expression: false, included: false })),
  };
}

function setup(settings = {}) {
  const calls = [], logs = [], errors = [], released = [], options = [];
  let opened = 0, closed = 0;
  let clientErrorListener;
  const snapshot = snapshot18();
  settings.mutate?.(snapshot);
  const client = {
    on(event, listener) { assert.equal(event, "error"); clientErrorListener = listener; },
    removeListener(event, listener) { assert.equal(event, "error"); assert.equal(listener, clientErrorListener); clientErrorListener = undefined; },
    connection: { stream: { encrypted: settings.tls ?? true, authorized: settings.authorized ?? true } },
    async query(sql, values) {
      calls.push({ sql, values });
      if (settings.clientError && sql === queries.indexes) clientErrorListener(new Error(secret));
      if (sql === settings.failAt || (settings.rollbackFails && sql === "ROLLBACK")) throw new Error(secret);
      if (sql === metadataQueries.identity) return { rows: [{
        database: "tsdb", database_matches: true, selected_schema: "public", search_path: "public", tls: true,
        read_only: !(settings.args ?? []).includes("--execute"), can_connect: true, can_generate_uuid: true, ...settings.identity,
      }] };
      if (sql === queries.permissions) return { rows: [{ can_use: true, can_create: true, version: 180006, external_default_grants: false, ...settings.permissions }] };
      if (sql === queries.lock) return { rows: [{ locked: settings.locked ?? true }] };
      if (sql === metadataQueries.conflicts) return { rows: settings.conflicts ?? [] };
      for (const key of ["tables", "columns", "constraints", "indexes"]) if (sql === queries[key]) return { rows: snapshot[key] };
      if (sql === "COMMIT") return { command: settings.commitCommand ?? "COMMIT", rows: [] };
      return { rows: [] };
    },
    release(destroy) { released.push(destroy); if (settings.releaseFails) throw new Error(secret); },
  };
  const run = () => runMigration({
    args: settings.args ?? [], confirmation: settings.confirmation ?? CONFIRMATION,
    expectedHost: settings.expectedHost ?? expectedHost, expectedDatabase: settings.expectedDatabase ?? "tsdb",
    connectionString: settings.connectionString ?? `postgresql://mock:${secret}@${expectedHost}:5432/tsdb?sslmode=require`,
    loadMigration: async () => settings.bytes ?? migration,
    makeDatabase: (config, onError) => {
      options.push(config);
      return {
        getPool: () => ({ connect: async () => { opened++; if (settings.failAt === "connect") throw new Error(secret); if (settings.idleError) onError(); return client; } }),
        closePool: async () => { closed++; if (settings.closeFails) throw new Error(secret); },
      };
    },
    log: (message) => logs.push(message), logError: (message) => errors.push(message),
  });
  return { run, calls, logs, errors, released, options, opened: () => opened, closed: () => closed };
}

test("reviewed migration bytes pass the pinned checksum; every byte matters", () => {
  assert.equal(verifyMigrationBytes(migration), migration.toString("utf8"));
  assert.throws(() => verifyMigrationBytes(Buffer.concat([migration, Buffer.from("\n")])));
  assert.throws(() => verifyMigrationBytes(migration.toString("utf8")));
});

test("verification manifest matches all explicit index definitions in the reviewed file", () => {
  const definitions = [...migration.toString("utf8").matchAll(/CREATE INDEX (\w+)\s+ON (\w+) \(([^;]+)\);/g)];
  assert.equal(definitions.length, 5);
  for (const [, name, table, definition] of definitions) {
    const parts = definition.split(",").map((part) => part.trim().split(/\s+/));
    const manifest = indexes.find((index) => index.name === name);
    assert.equal(manifest.table, table);
    assert.deepEqual(manifest.columns, parts.map(([column]) => column));
    assert.deepEqual(manifest.descending, parts.map(([, direction]) => direction === "DESC"));
  }
});

test("execution requires exactly both approval flags; default is preflight", () => {
  assert.equal(parseMigrationArguments([]), "preflight");
  assert.equal(parseMigrationArguments(["--preflight"]), "preflight");
  assert.equal(parseMigrationArguments(execute), "execute");
  for (const args of [["--execute"], ["--approve-migration=001"], [...execute, "--preflight"], ["--execute", "--execute"], ["postgres://secret"], ["--execute", "--approve-migration=002"]]) assert.throws(() => parseMigrationArguments(args));
});

test("default preflight runs metadata only, then rollback; no DDL, lock, or commit", async () => {
  const state = setup();
  assert.equal(await state.run(), true);
  assert.deepEqual(state.calls.map(({ sql }) => sql), [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", metadataQueries.identity,
    queries.permissions, metadataQueries.conflicts, "ROLLBACK",
  ]);
  assert.equal(JSON.parse(state.logs[0]).status, "PREFLIGHT_PASSED_NO_CHANGES");
  assert.equal(state.closed(), 1);
  assert.deepEqual(state.released, [false]);
});

for (const config of [
  { args: ["--execute"] }, { args: execute, confirmation: "" }, { args: execute, confirmation: "approve" },
  { expectedDatabase: "another_database" }, { expectedHost: "different.example.invalid" },
  { connectionString: "not a connection string" }, { bytes: Buffer.from("CREATE TABLE wrong (id int);") },
]) {
  test(`unsafe configuration stops before connecting: ${Object.keys(config).join(",")}`, async () => {
    const state = setup(config);
    assert.equal(await state.run(), false);
    assert.equal(state.opened(), 0);
    assert.equal(state.options.length, 0);
    assert.deepEqual(state.calls, []);
    assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
  });
}

test("approved execution checks conflicts immediately before the immutable SQL and verifies before commit", async () => {
  const state = setup({ args: execute });
  assert.equal(await state.run(), true);
  assert.deepEqual(state.calls.map(({ sql }) => sql), [
    "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE", queries.lock, metadataQueries.identity,
    queries.permissions, metadataQueries.conflicts, migration.toString("utf8"),
    queries.tables, queries.columns, queries.constraints, queries.indexes, "COMMIT",
  ]);
  const options = state.options[0];
  assert.equal(options.host, expectedHost);
  assert.equal(options.database, "tsdb");
  assert.equal(options.max, 1);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.match(options.options, /default_transaction_read_only=on/);
  assert.match(options.options, /search_path=public /);
  assert.match(options.options, /lock_timeout=5000/);
  assert.match(options.options, /statement_timeout=30000/);
  assert.equal(JSON.parse(state.logs[0]).status, "MIGRATION_001_COMMITTED");
  assert.doesNotMatch(state.logs.join(""), new RegExp(secret));
});

for (const config of [
  { identity: { database: "wrong" } }, { identity: { database_matches: false } },
  { identity: { selected_schema: "another" } }, { identity: { search_path: "other, public" } },
  { identity: { read_only: true } }, { identity: { tls: false } },
  { identity: { can_connect: false } }, { identity: { can_generate_uuid: false } },
  { permissions: { can_use: false } }, { permissions: { can_create: false } },
  { permissions: { version: 170006 } }, { permissions: { external_default_grants: true } },
  { conflicts: [{ name: "reports", kind: "relation" }] }, { conflicts: [{ name: "reports_pkey", kind: "relation" }] },
  { conflicts: [{ name: "participants", kind: "type" }] }, { locked: false }, { idleError: true },
]) {
  test(`pre-migration guard rolls back without DDL: ${JSON.stringify(config)}`, async () => {
    const state = setup({ ...config, args: execute });
    assert.equal(await state.run(), false);
    assert.ok(!state.calls.some(({ sql }) => sql === migration.toString("utf8") || sql === "COMMIT"));
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
    assert.deepEqual(state.released, [true]);
  });
}

for (const config of [{ tls: false }, { authorized: false }]) {
  test(`TLS transport fails before SQL: ${JSON.stringify(config)}`, async () => {
    const state = setup({ ...config, args: execute });
    assert.equal(await state.run(), false);
    assert.deepEqual(state.calls, []);
  });
}

test("schema verifier accepts PostgreSQL 18 NOT NULL records and PostgreSQL 17-style snapshots", () => {
  const snapshot = snapshot18();
  verifySchema(snapshot);
  snapshot.constraints = snapshot.constraints.filter((row) => row.kind !== "n");
  verifySchema(snapshot);
  assert.match(queries.constraints, /to_jsonb\(k\)->>'conenforced'/);
});

for (const [label, mutate] of [
  ["missing table", (s) => s.tables.pop()],
  ["wrong table schema", (s) => { s.tables[0].schema = "elsewhere"; }],
  ["wrong owner", (s) => { s.tables[0].owned = false; }],
  ["missing column", (s) => s.columns.pop()],
  ["nullable participant id", (s) => { s.columns.find((c) => c.table === "reports" && c.name === "participant_id").not_null = false; }],
  ["wrong default", (s) => { s.columns[0].default_expression = "uuidv7()"; }],
  ["missing constraint", (s) => s.constraints.splice(0, 1)],
  ["disabled check", (s) => { s.constraints.find((c) => c.kind === "c").enforced = false; }],
  ["unvalidated constraint", (s) => { s.constraints[0].validated = false; }],
  ["deferrable key", (s) => { s.constraints[0].deferrable = true; }],
  ["wrong delete action", (s) => { s.constraints.find((c) => c.kind === "f").deletion = "c"; }],
  ["wrong FK target", (s) => { s.constraints.find((c) => c.kind === "f").target_schema = "another"; }],
  ["wrong key columns", (s) => { s.constraints[0].columns = ["participant_code"]; }],
  ["weakened transcript check", (s) => { s.constraints.find((c) => c.name === "reports_submission_complete").expression = "workflow_status = 'draft' OR submitted_at IS NOT NULL"; }],
  ["weakened intensity check", (s) => { s.constraints.find((c) => c.name === "report_symptoms_reported_intensity_check").expression = "reported_intensity IS NULL OR reported_intensity BETWEEN 0 AND 11"; }],
  ["wrong NOT NULL column", (s) => { s.constraints.find((c) => c.kind === "n").columns = ["absent"]; }],
  ["missing index", (s) => s.indexes.pop()],
  ["invalid index", (s) => { s.indexes[0].valid = false; }],
  ["partial index", (s) => { s.indexes[0].partial = true; }],
  ["wrong index ordering", (s) => { s.indexes[0].descending = [true]; }],
  ["nonunique primary index", (s) => { s.indexes[0].unique = false; }],
]) {
  test(`post-DDL verification rolls back on ${label}`, async () => {
    const state = setup({ args: execute, mutate });
    assert.equal(await state.run(), false);
    assert.ok(state.calls.some(({ sql }) => sql === migration.toString("utf8")));
    assert.ok(!state.calls.some(({ sql }) => sql === "COMMIT"));
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  });
}

test("CHECK parser accounts for PostgreSQL casts/ANY/BETWEEN without losing grouping", () => {
  assert.deepEqual(checkTree("status IN ('active','withdrawn')"), checkTree("(status = ANY (ARRAY['active'::text, 'withdrawn'::text]))"));
  assert.deepEqual(checkTree("reported_intensity IS NULL OR reported_intensity BETWEEN 0 AND 10"), checkTree("((reported_intensity IS NULL) OR ((reported_intensity >= 0) AND (reported_intensity <= 10)))"));
  assert.notDeepEqual(checkTree("a = 1 AND (b = 2 OR c = 3)"), checkTree("(a = 1 AND b = 2) OR c = 3"));
  assert.throws(() => checkTree("status IN ('active') OR true; DROP TABLE reports"));
  assert.throws(() => checkTree("status::integer = 1"));
});

for (const failAt of ["connect", "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE", queries.lock, metadataQueries.identity, queries.permissions, metadataQueries.conflicts, migration.toString("utf8"), queries.tables, queries.columns, queries.constraints, queries.indexes]) {
  test(`driver failure at step ${failAt.slice(0, 45)} is sanitized and never commits`, async () => {
    const state = setup({ args: execute, failAt });
    assert.equal(await state.run(), false);
    assert.equal(state.closed(), 1);
    assert.equal(state.logs.length, 0);
    assert.ok(!state.calls.some(({ sql }) => sql === "COMMIT"));
    assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
  });
}

test("rollback failure discards the client and suppresses success", async () => {
  const state = setup({ args: execute, failAt: migration.toString("utf8"), rollbackFails: true });
  assert.equal(await state.run(), false);
  assert.deepEqual(state.released, [true]);
  assert.match(state.errors.join(""), /Rollback could not be confirmed/);
});

test("checked-out client error is consumed without exposing driver details or committing", async () => {
  const state = setup({ args: execute, clientError: true });
  assert.equal(await state.run(), false);
  assert.ok(!state.calls.some(({ sql }) => sql === "COMMIT"));
  assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
});

for (const config of [{ failAt: "COMMIT" }, { commitCommand: "ROLLBACK" }]) {
  test(`uncertain commit is not reported as a successful rollback: ${JSON.stringify(config)}`, async () => {
    const state = setup({ args: execute, ...config });
    assert.equal(await state.run(), false);
    assert.match(state.errors.join(""), /Commit outcome is unknown/);
    assert.equal(state.logs.length, 0);
    assert.equal(state.calls.filter(({ sql }) => sql === "COMMIT").length, 1);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  });
}

for (const config of [{ closeFails: true }, { releaseFails: true }]) {
  test("confirmed commit followed by cleanup failure is never described as rolled back", async () => {
    const state = setup({ args: execute, ...config });
    assert.equal(await state.run(), false);
    assert.match(state.errors.join(""), /Migration committed, but cleanup failed/);
    assert.equal(state.logs.length, 0);
  });
}
