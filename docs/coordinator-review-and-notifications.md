# Coordinator review and participant follow-up API

Coordinator status updates reuse the existing `reports` and `review_history`
tables. Participant responses and daily reminder de-duplication require additive
migration 003. Coordinator identity and participant identity come from `authenticateCoordinatorRequest` and
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

`GET /api/participant/notifications` returns up to 100 newest notification events
for the authenticated participant: reviewed events, saved follow-up requests,
and the current day's in-app reminder when due. The query joins reports to the
participant ID obtained from authentication; clients cannot supply a participant
ID to select another participant's records.

Example:

```json
{
  "notifications":[{
    "notificationId":"44444444-4444-4444-8444-444444444444",
    "reportId":"22222222-2222-4222-8222-222222222222",
    "message":"Your symptom report has been reviewed by the study team. Thank you for submitting your report.",
    "createdAt":"2026-10-11T09:00:00.000Z",
    "notificationType":"reviewed",
    "participantResponse":null,
    "responseUpdatedAt":null
  },{
    "notificationId":"55555555-5555-4555-8555-555555555555",
    "reportId":"22222222-2222-4222-8222-222222222222",
    "message":"Please clarify when your headache began.",
    "createdAt":"2026-10-12T09:00:00.000Z",
    "notificationType":"follow_up_requested",
    "participantResponse":"will_schedule_later",
    "responseUpdatedAt":"2026-10-12T10:00:00.000Z"
  },{
    "notificationId":"reminder:22222222-2222-4222-8222-222222222222:2026-10-13",
    "reportId":"22222222-2222-4222-8222-222222222222",
    "message":"Reminder: Please schedule your follow-up appointment with the study team.",
    "createdAt":"2026-10-13T00:00:00.000Z",
    "notificationType":"follow_up_reminder",
    "participantResponse":"will_schedule_later",
    "responseUpdatedAt":"2026-10-12T10:00:00.000Z"
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

The participant page fetches on verified login and whenever the Notification
Center opens. Messages become visible on that fetch or a refresh; no polling or
push delivery is used. Daily reminders use UTC calendar dates, are inserted
idempotently at most once per report per day, and begin the day after the
participant records `will_schedule_later`. They are shown only when the
participant next opens or refreshes the Notification Center. No email, SMS,
background delivery, read receipt, or notification acknowledgement is
implemented. Reviewed-message copy confirms only that a review occurred; it does
not imply medical clearance or health status. The response excludes reviewer
identity and unrelated report/participant details.

### Participant follow-up response

`POST /api/participant/follow-up-response` accepts exactly a report ID and the
participant's self-reported choice. It requires the authenticated participant
session (or existing supported bearer credential). Cookie-authenticated requests
must include `X-Symora-CSRF: 1`; the server validates the request Origin.

```json
{"reportId":"22222222-2222-4222-8222-222222222222","response":"will_schedule_later"}
```

or:

```json
{"reportId":"22222222-2222-4222-8222-222222222222","response":"appointment_scheduled"}
```

The response is `{"reportId":"...","response":"appointment_scheduled","respondedAt":"2026-10-13T10:00:00.000Z"}`.
Repeated identical submissions are idempotent. A saved `will_schedule_later`
choice can be changed to `appointment_scheduled`; a completed choice cannot be
reverted. The report must belong to the authenticated participant and have a
persisted follow-up request. “Appointment Scheduled” records only the
participant's statement; Symora does not book or create calendar events.

```js
const response = await fetch("/api/participant/follow-up-response", {
  method: "POST",
  credentials: "same-origin",
  cache: "no-store",
  headers: {
    "Content-Type": "application/json",
    "X-Symora-CSRF": "1",
  },
  body: JSON.stringify({ reportId, response: "appointment_scheduled" }),
});
const data = await response.json();
if (!response.ok) {
  showResponseError(data.error?.message ?? "Your response could not be saved.");
} else {
  // Refresh the Notification Center only after the server confirms the save.
  await loadNotifications();
}
```

Errors use `{"error":{"code":"...","message":"..."}}`: `400 INVALID_RESPONSE`,
`401 UNAUTHORIZED`, `403 FORBIDDEN`/`403 CSRF_REJECTED`, `404 REPORT_NOT_FOUND`,
`409 FOLLOW_UP_NOT_FOUND`, `409 FOLLOW_UP_ALREADY_COMPLETED`, `413
PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `503
FOLLOW_UP_RESPONSE_UNAVAILABLE`, and `500 INTERNAL_ERROR`.

### Migration 003

Apply `db/migrations/003_participant_follow_up_responses.sql` only after explicit
database-migration approval. It adds participant response state and daily
reminder event tables, with a unique `(report_id, reminder_date)` key to prevent
duplicate reminders. The runner verifies the existing 001 and 002 schema before
preflight or execution. Preflight remains read-only:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --migration=003 --preflight
```

After separate approval only, execution requires both flags and an interactive
confirmation of `APPLY SYMORA 003 TO tsdb.public`:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --migration=003 --execute --approve-migration=003
```

Migration SHA-256:
`da3893a28c406eda97a5abf6a960ab8b30cf4f6b4b7583f7c60a7bdb44b421a0`.

Errors use the same JSON shape: `401 UNAUTHORIZED`,
`403 FORBIDDEN`/`403 CSRF_REJECTED` (role/session failure), `503
DEMO_AUTH_UNAVAILABLE` or `503 BROWSER_AUTH_UNAVAILABLE` (auth configuration or
shared session storage unavailable), `503 NOTIFICATIONS_UNAVAILABLE` (database
read failed), and `500 INTERNAL_ERROR`.
