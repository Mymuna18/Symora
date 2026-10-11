import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { authenticateDemoParticipant } from "../../lib/demo-auth.mjs";
import { createReportHandler } from "../../lib/report-http.mjs";
import { saveReport } from "../../lib/report-store.mjs";
import { ids, transcript, evidence, submission } from "./fixtures.mjs";

// Imported safely by tooling; no tests or SQL run until explicitly called.
export async function runPostgresSuite(pool) {
  const createReport = async (participant = ids.active) => {
    const result = await pool.query("INSERT INTO reports (participant_id, original_language, original_transcript) VALUES ($1, 'en', 'Synthetic statement') RETURNING id", [participant]);
    return result.rows[0].id;
  };
  const counts = async () => (await pool.query("SELECT (SELECT count(*)::integer FROM reports) AS reports, (SELECT count(*)::integer FROM report_symptoms) AS symptoms")).rows[0];
  const expectSqlError = (code, sql, values) => assert.rejects(pool.query(sql, values), (error) => error.code === code);
  const clock = Date.now();
  const token = "fictional_integration_credential_".padEnd(43, "x");
  const authenticate = (participant) => (request) => authenticateDemoParticipant(request, () => ({
    enabled: "true",
    participants: JSON.stringify([{
      tokenSha256: createHash("sha256").update(token).digest("hex"),
      participantId: participant, expiresAt: new Date(clock + 60_000).toISOString(),
    }]),
  }), () => clock);
  const send = (body = submission(), participant = ids.active, getPool = () => pool) => createReportHandler({
    authenticate: authenticate(participant),
    save: (identity, input) => saveReport(getPool, identity, input),
  })(new Request("http://localhost/api/reports", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }));

  await test("real PostgreSQL integration (disposable local container only)", async (t) => {
    t.beforeEach(async () => {
      await pool.query("TRUNCATE review_history, report_symptoms, reports");
    });

    await t.test("migration creates exactly five tables and four foreign keys", async () => {
      const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
      assert.deepEqual(tables.rows.map((row) => row.table_name), ["participants", "report_symptoms", "reports", "review_history", "symptoms"]);
      const keys = await pool.query("SELECT count(*)::integer AS count FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'");
      assert.equal(keys.rows[0].count, 4);
    });
    await t.test("report participant foreign key is enforced", async () => {
      await assert.rejects(createReport(ids.absent), (error) => error.code === "23503");
    });
    await t.test("both report-symptom foreign keys are enforced", async () => {
      await expectSqlError("23503", "INSERT INTO report_symptoms (report_id, symptom_id) VALUES ($1, $2)", [ids.absent, ids.headache]);
      const report = await createReport();
      await expectSqlError("23503", "INSERT INTO report_symptoms (report_id, symptom_id) VALUES ($1, $2)", [report, ids.absent]);
    });
    await t.test("review history foreign key is enforced", async () => {
      await expectSqlError("23503", `INSERT INTO review_history (report_id, reviewer_user_id, action, previous_workflow_status, new_workflow_status)
        VALUES ($1, 'SYNTHETIC-REVIEWER', 'status_changed', 'submitted', 'reviewed')`, [ids.absent]);
    });
    await t.test("participant and symptom deletion is restricted; deleting an unreviewed report cascades its links", async () => {
      const report = await createReport();
      await pool.query("INSERT INTO report_symptoms (report_id, symptom_id) VALUES ($1, $2)", [report, ids.headache]);
      await expectSqlError("23503", "DELETE FROM participants WHERE id = $1", [ids.active]);
      await expectSqlError("23503", "DELETE FROM symptoms WHERE id = $1", [ids.headache]);
      await pool.query("DELETE FROM reports WHERE id = $1", [report]);
      assert.deepEqual(await counts(), { reports: 0, symptoms: 0 });
    });
    await t.test("review history prevents deleting an audited report", async () => {
      const report = await createReport();
      await pool.query(`INSERT INTO review_history (report_id, reviewer_user_id, action, previous_workflow_status, new_workflow_status)
        VALUES ($1, 'SYNTHETIC-REVIEWER', 'status_changed', 'submitted', 'reviewed')`, [report]);
      await expectSqlError("23503", "DELETE FROM reports WHERE id = $1", [report]);
    });

    for (const value of [null, "", " \t\n"]) {
      await t.test(`submitted transcript rejects ${JSON.stringify(value)}`, async () => {
        await expectSqlError("23514", "INSERT INTO reports (participant_id, original_language, original_transcript) VALUES ($1, 'en', $2)", [ids.active, value]);
      });
    }
    await t.test("a draft may omit transcript and timestamp, then submit both atomically", async () => {
      const inserted = await pool.query(`INSERT INTO reports (participant_id, source, original_language, workflow_status, submitted_at)
        VALUES ($1, 'voice', 'es', 'draft', NULL) RETURNING id, original_transcript, submitted_at`, [ids.active]);
      assert.equal(inserted.rows[0].original_transcript, null);
      assert.equal(inserted.rows[0].submitted_at, null);
      await expectSqlError("23514", "UPDATE reports SET workflow_status = 'submitted' WHERE id = $1", [inserted.rows[0].id]);
      const updated = await pool.query("UPDATE reports SET workflow_status = 'submitted', original_transcript = $2, submitted_at = NOW() WHERE id = $1 RETURNING workflow_status, submitted_at", [inserted.rows[0].id, transcript]);
      assert.equal(updated.rows[0].workflow_status, "submitted");
      assert.ok(updated.rows[0].submitted_at instanceof Date);
    });
    await t.test("drafts reject timestamps; submitted reports reject missing timestamps and unknown statuses", async () => {
      await expectSqlError("23514", "INSERT INTO reports (participant_id, original_language, workflow_status) VALUES ($1, 'en', 'draft')", [ids.active]);
      await expectSqlError("23514", "INSERT INTO reports (participant_id, original_language, original_transcript, submitted_at) VALUES ($1, 'en', 'statement', NULL)", [ids.active]);
      await expectSqlError("23514", "INSERT INTO reports (participant_id, original_language, original_transcript, workflow_status) VALUES ($1, 'en', 'statement', 'invented')", [ids.active]);
    });
    for (const value of [null, 0, 10, -1, 11]) {
      await t.test(`database enforces nullable participant intensity ${value}`, async () => {
        const report = await createReport();
        const sql = "INSERT INTO report_symptoms (report_id, symptom_id, reported_intensity) VALUES ($1, $2, $3) RETURNING reported_intensity";
        if (value !== null && (value < 0 || value > 10)) {
          await expectSqlError("23514", sql, [report, ids.headache, value]);
        } else {
          assert.equal((await pool.query(sql, [report, ids.headache, value])).rows[0].reported_intensity, value);
        }
      });
    }
    await t.test("a report cannot link the same symptom twice", async () => {
      const report = await createReport();
      const sql = "INSERT INTO report_symptoms (report_id, symptom_id) VALUES ($1, $2)";
      await pool.query(sql, [report, ids.headache]);
      await expectSqlError("23505", sql, [report, ids.headache]);
    });
    for (const [action, previous, next, note, reviewer] of [
      ["status_changed", null, "reviewed", null, "reviewer"],
      ["status_changed", "submitted", "submitted", null, "reviewer"],
      ["note_added", "submitted", "reviewed", "note", "reviewer"],
      ["note_added", "submitted", "submitted", null, "reviewer"],
      ["note_added", "submitted", "submitted", " \n", "reviewer"],
      ["status_changed", "submitted", "reviewed", null, " \t"],
    ]) {
      await t.test(`audit constraint rejects inconsistent record ${JSON.stringify([action, previous, next, note, reviewer])}`, async () => {
        const report = await createReport();
        await expectSqlError("23514", "INSERT INTO review_history (report_id, action, previous_workflow_status, new_workflow_status, review_note, reviewer_user_id) VALUES ($1, $2, $3, $4, $5, $6)", [report, action, previous, next, note, reviewer]);
      });
    }

    await t.test("HTTP submission persists original text, descriptions and server timestamp exactly", async () => {
      const response = await send();
      assert.equal(response.status, 201);
      const { report } = await response.json();
      const result = await pool.query("SELECT r.*, rs.participant_description, rs.reported_intensity, rs.onset_date, rs.ongoing FROM reports r JOIN report_symptoms rs ON rs.report_id = r.id WHERE r.id = $1", [report.id]);
      const row = result.rows[0];
      assert.equal(row.participant_id, ids.active);
      assert.equal(row.original_transcript, transcript);
      assert.equal(row.participant_description, evidence);
      assert.equal(row.english_summary, submission().englishSummary);
      assert.equal(row.workflow_status, "submitted");
      assert.equal(row.submitted_at.toISOString(), report.submittedAt);
      assert.equal(row.reported_intensity, 4);
      assert.equal(row.onset_date, null);
      assert.equal(row.ongoing, null);
      assert.deepEqual(await counts(), { reports: 1, symptoms: 1 });
    });
    for (const code of ["unmapped_synthetic", "inactive_test"]) {
      await t.test(`HTTP rejects ${code} and saves nothing`, async () => {
        const response = await send(submission([{ symptomCode: code, participantDescription: evidence }]));
        assert.equal(response.status, 422);
        assert.equal((await response.json()).error.code, "UNKNOWN_SYMPTOM");
        assert.deepEqual(await counts(), { reports: 0, symptoms: 0 });
      });
    }
    await t.test("HTTP rejects a withdrawn participant and saves nothing", async () => {
      const response = await send(submission(), ids.withdrawn);
      assert.equal(response.status, 403);
      assert.deepEqual(await counts(), { reports: 0, symptoms: 0 });
    });
    await t.test("real SQL failure on the second symptom rolls back the report and first symptom", async () => {
      let inserts = 0;
      const getPool = () => ({ connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql, values) => {
            if (sql.includes("INSERT INTO report_symptoms") && ++inserts === 2) {
              assert.equal((await client.query("SELECT count(*)::integer AS count FROM report_symptoms")).rows[0].count, 1);
              // Make PostgreSQL itself reject the second INSERT; no fake exception.
              values = [...values]; values[2] = 11;
            }
            return client.query(sql, values);
          },
          release: (destroy) => client.release(destroy),
        };
      } });
      const response = await send(submission([{ symptomCode: "headache" }, { symptomCode: "nausea" }]), ids.active, getPool);
      assert.equal(response.status, 503);
      assert.equal(inserts, 2);
      assert.deepEqual(await counts(), { reports: 0, symptoms: 0 });
      assert.doesNotMatch(await response.text(), /23514|reported_intensity|INSERT/);
    });
  });
}
