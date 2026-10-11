// @ts-check
import { ReportError } from "./report-errors.mjs";

/**
 * Follow-up messages are derived from the existing review history and scoped
 * through the participant identity returned by server-side authentication.
 * @param {() => {query: (sql: string, values: unknown[]) => Promise<{rows: unknown[]}>}} getPool
 * @param {string} participantId
 */
export async function listParticipantNotifications(getPool, participantId) {
  try {
    const result = await getPool().query(
      `SELECT h.id AS "notificationId", h.report_id AS "reportId",
          h.review_note AS message, h.created_at AS "createdAt"
       FROM public.review_history h
       JOIN public.reports r ON r.id = h.report_id
       WHERE r.participant_id = $1
         AND h.action = 'status_changed'
         AND h.new_workflow_status = 'follow_up_requested'
         AND h.review_note IS NOT NULL
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 100`,
      [participantId],
    );
    return { notifications: result.rows };
  } catch {
    throw new ReportError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications could not be retrieved. Please try again later.");
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
