// @ts-check
import { ReportError } from "./report-errors.mjs";

/** @typedef {{limit: number, offset: number}} Pagination */

/** @param {Request} request @returns {Pagination} */
export function parsePagination(request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!["limit", "offset"].includes(key) || params.getAll(key).length !== 1) {
      throw new ReportError(400, "INVALID_PAGINATION", "Only one limit and one offset parameter are supported.");
    }
  }
  const limit = params.get("limit") ?? "20";
  const offset = params.get("offset") ?? "0";
  if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset)
    || !Number.isSafeInteger(Number(offset) + Number(limit))
    || Number(limit) < 1 || Number(limit) > 100) {
    throw new ReportError(400, "INVALID_PAGINATION", "limit must be an integer from 1 to 100; offset must be a nonnegative safe integer.");
  }
  return { limit: Number(limit), offset: Number(offset) };
}

/**
 * One read-only statement, paginating reports before collecting their symptoms.
 * No catalog active filter: historical reports retain their recorded symptoms.
 * @param {() => {query: Function}} getPool
 * @param {Pagination} pagination
 */
export async function listCoordinatorReports(getPool, { limit, offset }) {
  try {
    const result = await getPool().query(`
      WITH page AS (
        SELECT r.* FROM public.reports r
        WHERE r.workflow_status IN ('submitted', 'reviewed', 'follow_up_requested', 'closed')
          AND r.submitted_at IS NOT NULL
        ORDER BY r.submitted_at DESC, r.id DESC
        LIMIT $1 OFFSET $2
      )
      SELECT r.id, p.participant_code AS "participantCode", r.source,
        r.original_language AS "originalLanguage", r.original_transcript AS "originalTranscript",
        r.english_summary AS "englishSummary", r.submitted_at AS "submittedAt",
        r.workflow_status AS "workflowStatus",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'symptomCode', s.code, 'displayName', s.display_name,
          'reportedIntensity', rs.reported_intensity,
          'onsetDate', rs.onset_date, 'ongoing', rs.ongoing,
          'participantDescription', rs.participant_description
        ) ORDER BY s.code), '[]'::jsonb)
        FROM public.report_symptoms rs
        JOIN public.symptoms s ON s.id = rs.symptom_id
        WHERE rs.report_id = r.id) AS symptoms
      FROM page r
      JOIN public.participants p ON p.id = r.participant_id
      ORDER BY r.submitted_at DESC, r.id DESC
    `, [limit + 1, offset]);
    const hasMore = result.rows.length > limit;
    return {
      reports: result.rows.slice(0, limit),
      pagination: { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null },
    };
  } catch {
    throw new ReportError(503, "REPORTS_UNAVAILABLE", "Reports could not be retrieved. Please try again later.");
  }
}

/**
 * @param {{authenticate: (request: Request) => string | Promise<string>,
 * list: (pagination: Pagination) => Promise<unknown>}} dependencies
 */
export function createCoordinatorReportsHandler({ authenticate, list }) {
  /** @param {Request} request */
  return async function GET(request) {
    const headers = { "Cache-Control": "no-store", Vary: "Authorization" };
    try {
      const identity = await authenticate(request);
      if (!identity) throw new ReportError(401, "UNAUTHORIZED", "A valid coordinator bearer token is required.");
      return Response.json(await list(parsePagination(request)), { headers });
    } catch (error) {
      const failure = error instanceof ReportError ? error
        : new ReportError(500, "INTERNAL_ERROR", "The request could not be completed.");
      return Response.json({ error: { code: failure.code, message: failure.message } }, {
        status: failure.status,
        headers: { ...headers, ...(failure.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
      });
    }
  };
}
