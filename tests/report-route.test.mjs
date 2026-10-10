import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticateDemoParticipant } from "../lib/demo-auth.mjs";
import { createReportHandler, MAX_REPORT_BYTES } from "../lib/report-http.mjs";
import { saveReport } from "../lib/report-store.mjs";
import { authConfig, database, now, participantId, payload, reportId, request } from "./report-fixtures.mjs";

function setup(options) {
  const db = database(options);
  const handler = createReportHandler({
    authenticate: (req) => authenticateDemoParticipant(req, authConfig, () => now),
    save: (id, input) => saveReport(db.getPool, id, input),
  });
  return { handler, db };
}

test("POST returns 201 only after committing and uses server-established participant identity", async () => {
  const { handler, db } = setup();
  const response = await handler(request());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { report: { id: reportId, workflowStatus: "submitted", submittedAt: new Date(now).toISOString(), symptomCount: 1 } });
  assert.deepEqual(db.calls[1].values, [participantId]);
  assert.equal(db.calls.at(-1).sql, "COMMIT");
});

for (const [label, req, status] of [
  ["unauthenticated", () => request("not JSON", { authorization: "" }), 401],
  ["invalid JSON", () => request("{"), 400],
  ["empty body", () => request(""), 400],
  ["wrong content type", () => request(payload(), { "content-type": "text/plain" }), 415],
  ["compressed body", () => request(payload(), { "content-encoding": "gzip" }), 415],
  ["forged role", () => request({ ...payload(), role: "coordinator" }), 422],
  ["forged identity", () => request({ ...payload(), participantId: "other" }), 422],
  ["invalid status", () => request({ ...payload(), workflowStatus: "reviewed" }), 422],
  ["missing transcript", () => request({ ...payload(), originalTranscript: null }), 422],
  ["large content length", () => request(payload(), { "content-length": String(MAX_REPORT_BYTES + 1) }), 413],
  ["large actual body", () => request(" ".repeat(MAX_REPORT_BYTES + 1)), 413],
]) {
  test(`POST rejects ${label} with ${status} before opening a database connection`, async () => {
    const { handler, db } = setup();
    const response = await handler(req());
    assert.equal(response.status, status);
    assert.equal(db.connections, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(typeof body.error.code, "string");
    if (status === 401) assert.equal(response.headers.get("www-authenticate"), "Bearer");
  });
}

test("POST reports unknown symptom mapping and keeps the entire submission unsaved", async () => {
  const { handler, db } = setup({ codes: [] });
  const response = await handler(request());
  assert.equal(response.status, 422);
  assert.deepEqual((await response.json()).error.field, "symptoms[0].symptomCode");
  assert.ok(db.calls.every(({ sql }) => !sql.startsWith("INSERT")));
});

test("POST returns 403 for a withdrawn participant", async () => {
  const { handler } = setup({ active: false });
  assert.equal((await handler(request())).status, 403);
});

test("POST returns a safe 503 on SQL failure, with rollback", async () => {
  const { handler, db } = setup({ failAt: 5 });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE_SQL|PASSWORD|INSERT|postgres/i);
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
});

test("POST hides unexpected errors and performs no save after authentication failure", async () => {
  let called = false;
  const handler = createReportHandler({
    authenticate: () => { throw new Error("PRIVATE_SECRET"); },
    save: async () => { called = true; },
  });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /PRIVATE_SECRET/);
  assert.equal(called, false);
});

test("POST rejects invalid UTF-8", async () => {
  const { handler, db } = setup();
  const req = request();
  const response = await handler(new Request(req.url, { method: "POST", headers: req.headers, body: new Uint8Array([0xff]) }));
  assert.equal(response.status, 400);
  assert.equal(db.connections, 0);
});

test("POST enforces byte limit across streamed chunks without relying on content length", async () => {
  const { handler, db } = setup();
  const req = request();
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_REPORT_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { canceled = true; },
  });
  const response = await handler(new Request(req.url, { method: "POST", headers: req.headers, body, duplex: "half" }));
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
  assert.equal(db.connections, 0);
});
