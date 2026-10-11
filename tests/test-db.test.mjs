import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createDatabase } from "../lib/db-pool.mjs";
import { checkDatabase } from "../scripts/test-db.mjs";

for (const scenario of ["success", "query failure", "unexpected result", "cleanup failure", "missing configuration"]) {
  test(`connection diagnostic through the actual database module: ${scenario}`, async () => {
    const calls = [];
    const logs = [];
    class MockPool extends EventEmitter {
      async query(sql) {
        calls.push(sql);
        if (scenario === "query failure") throw new Error("FAKE_SECRET");
        return { rows: scenario === "unexpected result" ? [] : [{ connection_ok: 1 }] };
      }
      async end() {
        calls.push("end");
        if (scenario === "cleanup failure") throw new Error("FAKE_SECRET");
      }
    }
    const db = createDatabase({
      Pool: MockPool,
      cache: {},
      readConnectionString: () => scenario === "missing configuration" ? "" : "fictional-test-only",
      logError: (...args) => logs.push(args),
    });
    const passed = await checkDatabase({
      openPool: db.getPool,
      endPool: db.closePool,
      log: (...args) => logs.push(args),
      logError: (...args) => logs.push(args),
    });
    assert.equal(passed, scenario === "success");
    assert.deepEqual(calls, scenario === "missing configuration" ? [] : ["SELECT 1 AS connection_ok", "end"]);
    assert.doesNotMatch(JSON.stringify(logs), /FAKE_SECRET|fictional-test-only/);
    assert.equal(JSON.stringify(logs).includes("SUCCESS!"), passed);
  });
}
