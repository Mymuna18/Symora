// @ts-check
import { ReportError } from "./report-errors.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;
const MAX_REVIEW_NOTE_LENGTH = 1000;
const allowedTargets = new Set(["reviewed", "follow_up_requested"]);
const transitions = new Map([
  ["submitted", new Set(["reviewed", "follow_up_requested"])],
  ["reviewed", new Set(["follow_up_requested"])],
]);

/** @param {string} reportId */
export function validateReportId(reportId) {
  if (!UUID.test(reportId)) {
    throw new ReportError(400, "INVALID_REPORT_ID", "A valid report UUID is required.");
  }
}

/** @param {Request} request */
async function readReviewRequest(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) {
    throw new ReportError(415, "UNSUPPORTED_MEDIA_TYPE", "Send uncompressed application/json.");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new ReportError(413, "PAYLOAD_TOO_LARGE", "Review request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidBody();
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
        throw new ReportError(413, "PAYLOAD_TOO_LARGE", "Review request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["workflowStatus", "reviewNote"].includes(key))
      || !allowedTargets.has(body.workflowStatus)) throw invalidBody();
    if (body.workflowStatus === "reviewed") {
      if (Object.hasOwn(body, "reviewNote")) throw invalidBody();
      return { workflowStatus: body.workflowStatus, reviewNote: null };
    }
    if (typeof body.reviewNote !== "string"
      || body.reviewNote.trim().length === 0
      || body.reviewNote.trim().length > MAX_REVIEW_NOTE_LENGTH) {
      throw new ReportError(400, "INVALID_REVIEW_NOTE", "Follow-up requests require a nonempty note of at most 1000 characters.");
    }
    return { workflowStatus: body.workflowStatus, reviewNote: body.reviewNote.trim() };
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw invalidBody();
  } finally {
    reader.releaseLock();
  }
}

function invalidBody() {
  return new ReportError(400, "INVALID_REVIEW_REQUEST", "Provide only a valid workflowStatus and its required reviewNote.");
}

/**
 * Serialize status changes on the report row and persist the status plus audit
 * entry on the same connection/transaction.
 * @param {() => {connect: () => Promise<any>}} getPool
 * @param {string} reportId
 * @param {string} reviewerUserId
 * @param {{workflowStatus: string, reviewNote: string | null}} input
 */
export async function updateCoordinatorReportStatus(getPool, reportId, reviewerUserId, input) {
  let client;
  let inTransaction = false;
  let destroyClient = false;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    inTransaction = true;
    const selected = await client.query(
      "SELECT workflow_status FROM public.reports WHERE id = $1 FOR UPDATE",
      [reportId],
    );
    if (selected.rows.length === 0) {
      throw new ReportError(404, "REPORT_NOT_FOUND", "The report was not found.");
    }
    const previousStatus = selected.rows[0].workflow_status;
    if (previousStatus === input.workflowStatus) {
      throw new ReportError(409, "DUPLICATE_STATUS", "The report already has this status.");
    }
    if (!transitions.get(previousStatus)?.has(input.workflowStatus)) {
      throw new ReportError(409, "INVALID_STATUS_TRANSITION", "This report cannot be changed from its current status.");
    }

    const updated = await client.query(
      `UPDATE public.reports
       SET workflow_status = $2
       WHERE id = $1
       RETURNING id, workflow_status`,
      [reportId, input.workflowStatus],
    );
    const report = updated.rows[0];
    if (!report) throw new Error("The locked report could not be updated.");

    const inserted = await client.query(
      `INSERT INTO public.review_history
        (report_id, reviewer_user_id, action, previous_workflow_status, new_workflow_status, review_note)
       VALUES ($1, $2, 'status_changed', $3, $4, $5)
       RETURNING report_id, reviewer_user_id, previous_workflow_status,
         new_workflow_status, review_note, created_at`,
      [reportId, reviewerUserId, previousStatus, input.workflowStatus, input.reviewNote],
    );
    const review = inserted.rows[0];
    if (!review || !(review.created_at instanceof Date || typeof review.created_at === "string")) {
      throw new Error("The audit record could not be confirmed.");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return {
      report: { id: report.id, workflowStatus: report.workflow_status },
      review: {
        previousWorkflowStatus: review.previous_workflow_status,
        newWorkflowStatus: review.new_workflow_status,
        reviewerUserId: review.reviewer_user_id,
        reviewNote: review.review_note,
        createdAt: new Date(review.created_at).toISOString(),
      },
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
    throw new ReportError(503, "REVIEW_STORAGE_UNAVAILABLE", "The review update could not be confirmed. Please reload the report.");
  } finally {
    client?.release(destroyClient);
  }
}

/**
 * @param {{
 *   authenticate: (request: Request) => Promise<string> | string,
 *   update: (reportId: string, reviewerUserId: string, input: {workflowStatus: string, reviewNote: string | null}) => Promise<unknown>
 * }} dependencies
 */
export function createCoordinatorStatusHandler({ authenticate, update }) {
  /** @param {Request} request @param {string} reportId */
  return async function PATCH(request, reportId) {
    const headers = { "Cache-Control": "no-store" };
    try {
      const reviewerUserId = await authenticate(request);
      validateReportId(reportId);
      const input = await readReviewRequest(request);
      return Response.json(await update(reportId, reviewerUserId, input), { headers });
    } catch (error) {
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
  };
}
