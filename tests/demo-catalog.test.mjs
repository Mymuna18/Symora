import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CATALOG, CATALOG_SELECT, CATALOG_INSERT } from "../lib/demo-catalog.mjs";
import { runSeed, parseSeedArguments, CONFIRMATION, CATALOG_LOCK } from "../scripts/seed-demo-catalog.mjs";
import { metadataQueries } from "../scripts/inspect-tigerdata.mjs";

const execute = ["--execute", "--approve-demo-catalog"];
const seedRows = () => DEMO_CATALOG.map(({ code, displayName }) => ({ code, display_name: displayName, is_active: true }));
function setup(settings = {}) {
  const calls = [], logs = [], errors = [], releases = [];
  let rows = structuredClone(settings.rows ?? []), saved = structuredClone(rows), poolCreated = false, closed = 0, listener;
  const client = {
    connection: { stream: { encrypted: settings.tls ?? true, authorized: settings.tls ?? true } },
    on(event, callback) { listener = callback; }, removeListener() { listener = undefined; },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === settings.failAt || (settings.rollbackFails && sql === "ROLLBACK")) throw new Error("MOCK_SECRET");
      if (sql.startsWith("BEGIN")) saved = structuredClone(rows);
      if (sql === metadataQueries.identity) return { rows: [{ database: "tsdb", database_matches: true, selected_schema: "public", search_path: "public", tls: true,
        read_only: !(settings.args ?? []).includes("--execute"), can_connect: true, can_generate_uuid: true, ...settings.identity }] };
      if (sql === CATALOG_SELECT) return { rows: structuredClone(rows.filter((row) =>
        values[0].includes(row.code) || values[1].includes(row.display_name?.trim().replace(/\s+/g, " ").toLowerCase()))) };
      if (sql === CATALOG_INSERT) {
        const inserted = [];
        values[0].forEach((code, index) => {
          if (!rows.some((row) => row.code === code) && !settings.missingAfterInsert) {
            rows.push({ code, display_name: values[1][index], is_active: true }); inserted.push({ code });
          }
        });
        if (settings.clientError) listener(new Error("MOCK_SECRET"));
        return { rows: inserted };
      }
      if (sql === "ROLLBACK") rows = saved;
      return { rows: [], command: sql === "COMMIT" ? "COMMIT" : undefined };
    },
    release(destroy) { releases.push(destroy); },
  };
  const run = () => runSeed({
    args: settings.args ?? [], confirmation: settings.confirmation ?? CONFIRMATION,
    expectedHost: settings.host ?? "synthetic.invalid", expectedDatabase: settings.database ?? "tsdb",
    connectionString: "postgresql://mock:MOCK_SECRET@synthetic.invalid/tsdb?sslmode=require",
    makeDatabase: (options) => {
      poolCreated = true;
      assert.equal(options.ssl.rejectUnauthorized, true);
      assert.match(options.options, /default_transaction_read_only=on/);
      assert.match(options.options, /lock_timeout=5000/);
      return { getPool: () => ({ connect: async () => client }), closePool: async () => { closed++; } };
    },
    log: (message) => logs.push(message), logError: (message) => errors.push(message),
  });
  return { run, calls, logs, errors, releases, rows: () => rows, poolCreated: () => poolCreated, closed: () => closed };
}

test("preflight is the default; execution requires both flags", () => {
  assert.equal(parseSeedArguments([]), "preflight");
  assert.equal(parseSeedArguments(["--preflight"]), "preflight");
  assert.equal(parseSeedArguments(execute), "execute");
  for (const args of [["--execute"], ["--approve-demo-catalog"], [...execute, "extra"], ["--execute", "--execute"]]) assert.throws(() => parseSeedArguments(args));
});

for (const config of [{ args: ["--execute"] }, { args: execute, confirmation: "" }, { host: "wrong.invalid" }, { database: "wrong" }]) {
  test(`unsafe seed configuration never connects: ${JSON.stringify(config)}`, async () => {
    const state = setup(config);
    assert.equal(await state.run(), false); assert.equal(state.poolCreated(), false);
  });
}

