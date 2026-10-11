import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { authenticateCoordinator } from "../lib/coordinator-auth.mjs";
import { createCoordinatorReportsHandler, listCoordinatorReports } from "../lib/coordinator-reports.mjs";

const token = "synthetic_coordinator_credential_".padEnd(43, "x");
const participantToken = "synthetic_participant_credential_".padEnd(43, "x");
const now = Date.parse("2026-10-10T12:00:00.000Z");
const entry = {
  coordinatorId: "fictional-demo-coordinator",
  tokenSha256: createHash("sha256").update(token).digest("hex"),
  expiresAt: "2026-10-10T13:00:00.000Z",
};
const config = (entries = [entry]) => ({ enabled: "true", coordinators: JSON.stringify(entries) });
const request = (query = "", credential = token) => new Request(`http://localhost/api/coordinator/reports${query}`, {
  headers: credential ? { authorization: `Bearer ${credential}` } : {},
});
const authenticate = (req) => authenticateCoordinator(req, () => config(), () => now);
const row = {
  id: "22222222-2222-4222-8222-222222222222", participantCode: "DEMO-001", source: "voice",
  originalLanguage: "en", originalTranscript: "I feel dizzy.", englishSummary: null,
  submittedAt: new Date(now), workflowStatus: "submitted",
  symptoms: [{ symptomCode: "dizziness", displayName: "Dizziness", reportedIntensity: null,
    onsetDate: null, ongoing: true, participantDescription: "I feel dizzy." }],
};

function setup(rows = [row], failure) {
  const calls = [];
  const getPool = () => ({ query: async (sql, values) => {
    calls.push({ sql, values });
    if (failure) throw failure;
    return { rows };
  } });
  return { calls, handler: createCoordinatorReportsHandler({ authenticate,
    list: (pagination) => listCoordinatorReports(getPool, pagination) }) };
}

test("coordinator identity comes exclusively from separate server configuration", () => {
  assert.equal(authenticate(request()), entry.coordinatorId);
  assert.throws(() => authenticate(request("", participantToken)), { status: 401 });
});

for (const [label, cfg] of [
  ["missing", {}], ["disabled", { ...config(), enabled: "false" }],
  ["invalid JSON", { enabled: "true", coordinators: "{" }], ["empty", config([])],
  ["invalid hash", config([{ ...entry, tokenSha256: "bad" }])],
  ["invalid identity", config([{ ...entry, coordinatorId: "" }])],
  ["participant configuration", config([{ ...entry, participantId: "forged" }])],
  ["duplicate credential", config([entry, { ...entry, coordinatorId: "other" }])],
  ["invalid expiry", config([{ ...entry, expiresAt: "2026-02-30T00:00:00.000Z" }])],
  ["wrong shape", config(null)],
]) {
  test(`authentication fails closed for ${label} configuration`, () => {
    assert.throws(() => authenticateCoordinator(request(), () => cfg, () => now), { status: 503 });
  });
}

test("expired coordinator credentials cannot authenticate", () => {
  assert.throws(() => authenticateCoordinator(request(), () => config(), () => Date.parse(entry.expiresAt)), { status: 401 });
});

for (const [label, credential] of [["missing", ""], ["malformed", "short"], ["participant", participantToken]]) {
  test(`GET rejects ${label} credentials before pagination or database access`, async () => {
    const { handler, calls } = setup();
    const response = await handler(request("?role=coordinator", credential));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
  });
}

for (const query of ["?limit=0", "?limit=101", "?limit=1.5", "?limit=", "?offset=-1",
  "?offset=9007199254740991", "?limit=1;DROP%20TABLE%20reports", "?limit=1&limit=2",
  "?offset=0&offset=1", "?participantId=forged", "?role=coordinator", "?status=draft"]) {
  test(`GET rejects unsupported pagination ${query}`, async () => {
    const { handler, calls } = setup();
    const response = await handler(request(query));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PAGINATION");
    assert.equal(calls.length, 0);
  });
}

test("GET returns report contract, preserves null intensity and uses bound pagination", async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.deepEqual(await response.json(), {
    reports: [{ ...row, submittedAt: row.submittedAt.toISOString() }],
    pagination: { limit: 20, offset: 0, hasMore: false, nextOffset: null },
  });
  assert.deepEqual(calls[0].values, [21, 0]);
  assert.match(calls[0].sql, /LIMIT \$1 OFFSET \$2/);
  assert.match(calls[0].sql, /IN \('submitted', 'reviewed', 'follow_up_requested', 'closed'\)/);
  assert.match(calls[0].sql, /submitted_at IS NOT NULL/);
  assert.match(calls[0].sql, /ORDER BY r.submitted_at DESC, r.id DESC/);
  assert.match(calls[0].sql, /FROM page r/);
  assert.doesNotMatch(calls[0].sql, /is_active|INSERT|UPDATE|DELETE/);
});

test("pagination probes one extra report without returning it", async () => {
  const { handler, calls } = setup([row, { ...row, id: "next-report" }]);
  const response = await handler(request("?limit=1&offset=2"));
  const body = await response.json();
  assert.equal(body.reports.length, 1);
  assert.deepEqual(body.pagination, { limit: 1, offset: 2, hasMore: true, nextOffset: 3 });
  assert.deepEqual(calls[0].values, [2, 2]);
});

test("empty page is a successful response", async () => {
  const { handler } = setup([]);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).reports, []);
});

test("reports without symptoms and participant-reported zero intensity are preserved", async () => {
  const { handler } = setup([{ ...row, symptoms: [] }, { ...row,
    symptoms: [{ ...row.symptoms[0], reportedIntensity: 0 }] }]);
  const { reports } = await (await handler(request())).json();
  assert.deepEqual(reports[0].symptoms, []);
  assert.equal(reports[1].symptoms[0].reportedIntensity, 0);
});

test("database errors are sanitized with no SQL or credentials exposed", async () => {
  const { handler } = setup([], new Error("postgres://SECRET SELECT private_data"));
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "REPORTS_UNAVAILABLE",
    message: "Reports could not be retrieved. Please try again later." } });
});

test("unconfigured authentication and unexpected failures do not call database", async () => {
  for (const [auth, status] of [
    [(req) => authenticateCoordinator(req, () => ({})), 503],
    [() => { throw new Error("PRIVATE_SECRET"); }, 500],
    [() => "", 401],
  ]) {
    const handler = createCoordinatorReportsHandler({ authenticate: auth,
      list: async () => assert.fail("database must not be accessed") });
    const response = await handler(request());
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /PRIVATE_SECRET/);
  }
});

test("actual Next route wiring uses coordinator auth and a mocked database, with no runtime export", async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith("/lib/db.mjs")) {
        return { url: "data:text/javascript,export const getPool = () => ({query: async () => ({rows: []})});", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const keys = ["SYMORA_COORDINATOR_AUTH_ENABLED", "SYMORA_COORDINATORS"];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.SYMORA_COORDINATOR_AUTH_ENABLED = "true";
    process.env.SYMORA_COORDINATORS = JSON.stringify([{ ...entry, expiresAt: new Date(Date.now() + 60_000).toISOString() }]);
    const route = await import("../app/api/coordinator/reports/route.ts");
    assert.deepEqual(Object.keys(route), ["GET"]);
    assert.equal((await route.GET(request("", participantToken))).status, 401);
    assert.equal((await route.GET(request())).status, 200);
    delete process.env.SYMORA_COORDINATORS;
    assert.equal((await route.GET(request())).status, 503);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    hooks.deregister();
  }
});
