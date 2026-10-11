// @ts-check
import { ReportError } from "./report-errors.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSES = new Set(["appointment_scheduled", "will_schedule_later"]);
const MAX_BODY_BYTES = 2048;
const REVIEWED_MESSAGE = "Your symptom report has been reviewed by the study team. Thank you for submitting your report.";
const REMINDER_MESSAGE = "Reminder: Please schedule your follow-up appointment with the study team.";

/**
 * Materialize at most one reminder per report and UTC calendar day. The unique
 * key prevents refreshes or concurrent requests from duplicating a reminder.
 * @param {() => {connect: () => Promise<any>}} getPool
 * @param {string} participantId
 */
export async function listParticipantNotifications(getPool, participantId) {
  let client;
  let inTransaction = false;
  let destroyClient = false;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      `SELECT r.id
       FROM public.reports r
       JOIN public.participant_follow_up_responses f
         ON f.report_id = r.id AND f.participant_id = r.participant_id
       WHERE r.participant_id = $1
         AND f.response = 'will_schedule_later'
         AND (NOW() AT TIME ZONE 'UTC')::date > (f.responded_at AT TIME ZONE 'UTC')::date
       ORDER BY r.id
       FOR UPDATE OF r`,
      [participantId],
    );
    await client.query(
      `INSERT INTO public.participant_follow_up_reminders (report_id, reminder_date)
       SELECT f.report_id, (NOW() AT TIME ZONE 'UTC')::date
       FROM public.participant_follow_up_responses f
       JOIN public.reports r ON r.id = f.report_id AND r.participant_id = f.participant_id
       WHERE f.participant_id = $1
         AND f.response = 'will_schedule_later'
         AND (NOW() AT TIME ZONE 'UTC')::date > (f.responded_at AT TIME ZONE 'UTC')::date
         AND EXISTS (
           SELECT 1 FROM public.review_history h
           WHERE h.report_id = r.id AND h.action = 'status_changed'
             AND h.new_workflow_status = 'follow_up_requested'
         )
       ON CONFLICT (report_id, reminder_date) DO NOTHING`,
      [participantId],
    );
    const result = await client.query(
      `SELECT * FROM (
         SELECT h.id::text AS "notificationId", r.id::text AS "reportId",
           CASE WHEN h.new_workflow_status = 'reviewed' THEN $2 ELSE h.review_note END AS message,
           h.created_at AS "createdAt", h.new_workflow_status AS "notificationType",
           f.response AS "participantResponse", f.responded_at AS "responseUpdatedAt"
         FROM public.review_history h
         JOIN public.reports r ON r.id = h.report_id
         LEFT JOIN public.participant_follow_up_responses f
           ON f.report_id = r.id AND f.participant_id = r.participant_id
         WHERE r.participant_id = $1
           AND h.action = 'status_changed'
           AND h.new_workflow_status IN ('reviewed', 'follow_up_requested')
         UNION ALL
         SELECT ('reminder:' || rm.report_id::text || ':' || rm.reminder_date::text) AS "notificationId",
           r.id::text AS "reportId", $3 AS message, rm.created_at AS "createdAt",
           'follow_up_reminder' AS "notificationType",
           f.response AS "participantResponse", f.responded_at AS "responseUpdatedAt"
         FROM public.participant_follow_up_reminders rm
         JOIN public.reports r ON r.id = rm.report_id
         JOIN public.participant_follow_up_responses f
           ON f.report_id = r.id AND f.participant_id = r.participant_id
         WHERE r.participant_id = $1
           AND f.response = 'will_schedule_later'
           AND rm.reminder_date = (NOW() AT TIME ZONE 'UTC')::date
       ) events
       ORDER BY "createdAt" DESC, "notificationId" DESC
       LIMIT 100`,
      [participantId, REVIEWED_MESSAGE, REMINDER_MESSAGE],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return { notifications: result.rows };
  } catch (error) {
    if (client && inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
    } else if (client) {
      destroyClient = true;
    }
    if (error instanceof ReportError) throw error;
    throw new ReportError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications could not be retrieved. Please try again later.");
  } finally {
    client?.release(destroyClient);
  }
}

