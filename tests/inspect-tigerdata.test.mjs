import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMetadata, inspectionPoolOptions, metadataQueries, conciseQueries, parseInspectionArguments } from "../scripts/inspect-tigerdata.mjs";

const secret = "FICTIONAL_PASSWORD_ONLY";
const host = "synthetic.example.invalid";
const dbName = "synthetic_dev";
const url = `postgresql://fictional_user:${secret}@${host}:5433/${dbName}?sslmode=require`;

test("connection target and certificate verification are explicit and isolated from URL overrides", () => {
  const options = inspectionPoolOptions(url, host, dbName);
  assert.equal(options.host, host);
  assert.equal(options.database, dbName);
  assert.equal(options.port, 5433);
  assert.equal(options.user, "fictional_user");
  assert.equal(options.password, secret);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, servername: host });
  assert.equal(options.max, 1);
  assert.equal(options.connectionString, undefined);
  assert.match(options.options, /default_transaction_read_only=on/);
  assert.match(options.options, /search_path=public /);
  assert.match(options.options, /statement_timeout=10000/);
  assert.match(options.options, /lock_timeout=2000/);
});

for (const [label, configured, expectedHost, expectedDatabase] of [
  ["missing configuration", undefined, host, dbName],
  ["wrong host", url, "different.example.invalid", dbName],
  ["wrong database", url, host, "another_database"],
  ["empty expected database", url, host, ""],
  ["connection string in hostname prompt", url, url, dbName],
  ["missing password", `postgresql://fictional_user@${host}/${dbName}`, host, dbName],
  ["missing username", `postgresql://:${secret}@${host}/${dbName}`, host, dbName],
  ["wrong protocol", url.replace("postgresql:", "https:"), host, dbName],
  ["disabled TLS", url.replace("sslmode=require", "sslmode=disable"), host, dbName],
  ["unverified TLS", url.replace("sslmode=require", "sslmode=no-verify"), host, dbName],
  ["host query override", `${url}&host=other.invalid`, host, dbName],
  ["database query override", `${url}&database=another`, host, dbName],
  ["startup option override", `${url}&options=-c%20role=another`, host, dbName],
  ["certificate file read", `${url}&sslrootcert=/unapproved/file`, host, dbName],
  ["TLS compatibility override", `${url}&uselibpqcompat=true`, host, dbName],
]) {
  test(`configuration rejects ${label} before pool construction`, () => {
    assert.throws(() => inspectionPoolOptions(configured, expectedHost, expectedDatabase));
  });
}

function setup({ identity = {}, schemas, objects = [], conflicts = [], failAt, tls = true, rollbackFailure = false, closeFailure = false, releaseFailure = false, concise = false } = {}) {
  const calls = [];
  const logs = [];
  const errors = [];
  const releases = [];
  let closed = 0;
  const client = {
    connection: { stream: { encrypted: tls, authorized: tls } },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === failAt || (rollbackFailure && sql === "ROLLBACK")) throw new Error(secret);
      if (sql === metadataQueries.identity) return { rows: [{
        database: dbName, database_matches: true, selected_schema: "public", search_path: "public",
        read_only: true, server_version: "17", tls: true, can_connect: true, can_generate_uuid: true, ...identity,
      }] };
      if (sql === metadataQueries.schemas || sql === conciseQueries.schemas) return { rows: schemas ?? [{ schema: "public", can_use: true, can_create: true }] };
      if (sql === metadataQueries.objects || sql === conciseQueries.objects) return { rows: objects };
      if (sql === metadataQueries.conflicts) return { rows: conflicts };
      return { rows: [] };
    },
    release(destroy) { releases.push(destroy); if (releaseFailure) throw new Error(secret); },
  };
  const run = () => inspectMetadata({
    openPool: () => ({ connect: async () => { if (failAt === "connect") throw new Error(secret); return client; } }),
    closePool: async () => { closed++; if (closeFailure) throw new Error(secret); },
    expectedDatabase: dbName, concise, log: (message) => logs.push(message), logError: (message) => errors.push(message),
  });
  return { run, calls, logs, errors, releases, closed: () => closed };
}

