import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserAuthStore, consumeRateLimitSql } from "../lib/browser-auth-store.mjs";

function mockPool({ rows = [{ attempts: 1, expires_at: new Date("2026-10-11T12:01:00.000Z") }], failAt } = {}) {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failAt && sql.includes(failAt)) throw new Error("synthetic database error");
      return { rows };
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (failAt && sql.includes(failAt)) throw new Error("synthetic database error");
          return { rows: [], command: sql };
        },
        release(destroy) { calls.push({ release: destroy }); },
      };
    },
  };
  return { pool, calls };
}

test("rate buckets use one atomic database-time upsert and bounded attempt counts", async () => {
  const { pool, calls } = mockPool();
  const store = createBrowserAuthStore({ getPool: () => pool });
  const result = await store.consumeRateLimit("analysis_global", "a".repeat(64), 120, 60_000);
  assert.deepEqual(result, { attempts: 1, expiresAt: Date.parse("2026-10-11T12:01:00.000Z") });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, consumeRateLimitSql);
  assert.match(calls[0].sql, /ON CONFLICT \(scope, bucket_hash\) DO UPDATE/);
  assert.match(calls[0].sql, /statement_timestamp\(\)/);
  assert.match(calls[0].sql, /LEAST\(rate_limit_buckets\.attempts \+ 1, \$4::integer\)/);
  assert.deepEqual(calls[0].values, ["analysis_global", "a".repeat(64), 60_000, 121]);
});

test("bucket validation and storage failures surface without a success-shaped fallback", async () => {
  const { pool } = mockPool();
  const store = createBrowserAuthStore({ getPool: () => pool });
  await assert.rejects(store.consumeRateLimit("arbitrary", "x", 120, 60_000), TypeError);
  await assert.rejects(store.consumeRateLimit("analysis_global", "a".repeat(64), 30, 60_000), TypeError);
  const unavailable = createBrowserAuthStore({
    getPool: () => mockPool({ failAt: consumeRateLimitSql }).pool,
  });
  await assert.rejects(unavailable.consumeRateLimit("analysis_global", "a".repeat(64), 120, 60_000), /synthetic database error/);
});

test("session replacement revokes the old ID and inserts the new session in one transaction", async () => {
  const { pool, calls } = mockPool();
  const store = createBrowserAuthStore({ getPool: () => pool });
  await store.replaceSession("b".repeat(64), {
    sessionIdHash: "a".repeat(64), accountKeyHash: "c".repeat(64), role: "participant",
    configFingerprint: "d".repeat(64), createdAt: Date.parse("2026-10-11T12:00:00.000Z"),
    expires: Date.parse("2026-10-11T13:00:00.000Z"),
  });
  assert.deepEqual(calls.slice(0, 4).map(({ sql }) => sql), [
    "BEGIN", "DELETE FROM browser_auth_sessions WHERE session_id_hash = $1",
    calls[2].sql, "COMMIT",
  ]);
  assert.deepEqual(calls.at(-1), { release: false });
  assert.match(calls[2].sql, /INSERT INTO browser_auth_sessions/);
  assert.deepEqual(calls[1].values, ["b".repeat(64)]);
  assert.equal(calls[2].values[0], "a".repeat(64));
  assert.equal(calls[2].values[4].toISOString(), "2026-10-11T12:00:00.000Z");
});

test("failed session replacement rolls back and discards an unusable client", async () => {
  const insertSql = "INSERT INTO browser_auth_sessions";
  const { pool, calls } = mockPool({ failAt: insertSql });
  const store = createBrowserAuthStore({ getPool: () => pool });
  await assert.rejects(store.replaceSession(null, {
    sessionIdHash: "a".repeat(64), accountKeyHash: "c".repeat(64), role: "participant",
    configFingerprint: "d".repeat(64), createdAt: 1, expires: 2,
  }), /synthetic database error/);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.deepEqual(calls.at(-1), { release: false });
});