test("preflight reports all missing codes and only executes read-only SQL", async () => {
  const state = setup();
  assert.equal(await state.run(), true);
  assert.deepEqual(state.calls.map(({ sql }) => sql), ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", metadataQueries.identity, CATALOG_SELECT, "ROLLBACK"]);
  assert.deepEqual(JSON.parse(state.logs[0]).missingCodes, ["headache", "dizziness", "stomach_pain", "nausea", "fatigue"]);
  assert.deepEqual(state.rows(), []);
});

test("empty catalog is seeded atomically with parameterized values", async () => {
  const state = setup({ args: execute });
  assert.equal(await state.run(), true);
  assert.deepEqual(state.rows(), seedRows());
  assert.equal(JSON.parse(state.logs[0]).inserted, 5);
  const insertion = state.calls.find(({ sql }) => sql === CATALOG_INSERT);
  assert.deepEqual(insertion.values, [DEMO_CATALOG.map(({ code }) => code), DEMO_CATALOG.map(({ displayName }) => displayName)]);
  assert.match(insertion.sql, /ON CONFLICT \(code\) DO NOTHING/);
  assert.ok(state.calls.findIndex(({ sql }) => sql === CATALOG_LOCK) < state.calls.findIndex(({ sql }) => sql === CATALOG_SELECT));
  assert.equal(state.calls.at(-1).sql, "COMMIT");
});

test("repeated execution adds zero records and preserves existing casing and IDs", async () => {
  const rows = seedRows().map((row) => ({ ...row, id: `existing-${row.code}`, display_name: row.display_name.toUpperCase() }));
  const state = setup({ args: execute, rows });
  assert.equal(await state.run(), true);
  assert.deepEqual(state.rows(), rows);
  assert.equal(JSON.parse(state.logs[0]).inserted, 0);
  assert.equal(state.calls.some(({ sql }) => sql === CATALOG_INSERT), false);
});

test("partially seeded catalog adds only missing rows", async () => {
  const state = setup({ args: execute, rows: seedRows().slice(0, 2) });
  assert.equal(await state.run(), true);
  assert.equal(JSON.parse(state.logs[0]).inserted, 3);
  assert.deepEqual(state.calls.find(({ sql }) => sql === CATALOG_INSERT).values[0], ["stomach_pain", "nausea", "fatigue"]);
});

test("two runs preserve unrelated existing rows and the second run inserts nothing", async () => {
  const unrelated = { id: "existing-unrelated-id", code: "cough", display_name: "Cough", is_active: false };
  const state = setup({ args: execute, rows: [unrelated] });
  assert.equal(await state.run(), true);
  assert.equal(JSON.parse(state.logs[0]).inserted, 5);
  const afterFirst = structuredClone(state.rows());
  assert.equal(await state.run(), true);
  assert.equal(JSON.parse(state.logs[1]).inserted, 0);
  assert.deepEqual(state.rows(), afterFirst);
  assert.deepEqual(state.rows()[0], unrelated);
});

for (const row of [
  { code: "headache", display_name: "Different meaning", is_active: true },
  { code: "headache", display_name: "Headache", is_active: false },
  { code: "another_code", display_name: "Headache", is_active: true },
]) {
  test(`existing conflicting catalog entry is preserved: ${JSON.stringify(row)}`, async () => {
    const state = setup({ args: execute, rows: [row] });
    assert.equal(await state.run(), false);
    assert.deepEqual(state.rows(), [row]);
    assert.equal(state.calls.some(({ sql }) => sql === CATALOG_INSERT || sql === "COMMIT"), false);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
  });
}

for (const config of [
  { failAt: CATALOG_LOCK }, { failAt: CATALOG_INSERT }, { missingAfterInsert: true }, { clientError: true },
  { identity: { database_matches: false } }, { identity: { database: "other" } },
  { identity: { selected_schema: "other" } }, { identity: { tls: false } }, { identity: { read_only: true } },
]) {
  test(`seed failure rolls back and sanitizes errors: ${JSON.stringify(config)}`, async () => {
    const state = setup({ args: execute, ...config });
    assert.equal(await state.run(), false);
    assert.deepEqual(state.rows(), []);
    assert.equal(state.calls.at(-1).sql, "ROLLBACK");
    assert.deepEqual(state.releases, [true]);
    assert.equal(state.closed(), 1);
    assert.doesNotMatch(state.errors.join(""), /MOCK_SECRET/);
  });
}

test("unverified TLS fails before any SQL", async () => {
  const state = setup({ tls: false });
  assert.equal(await state.run(), false); assert.deepEqual(state.calls, []);
});

test("commit response failure warns against blind retries", async () => {
  const state = setup({ args: execute, failAt: "COMMIT" });
  assert.equal(await state.run(), false);
  assert.match(state.errors.join(""), /outcome is unknown/);
  assert.equal(state.logs.length, 0);
});

test("failed rollback destroys the connection", async () => {
  const state = setup({ args: execute, failAt: CATALOG_INSERT, rollbackFails: true });
  assert.equal(await state.run(), false);
  assert.deepEqual(state.releases, [true]);
  assert.match(state.errors.join(""), /Rollback unconfirmed/);
});