test("success uses one read-only transaction, parameterized identity, metadata only, and rollback", async () => {
  const state = setup();
  assert.equal(await state.run(), true);
  assert.deepEqual(state.calls.map(({ sql }) => sql), [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", ...Object.values(metadataQueries), "ROLLBACK",
  ]);
  assert.deepEqual(state.calls[1].values, [dbName]);
  assert.equal(state.closed(), 1);
  assert.deepEqual(state.releases, [false]);
  const report = JSON.parse(state.logs[0]);
  assert.equal(report.status, "READY_FOR_MIGRATION_PLAN_REVIEW_ONLY");
  assert.deepEqual(report.blockers, []);
  assert.doesNotMatch(state.logs.join(""), new RegExp(secret));
});

test("every data query reads only system catalogs and never application contents", () => {
  for (const sql of Object.values(metadataQueries)) {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT|COPY)\s+(?:INTO|FROM|TABLE|SCHEMA|ROLE|DATABASE)\b/i);
    for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)) assert.match(match[1], /^pg_catalog\./);
  }
});

for (const identity of [
  { database: "wrong_database" }, { database_matches: false }, { read_only: false }, { tls: false },
]) {
  test(`identity guard stops metadata inspection on ${JSON.stringify(identity)}`, async () => {
    const state = setup({ identity });
    assert.equal(await state.run(), false);
    assert.equal(state.calls.length, 3);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
    assert.equal(state.logs.length, 0);
    assert.deepEqual(state.releases, [true]);
  });
}

test("unverified transport is rejected before any SQL", async () => {
  const state = setup({ tls: false });
  assert.equal(await state.run(), false);
  assert.deepEqual(state.calls, []);
  assert.equal(state.closed(), 1);
});

for (const [label, config] of [
  ["relation conflict", { conflicts: [{ kind: "relation", name: "reports" }] }],
  ["type conflict", { conflicts: [{ kind: "type", name: "participants" }] }],
  ["missing schema", { schemas: [] }],
  ["wrong selected schema", { identity: { selected_schema: "another" } }],
  ["missing create permission", { schemas: [{ schema: "public", can_use: true, can_create: false }] }],
  ["missing schema usage", { schemas: [{ schema: "public", can_use: false, can_create: true }] }],
  ["missing UUID permission", { identity: { can_generate_uuid: false } }],
  ["missing connect permission", { identity: { can_connect: false } }],
  ["truncated inventory", { objects: Array.from({ length: 1001 }, () => ({ name: "synthetic" })) }],
]) {
  test(`readiness is blocked by ${label}`, async () => {
    const state = setup(config);
    assert.equal(await state.run(), false);
    assert.equal(JSON.parse(state.logs[0]).status, "BLOCKED");
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  });
}

