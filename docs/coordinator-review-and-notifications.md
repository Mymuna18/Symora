# Coordinator review and participant follow-up API

These endpoints reuse the existing `reports` and `review_history` tables; no
migration or additional service is required. Coordinator identity and participant
identity come from `authenticateCoordinatorRequest` and
`authenticateParticipantRequest`, respectively. Both signed browser sessions and
the existing valid bearer-token clients remain supported.

All endpoints return `Cache-Control: no-store`; responses also vary on `Cookie`
and `Authorization`. Use relative URLs and `credentials: "same-origin"` from the
existing same-origin browser application. Do not send participant/coordinator IDs
or roles as identity input.

## Coordinator status update

`PATCH /api/coordinator/reports/{reportId}/status`

Cookie-authenticated PATCH requests must include the `X-Symora-CSRF: 1` header.
The browser supplies `Origin`; the server checks it against the configured
origin. Do not set `Origin` from JavaScript. Bearer-token clients continue to use
the existing bearer authentication behavior.

Mark a report reviewed:

```json
{"workflowStatus":"reviewed"}
```

Request follow-up (a note is required, trimmed, and limited to 1000 characters):

```json
{
  "workflowStatus":"follow_up_requested",
  "reviewNote":"Please clarify when your headache began."
}
```

Only those two fields are accepted. A request cannot choose a reviewer ID or
role. The API permits `submitted` → `reviewed` or `follow_up_requested`, and
`reviewed` → `follow_up_requested`. It rejects duplicate changes, transitions
out of `follow_up_requested`, and reports in `draft` or `closed`. The status
update and audit row are committed atomically. A concurrent request locks the
same report row and rechecks its current state after the lock is acquired.

Successful response (`200`), with values returned from PostgreSQL:

```json
{
  "report":{"id":"22222222-2222-4222-8222-222222222222","workflowStatus":"reviewed"},
  "review":{
    "previousWorkflowStatus":"submitted",
    "newWorkflowStatus":"reviewed",
    "reviewerUserId":"demo-coordinator",
    "reviewNote":null,
    "createdAt":"2026-10-11T09:00:00.000Z"
  }
}
```

For follow-up, `workflowStatus` and `newWorkflowStatus` are
`follow_up_requested`, and `reviewNote` contains the saved note.

Browser request example:

```js
const response = await fetch(
  `/api/coordinator/reports/${encodeURIComponent(report.id)}/status`,
  {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Symora-CSRF": "1",
    },
    body: JSON.stringify({ workflowStatus: "reviewed" }),
  },
);
const data = await response.json();
if (!response.ok) {
  // Keep the old badge; show data.error.message and let the user retry.
  throw new Error(data.error?.message ?? "The status could not be saved.");
}
// Only now update the report's displayed workflowStatus from data.report.
setReports((items) => items.map((item) =>
  item.id === data.report.id
    ? { ...item, workflowStatus: data.report.workflowStatus }
    : item
));
```

When saving, show a pending state and disable both status actions for that report
to prevent accidental duplicate clicks. On a non-2xx response, retain the
previous badge, show a clear error, and allow retry/reload; do not optimistically
show a saved status.

Errors use `{"error":{"code":"...","message":"..."}}`:

- `400 INVALID_REPORT_ID` or `400 INVALID_REVIEW_REQUEST` /
  `400 INVALID_REVIEW_NOTE`: invalid path or body.
- `401 UNAUTHORIZED`, `403 FORBIDDEN` / `403 CSRF_REJECTED`, or
  `503 COORDINATOR_AUTH_UNAVAILABLE`: authentication/authorization rejected or
  unavailable.
- `404 REPORT_NOT_FOUND`: no report has that UUID.
- `409 DUPLICATE_STATUS` or `409 INVALID_STATUS_TRANSITION`: status cannot be
  applied from the report's current state; refresh the dashboard.
- `413 PAYLOAD_TOO_LARGE` or `415 UNSUPPORTED_MEDIA_TYPE`: request format/size
  rejected.
- `503 REVIEW_STORAGE_UNAVAILABLE`: database operation did not commit; reload
  the report before retrying.
- `500 INTERNAL_ERROR`: unexpected safe error response.

## Participant follow-up messages

`GET /api/participant/notifications` returns at most the 100 newest follow-up
messages for the authenticated participant. The query joins reports to the
participant ID obtained from authentication; clients cannot supply a participant
ID to select another participant's records.

Example:

```json
{
  "notifications":[{
    "notificationId":"44444444-4444-4444-8444-444444444444",
    "reportId":"22222222-2222-4222-8222-222222222222",
    "message":"Please clarify when your headache began.",
    "createdAt":"2026-10-11T09:00:00.000Z"
  }]
}
```

Fetch with the browser session after dashboard login or refresh:

```js
const response = await fetch("/api/participant/notifications", {
  method: "GET",
  credentials: "same-origin",
  cache: "no-store",
});
const data = await response.json();
if (!response.ok) {
  showNotificationError(data.error?.message ?? "Messages could not be loaded.");
} else {
  setNotifications(data.notifications);
}
```

Messages become visible when the participant dashboard fetches this endpoint,
for example on page load or refresh. The backend does not push updates and the
frontend does not need polling; a participant who already has the page open will
see a new message on the next fetch/refresh. No email/SMS delivery, read receipt,
or notification acknowledgement is implemented. The response excludes reviewer
identity and unrelated report/participant details.

Errors use the same JSON shape: `401 UNAUTHORIZED`,
`403 FORBIDDEN`/`403 CSRF_REJECTED` (role/session failure), `503
DEMO_AUTH_UNAVAILABLE` or `503 BROWSER_AUTH_UNAVAILABLE` (auth configuration or
shared session storage unavailable), `503 NOTIFICATIONS_UNAVAILABLE` (database
read failed), and `500 INTERNAL_ERROR`.
