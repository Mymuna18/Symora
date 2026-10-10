// @ts-check
import { ReportError } from "./report-errors.mjs";

/** @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>, release: (destroy?: boolean) => void }} ReportClient */
/** @typedef {{ connect: () => Promise<ReportClient> }} ReportPool */

/**
 * Call with an authenticated server-side identity and validated input.
 * The same checked-out client handles every statement, including rollback.
 * @param {() => ReportPool} getPool
 * @param {string} participantId
 * @param {import("../types/reports").SubmitReportRequest} input
 * @returns {Promise<import("../types/reports").CreatedReport>}
 */
export async function saveReport(getPool, participantId, input) {
  /** @type {ReportClient | undefined} */
  let client;
  let began = false;
  let destroy = false;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    began = true;

    // FOR SHARE also blocks a concurrent withdrawal until this transaction ends.
    const participant = await client.query(
      "SELECT id FROM participants WHERE id = $1 AND status = 'active' FOR SHARE",
      [participantId],
    );
    if (participant.rows.length !== 1) {
      throw new ReportError(403, "PARTICIPANT_UNAVAILABLE", "This participant cannot submit reports.");
    }

    const codes = input.symptoms.map((symptom) => symptom.symptomCode);
    const catalog = codes.length ? await client.query(
      "SELECT id, code FROM symptoms WHERE code = ANY($1::text[]) AND is_active = TRUE ORDER BY code FOR SHARE",
      [codes],
    ) : { rows: [] };
    const ids = new Map(catalog.rows.map((row) => [row.code, row.id]));
    const unmappedIndex = codes.findIndex((code) => !ids.has(code));
    if (unmappedIndex !== -1) {
      throw new ReportError(422, "UNKNOWN_SYMPTOM", "This symptom code does not match an active catalog entry. Keep the original description and resolve the mapping before resubmitting.", `symptoms[${unmappedIndex}].symptomCode`);
    }

    const inserted = await client.query(
      `INSERT INTO reports
        (participant_id, source, original_language, original_transcript, english_summary, workflow_status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', NOW())
       RETURNING id, submitted_at`,
      [participantId, input.source, input.originalLanguage, input.originalTranscript, input.englishSummary ?? null],
    );
    const row = inserted.rows[0];
    if (!row || typeof row.id !== "string"
      || !(row.submitted_at instanceof Date || typeof row.submitted_at === "string")) {
      throw new Error("Unexpected database response.");
    }
    const submittedAt = new Date(row.submitted_at).toISOString();
    for (const symptom of input.symptoms) {
      await client.query(
        `INSERT INTO report_symptoms
          (report_id, symptom_id, reported_intensity, onset_date, ongoing, participant_description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, ids.get(symptom.symptomCode), symptom.reportedIntensity ?? null,
          symptom.onsetDate ?? null, symptom.ongoing ?? null, symptom.participantDescription ?? null],
      );
    }
    await client.query("COMMIT");
    began = false;
    return { id: row.id, workflowStatus: "submitted", submittedAt, symptomCount: input.symptoms.length };
  } catch (error) {
    if (client && began) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    } else if (client) {
      destroy = true;
    }
    if (error instanceof ReportError) throw error;
    throw new ReportError(503, "REPORT_STORAGE_UNAVAILABLE", "Report submission could not be confirmed. Check its status before resubmitting.");
  } finally {
    client?.release(destroy);
  }
}