for (const failAt of ["connect", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", ...Object.values(metadataQueries)]) {
  test(`failure is sanitized and cleaned up at ${failAt.split("\n")[0]}`, async () => {
    const state = setup({ failAt });
    assert.equal(await state.run(), false);
    assert.equal(state.closed(), 1);
    assert.equal(state.logs.length, 0);
    assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
    if (Object.values(metadataQueries).includes(failAt)) assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  });
}

for (const option of ["rollbackFailure", "closeFailure", "releaseFailure"]) {
  test(`${option} suppresses readiness and does not leak errors`, async () => {
    const state = setup({ [option]: true });
    assert.equal(await state.run(), false);
    assert.equal(state.logs.length, 0);
    assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
    if (option === "rollbackFailure") assert.deepEqual(state.releases, [true]);
  });
}

test("CLI keeps detailed output as default and accepts only --concise", () => {
  assert.deepEqual(parseInspectionArguments([]), { concise: false });
  assert.deepEqual(parseInspectionArguments(["--concise"]), { concise: true });
  for (const args of [["--concise", "--concise"], ["--unknown"], [url], ["--concise", url]]) {
    assert.throws(() => parseInspectionArguments(args), (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    });
  }
});

test("concise inspection queries only public inventory and keeps complete conflict checks", async () => {
  const state = setup({ concise: true, objects: [{ name: "user_view", kind: "v" }] });
  assert.equal(await state.run(), true);
  assert.deepEqual(state.calls.map(({ sql }) => sql), [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", metadataQueries.identity,
    conciseQueries.schemas, conciseQueries.objects, metadataQueries.conflicts, "ROLLBACK",
  ]);
  assert.deepEqual(state.calls[2].values, ["public"]);
  assert.deepEqual(state.calls[3].values, ["public"]);
  assert.ok(state.calls[4].values[1].includes("reports_review_queue_idx"));
  assert.ok(state.calls[4].values[1].includes("participants_pkey"));
  assert.ok(state.calls[4].values[2].includes("_reports"));
  assert.deepEqual(JSON.parse(state.logs[0]).objects, [{ name: "user_view", kind: "view" }]);
});

test("concise output includes verified identity, TLS, permissions and readiness without connection identifiers", async () => {
  const state = setup({ concise: true,
    identity: { extra: secret }, objects: [{ name: "user_table", kind: "r", extra: secret }],
  });
  assert.equal(await state.run(), true);
  const report = JSON.parse(state.logs[0]);
  assert.deepEqual(report.identity, {
    database_matches_expected: true, selected_schema: "public", read_only: true, server_version: "17",
  });
  assert.deepEqual(report.tls, { encrypted: true, certificate_verified: true });
  assert.deepEqual(report.public_schema, {
    exists: true, can_use: true, can_create: true, can_connect_database: true, can_generate_uuid: true,
  });
  assert.equal(report.status, "READY_FOR_MIGRATION_PLAN_REVIEW_ONLY");
  for (const value of [secret, dbName, host, "fictional_user", "connectionString"]) assert.ok(!state.logs[0].includes(value));
  assert.equal(report.columns, undefined);
  assert.equal(report.constraints, undefined);
  assert.equal(report.objects_truncated, false);
});

test("extension/system filtering applies to display inventory but cannot hide migration conflicts", async () => {
  // Simulate an extension-owned reports object omitted by the inventory query.
  const state = setup({ concise: true, objects: [], conflicts: [{ kind: "relation", name: "reports" }] });
  assert.equal(await state.run(), false);
  const report = JSON.parse(state.logs[0]);
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.objects, []);
  assert.deepEqual(report.conflicts, [{ name: "reports", kind: "relation" }]);
  assert.match(conciseQueries.objects, /n\.nspname = \$1/);
  assert.match(conciseQueries.objects, /pg_catalog\.pg_extension/);
  assert.match(conciseQueries.objects, /d\.deptype = 'e'/);
  assert.match(conciseQueries.objects, /d\.deptype IN \('a', 'i'\)/);
  assert.match(conciseQueries.objects, /NOT EXISTS/);
  assert.doesNotMatch(metadataQueries.conflicts, /extension_members/);
});

test("concise queries are read-only system-catalog queries with a metadata-only recursive CTE", () => {
  for (const sql of Object.values(conciseQueries)) {
    assert.match(sql, /^(SELECT|WITH RECURSIVE) /);
    assert.doesNotMatch(sql, /(?:^|;)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT|COPY|GRANT|REVOKE)\b/i);
    for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)) {
      assert.ok(match[1].startsWith("pg_catalog.") || match[1] === "extension_members");
    }
  }
});

for (const config of [
  { schemas: [] }, { schemas: [{ schema: "public", can_use: true, can_create: false }] },
  { identity: { can_generate_uuid: false } }, { identity: { selected_schema: "another" } },
]) {
  test(`concise mode retains permission/schema blockers ${JSON.stringify(config)}`, async () => {
    const state = setup({ concise: true, ...config });
    assert.equal(await state.run(), false);
    assert.equal(JSON.parse(state.logs[0]).status, "BLOCKED");
  });
}

test("concise inventory cannot report readiness when its user-object limit is exceeded", async () => {
  const state = setup({ concise: true, objects: Array.from({ length: 1001 }, (_, i) => ({ name: `table_${i}`, kind: "r" })) });
  assert.equal(await state.run(), false);
  const report = JSON.parse(state.logs[0]);
  assert.equal(report.objects.length, 1000);
  assert.equal(report.objects_truncated, true);
  assert.equal(report.status, "BLOCKED");
});

for (const config of [
  { failAt: conciseQueries.schemas }, { failAt: conciseQueries.objects }, { rollbackFailure: true },
  { identity: { database_matches: false } }, { tls: false },
]) {
  test(`concise mode suppresses readiness on failure ${Object.keys(config)[0]}`, async () => {
    const state = setup({ concise: true, ...config });
    assert.equal(await state.run(), false);
    assert.equal(state.logs.length, 0);
    assert.doesNotMatch(state.errors.join(""), new RegExp(secret));
    assert.equal(state.closed(), 1);
  });
}
