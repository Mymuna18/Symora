import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createDatabase } from "../lib/db-pool.mjs";

function setup(connectionString = " postgres://fictional-test-only ") {
  const instances = [];
  const errors = [];
  class MockPool extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.endCalls = 0;
      instances.push(this);
    }
    async end() { this.endCalls += 1; }
  }
  const dependencies = {
    Pool: MockPool,
    readConnectionString: () => connectionString,
    cache: {},
    logError: (...args) => errors.push(args),
  };
  return { db: createDatabase(dependencies), dependencies, instances, errors };
}

test("pool creation is lazy and uses bounded connection settings", () => {
  const { db, instances } = setup();
  assert.equal(instances.length, 0);
  assert.deepEqual(db.getPool().options, {
    connectionString: "postgres://fictional-test-only",
    max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
  });
});

for (const missing of [null, "", " \t\n"]) {
  test(`missing configuration fails before constructing a pool (${JSON.stringify(missing)})`, () => {
    const { db, instances } = setup(missing);
    assert.throws(() => db.getPool(), /DATABASE_URL must be configured/);
    assert.equal(instances.length, 0);
  });
}

test("module reloads reuse the cached pool without duplicate error handlers", () => {
  const { db, dependencies, instances } = setup();
  const pool = db.getPool();
  assert.equal(db.getPool(), pool);
  assert.equal(createDatabase(dependencies).getPool(), pool);
  assert.equal(instances.length, 1);
  assert.equal(pool.listenerCount("error"), 1);
});

test("idle connection errors are handled without leaking error or client details", () => {
  const { db, errors } = setup();
  const pool = db.getPool();
  assert.doesNotThrow(() => pool.emit("error", new Error("FAKE_SECRET"), { password: "FAKE_SECRET" }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].length, 1);
  assert.match(errors[0][0], /idle connection failed/);
  assert.doesNotMatch(JSON.stringify(errors), /FAKE_SECRET/);
  assert.equal(db.getPool(), pool);
});

test("closing an unused pool does not construct it", async () => {
  const { db, instances } = setup();
  await db.closePool();
  assert.equal(instances.length, 0);
});

test("closing clears the cache, is repeatable, and permits a fresh pool", async () => {
  const { db } = setup();
  const first = db.getPool();
  await db.closePool();
  await db.closePool();
  assert.equal(first.endCalls, 1);
  assert.notEqual(db.getPool(), first);
});

test("cleanup failures propagate and do not leave a closed pool cached", async () => {
  const { db } = setup();
  const first = db.getPool();
  first.end = async () => { throw new Error("cleanup failed"); };
  await assert.rejects(db.closePool(), /cleanup failed/);
  assert.notEqual(db.getPool(), first);
});

test("constructor failures do not poison the cache", () => {
  const cache = {};
  const db = createDatabase({
    Pool: class { constructor() { throw new Error("construction failed"); } },
    readConnectionString: () => "fictional",
    cache,
  });
  assert.throws(() => db.getPool(), /construction failed/);
  assert.equal(Reflect.ownKeys(cache).length, 0);
});