/** @param {Request} request */
async function readResponseRequest(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) {
    throw new ReportError(415, "UNSUPPORTED_MEDIA_TYPE", "Send uncompressed application/json.");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new ReportError(413, "PAYLOAD_TOO_LARGE", "Follow-up response is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ReportError(400, "INVALID_RESPONSE", "Provide a valid report ID and follow-up response.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ReportError(413, "PAYLOAD_TOO_LARGE", "Follow-up response is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 2
      || Object.keys(body).some((key) => !["reportId", "response"].includes(key))
      || typeof body.reportId !== "string" || !UUID.test(body.reportId)
      || !RESPONSES.has(body.response)) {
      throw new ReportError(400, "INVALID_RESPONSE", "Provide a valid report ID and follow-up response.");
    }
    return { reportId: body.reportId, response: body.response };
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(400, "INVALID_RESPONSE", "Provide a valid report ID and follow-up response.");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Persist only a participant self-report; this does not schedule an appointment.
 * @param {() => {connect: () => Promise<any>}} getPool
 * @param {string} participantId
 * @param {string} reportId
 * @param {"appointment_scheduled" | "will_schedule_later"} response
 */
export async function saveParticipantFollowUpResponse(getPool, participantId, reportId, response) {
  let client;
  let inTransaction = false;
  let destroyClient = false;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    inTransaction = true;
    const report = await client.query(
      "SELECT id FROM public.reports WHERE id = $1 AND participant_id = $2 FOR UPDATE",
      [reportId, participantId],
    );
    if (report.rows.length === 0) throw new ReportError(404, "REPORT_NOT_FOUND", "The report was not found.");
    const followUp = await client.query(
      `SELECT 1 FROM public.review_history
       WHERE report_id = $1 AND action = 'status_changed'
         AND new_workflow_status = 'follow_up_requested'
       LIMIT 1`,
      [reportId],
    );
    if (followUp.rows.length === 0) {
      throw new ReportError(409, "FOLLOW_UP_NOT_FOUND", "This report has no saved follow-up request.");
    }
    const existing = await client.query(
      `SELECT response, responded_at FROM public.participant_follow_up_responses
       WHERE report_id = $1 AND participant_id = $2 FOR UPDATE`,
      [reportId, participantId],
    );
    const current = existing.rows[0];
    if (current?.response === "appointment_scheduled" && response !== "appointment_scheduled") {
      throw new ReportError(409, "FOLLOW_UP_ALREADY_COMPLETED", "The appointment response has already been marked scheduled.");
    }
    let saved;
    if (current?.response === response) {
      saved = current;
    } else {
      const query = current
        ? `UPDATE public.participant_follow_up_responses
           SET response = $3, responded_at = NOW()
           WHERE report_id = $1 AND participant_id = $2
           RETURNING response, responded_at`
        : `INSERT INTO public.participant_follow_up_responses
             (report_id, participant_id, response)
           VALUES ($1, $2, $3)
           RETURNING response, responded_at`;
      const values = current ? [reportId, participantId, response] : [reportId, participantId, response];
      const result = await client.query(query, values);
      saved = result.rows[0];
    }
    if (!saved || !(saved.responded_at instanceof Date || typeof saved.responded_at === "string")) {
      throw new Error("The participant response could not be confirmed.");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return {
      reportId,
      response: saved.response,
      respondedAt: new Date(saved.responded_at).toISOString(),
    };
  } catch (error) {
    if (client && inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
    } else if (client) {
      destroyClient = true;
    }
    if (error instanceof ReportError) throw error;
    throw new ReportError(503, "FOLLOW_UP_RESPONSE_UNAVAILABLE", "Your response could not be saved. Please try again.");
  } finally {
    client?.release(destroyClient);
  }
}

/**
 * @param {{
 *   authenticate: (request: Request) => Promise<string> | string,
 *   list: (participantId: string) => Promise<unknown>
 * }} dependencies
 */
export function createParticipantNotificationsHandler({ authenticate, list }) {
  /** @param {Request} request */
  return async function GET(request) {
    const headers = { "Cache-Control": "no-store" };
    try {
      const participantId = await authenticate(request);
      return Response.json(await list(participantId), { headers });
    } catch (error) {
      return participantErrorResponse(error, headers);
    }
  };
}

/**
 * @param {{
 *   authenticate: (request: Request) => Promise<string> | string,
 *   save: (participantId: string, reportId: string, response: "appointment_scheduled" | "will_schedule_later") => Promise<unknown>
 * }} dependencies
 */
export function createParticipantFollowUpResponseHandler({ authenticate, save }) {
  /** @param {Request} request */
  return async function POST(request) {
    const headers = { "Cache-Control": "no-store" };
    try {
      const participantId = await authenticate(request);
      const input = await readResponseRequest(request);
      return Response.json(await save(participantId, input.reportId, input.response), { headers });
    } catch (error) {
      return participantErrorResponse(error, headers);
    }
  };
}

/** @param {unknown} error @param {Record<string, string>} headers */
function participantErrorResponse(error, headers) {
  const failure = error instanceof ReportError
    ? error
    : new ReportError(500, "INTERNAL_ERROR", "The request could not be completed.");
  return Response.json({ error: { code: failure.code, message: failure.message } }, {
    status: failure.status,
    headers: {
      ...headers,
      ...(failure.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
    },
  });
}
