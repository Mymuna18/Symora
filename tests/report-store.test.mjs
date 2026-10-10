import assert from "node:assert/strict";
import { test } from "node:test";
import { saveReport } from "../lib/report-store.mjs";
import { validateReport } from "../lib/report-validation.mjs";
import { database, now, participantId, payload, reportId } from "./report-fixtures.mjs";

test("saves report and symptoms with parameters on one client, then commits and releases", async () => {
  const db = database();
  const input = payload();
  input.originalTranscript = "Original statement: '); DROP TABLE reports; --";
  input.symptoms.push({ symptomCode: "nausea", reportedIntensity: 0, ongoing: false });
  const result = await saveReport(db.getPool, participantId, validateReport(input));
  assert.deepEqual(result, { id: reportId, workflowStatus: "submitted", submittedAt: new Date(now).toISOString(), symptomCount: 2 });
  assert.equal(db.connections, 1);
  assert.equal(db.calls[0].sql, "BEGIN");
  assert.match(db.calls[1].sql, /status = 'active' FOR SHARE/);
  assert.deepEqual(db.calls[1].values, [participantId]);
  assert.match(db.calls[2].sql, /is_active = TRUE.*FOR SHARE/);
  assert.deepEqual(db.calls[2].values, [["headache", "nausea"]]);
  assert.match(db.calls[3].sql, /'submitted', NOW\(\)/);
  assert.deepEqual(db.calls[3].values, [participantId, "voice", "es", input.originalTranscript, input.englishSummary]);
  assert.deepEqual(db.calls[4].values, [reportId, "catalog-0", 4, "2026-10-09", true, "  dolor de cabeza\n"]);
  assert.deepEqual(db.calls[5].values, [reportId, "catalog-1", 0, null, false, null]);
  assert.equal(db.calls[6].sql, "COMMIT");
  assert.equal(db.calls.length, 7);
  assert.deepEqual(db.released, [false]);
  for (const call of db.calls) assert.ok(!call.sql.includes(input.originalTranscript));
});

test("empty symptoms saves only the report and does not create catalog entries", async () => {
  const db = database();
  const result = await saveReport(db.getPool, participantId, validateReport({ ...payload(), symptoms: [] }));
  assert.equal(result.symptomCount, 0);
  assert.equal(db.calls.length, 4);
  assert.ok(db.calls.every(({ sql }) => !sql.includes("report_symptoms") && !sql.includes("INSERT INTO symptoms")));
});

test("inactive or absent participant rolls back before any insert", async () => {
  const db = database({ active: false });
  await assert.rejects(saveReport(db.getPool, participantId, validateReport(payload())), (e) => e.status === 403);
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  assert.equal(db.calls.length, 3);
  assert.deepEqual(db.released, [false]);
});

test("unmapped or inactive symptom rejects the whole report, without discarding descriptions", async () => {
  const db = database({ codes: [] });
  const input = validateReport(payload());
  await assert.rejects(saveReport(db.getPool, participantId, input), (e) => e.status === 422 && e.code === "UNKNOWN_SYMPTOM" && e.field === "symptoms[0].symptomCode");
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  assert.ok(db.calls.every(({ sql }) => !sql.startsWith("INSERT")));
  assert.equal(input.originalTranscript, payload().originalTranscript);
  assert.equal(input.symptoms[0].participantDescription, payload().symptoms[0].participantDescription);
  assert.deepEqual(db.released, [false]);
});

for (const [failAt, operation] of [[1, "BEGIN"], [2, "participant lookup"], [3, "catalog lookup"], [4, "report insert"], [5, "first symptom insert"], [6, "second symptom insert"], [7, "COMMIT"]]) {
  test(`failure during ${operation} never returns success and releases the client`, async () => {
    const db = database({ failAt });
    const input = payload(); input.symptoms.push({ symptomCode: "nausea" });
    await assert.rejects(saveReport(db.getPool, participantId, validateReport(input)), (e) => e.status === 503 && !e.message.includes("PRIVATE_SQL"));
    if (failAt > 1) assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    assert.deepEqual(db.released, [failAt === 1]);
    assert.equal(db.calls.filter(({ sql }) => sql === "COMMIT").length, failAt === 7 ? 1 : 0);
  });
}

test("rollback failure destroys the client and preserves a safe error", async () => {
  const db = database({ failAt: 5, rollbackFails: true });
  await assert.rejects(saveReport(db.getPool, participantId, validateReport(payload())), (e) => e.status === 503 && !e.message.includes("PRIVATE_SQL"));
  assert.deepEqual(db.released, [true]);
});

test("connection failures are sanitized without a transaction or client release", async () => {
  await assert.rejects(saveReport(() => ({ connect: async () => { throw new Error("PRIVATE_SQL_AND_PASSWORD"); } }), participantId, validateReport(payload())), (e) => e.status === 503 && !e.message.includes("PRIVATE_SQL"));
});
