# Browser authentication for Symora's fictional demo

Owner: Elvin. This is the browser integration contract for Shrinika and the
authentication handoff for Anna. Existing bearer-token clients remain supported;
browser code must use these session endpoints instead of receiving bearer tokens.
No frontend or provider integration is replaced by this work.

## Deployment and configuration

Run the frontend and API on the **same origin**. Configure exactly one trusted
origin, including its scheme and nondefault port. Local example:
`http://localhost:3000`; deployment must use HTTPS. `localhost` and `127.0.0.1`
are different origins: choose one and open that URL consistently.
Use `npm run dev` for local HTTP. `npm run start` uses production cookie rules
and requires an HTTPS origin, normally provided by your deployment's TLS proxy.

These variables are server-only; never use a `NEXT_PUBLIC_` prefix:

```dotenv
SYMORA_BROWSER_AUTH_ENABLED=true
SYMORA_BROWSER_AUTH_ORIGIN=http://localhost:3000
SYMORA_BROWSER_SESSION_KEY=<generated canonical base64url encoding of 32 random bytes>
SYMORA_BROWSER_ACCOUNTS=<generated JSON array of configured demo accounts>
```

An account record has these exact fields:

```text
{
  username: lowercase [a-z0-9][a-z0-9_-]{2,63},
  role: "participant" or "coordinator",
  participantId: existing fictional participant UUID (participant only),
  coordinatorId: [A-Za-z0-9_-]{1,64} (coordinator only),
  passwordSalt: 32 hex characters (16 bytes),
  passwordHash: 128 hex characters (64 bytes),
  expiresAt: canonical UTC timestamp, YYYY-MM-DDTHH:mm:ss.SSSZ
}
```

Include only the identity field appropriate to the role. Password verification
uses scrypt with `N=16384`, `r=8`, `p=1`; do not invent hashes manually. Account
identity and role come exclusively from this configuration. Login bodies,
report bodies, query parameters, and role headers cannot choose another identity.

Safe manual provisioning, from the repository directory:

```sh
node scripts/provision-browser-auth.mjs \
  --participant-id REPLACE_WITH_EXISTING_FICTIONAL_PARTICIPANT_UUID \
  --origin http://localhost:3000
```

Replace the UUID placeholder with the approved fictional participant's actual
UUID. This command creates credentials locally; it does not access PostgreSQL,
read an environment file, or create a participant. It writes a fresh signing key,
salted password hashes, and separate randomly generated participant/coordinator
login passwords into private files in a new temporary directory. Directory mode
is `0700`; file mode is `0600`. It prints only the directory path, never passwords
or signing keys. Run this command yourself; it is not run automatically by the
application or during tests.

Privately open `server.env` and `logins.json` in the generated directory on your
Mac. `server.env` contains server settings; `logins.json` contains the generated
usernames and login passwords. Copy the server settings into
your private local environment configuration, or the deployment's server secret
settings, yourself; preserve all existing database/provider settings. Enter each
generated username and password into the corresponding demo login form when
needed. Do not paste secrets into chat, screenshots, shell arguments, or shared
documents. Do not commit the generated files. Delete only this generated
directory once configuration and secure credential handoff are complete.

Restart the server after changing configuration. Changing the browser auth
configuration or signing key invalidates existing browser sessions. Disabling
browser auth fails closed. Existing bearer clients continue to use their separate
`SYMORA_DEMO_AUTH_ENABLED` / `SYMORA_DEMO_PARTICIPANTS` and
`SYMORA_COORDINATOR_AUTH_ENABLED` / `SYMORA_COORDINATORS` settings. Browser
accounts do not require those bearer settings and never receive their tokens.

The existing private `DATABASE_URL` and `GEMINI_API_KEY` remain necessary for the
database and analysis features. This provisioning step neither reads nor changes
them. No live service or database test is authorized by running the provisioning
script.

Vercel deployments also require additive migration `002_browser_auth_state.sql`
before enabling browser auth. It creates `browser_auth_sessions` and
`rate_limit_buckets`; migration 001 is unchanged. The versioned migration runner
can preflight 002 with `node scripts/migrate-tigerdata.mjs --migration=002`.
Applying it requires a separately approved interactive execution using
`--migration=002 --execute --approve-migration=002` and the runner's exact target
confirmation. Do not run it as part of app startup or deployment automation.

## Login, session status, and logout

**Participant login:** `POST /api/auth/participant/login`.

**Coordinator login:** `POST /api/auth/coordinator/login`.

Both accept an uncompressed `application/json` body containing **only**:

```json
{"username":"demo-participant","password":"<entered privately by the user>"}
```

Use the actual generated username; the example is a shape, not a usable account.
The username must match the configured lowercase 3–64 character format; the
password must contain 1–256 characters. The complete body is limited to 2 KiB.
Do not include `role`, `participantId`, `coordinatorId`, or bearer tokens. A
coordinator credential cannot log in through the participant endpoint, and vice
versa. Successful login sets the HttpOnly session cookie and returns `200`:

```json
{
  "authenticated": true,
  "user": {"role": "participant", "username": "demo-participant"},
  "expiresAt": "2026-10-11T18:00:00.000Z"
}
```

Coordinator login has the same shape with `role: "coordinator"`. Timestamps are
illustrative; the server returns the actual expiry. The response contains no
participant UUID, coordinator identifier, session-cookie value, or bearer token.
The session lasts at most one hour and never outlasts its account's expiry.
Logging in replaces and revokes the browser's previous session, so one browser
cookie holds one active role. Use separate browser profiles for a simultaneous
participant/coordinator presentation.

**Session status:** `GET /api/auth/session`, no body. A valid session returns the
same authenticated shape shown above. Missing, invalid, revoked, or expired
sessions return `200` with:

```json
{"authenticated":false}
```

Absent/disabled/malformed required browser configuration returns `503`, which is
a setup problem rather than a successful logged-out status. This endpoint checks
the browser session; bearer-client identity is not a browser session.

**Logout:** `POST /api/auth/logout`, empty body. A successful `204` response has
no JSON body, expires the browser cookie, and revokes its server-side session.
Do not call `response.json()` for this response. Clear private UI state after it
succeeds. Logout does not revoke separately provisioned bearer credentials.

All authentication and protected API responses use `Cache-Control: no-store`
and vary on authentication headers/cookies. Never cache private responses in a
service worker or application persistence layer.

## Cookies and CSRF

Production uses `__Host-symora_session`; local HTTP development uses
`symora_session`. Cookies are signed and expiring, with `HttpOnly`, `SameSite=Lax`,
`Path=/`, no `Domain`, and `Secure` in production. JavaScript must never attempt
to read the cookie. Browser-managed cookies carry subsequent authentication.

For **every login, logout, and cookie-authenticated state-changing request**
(including POST and PATCH), send:

```text
X-Symora-CSRF: 1
```

For JSON requests also send `Content-Type: application/json`. The browser sends
its Origin automatically. The server requires that Origin to exactly match the
configured trusted origin and rejects cross-site fetch metadata. Do not set
`Origin` manually in frontend JavaScript. The custom header is a fixed CSRF
request marker, **not a secret, bearer token, or identity proof**. Cross-origin
frontend deployment is not supported by this demo contract; do not work around
CSRF failures by enabling permissive CORS.

Use `credentials: "same-origin"` and relative URLs throughout. Browser code must
not attach an Authorization header. If an Authorization header is present, the
backend deliberately selects the existing bearer mechanism and never falls back
to the session after an invalid bearer credential.

## Frontend fetch helpers

These examples assume user-entered credentials held only for the login request.
Do not embed a password in source, persist it in localStorage/sessionStorage, or
log credentials, requests, cookies, or private report data.

```js
async function apiJson(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "X-Symora-CSRF": "1" } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    // /api/analyze uses a string error; other APIs use {code,message,field?}.
    const message = typeof data?.error === "string"
      ? data.error : data?.error?.message ?? "The request could not be completed.";
    const error = new Error(message);
    error.status = response.status;
    error.code = typeof data?.error === "object" ? data.error.code : undefined;
    throw error;
  }
  return data;
}

// Called after the user submits the appropriate login form:
async function loginParticipant(username, password) {
  return apiJson("/api/auth/participant/login", {
    method: "POST", body: { username, password },
  });
}
async function loginCoordinator(username, password) {
  return apiJson("/api/auth/coordinator/login", {
    method: "POST", body: { username, password },
  });
}

const session = await apiJson("/api/auth/session");
// Choose the portal/dashboard from session.user.role only after authenticated=true.
// UI routing is convenience; each backend endpoint independently enforces its role.

async function logout() {
  await apiJson("/api/auth/logout", { method: "POST" });
  // Clear report/draft state and show the login screen.
}
```

## Participant workflow and unchanged payloads

A participant session authorizes `/api/analyze`, `/api/reports/prepare`, and
`/api/reports`. A coordinator session authorizes none of those participant routes.
No request needs or accepts a participant identity to select report ownership.

**1. Analyze original text.** `POST /api/analyze` accepts
`{transcript, language}`; language is `en`, `es`, `vi`, or `zh`. Transcript must be
nonblank and at most 5,000 characters; request-body limit is 50 KiB.

```js
const transcript = "For this fictional demo, I have a headache. I rate it 4 out of 10.";
const analysis = await apiJson("/api/analyze", {
  method: "POST", body: { transcript, language: "en" },
});
```

Successful `200` returns the analysis object directly. Example shape:

```json
{
  "language":"en",
  "english_translation":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
  "summary":"Participant reports headache.",
  "symptoms":[{"name":"headache","onset_text":null,"intensity":"4 out of 10","ongoing":null,"source_excerpt":"headache","verified_excerpt":true}],
  "medications_mentioned":[],
  "clarification":null,
  "requires_manual_review":false,
  "demo_fallback":false
}
```

Gemini wording is variable. A nonnull `clarification` contains `english` and
`participant_language` strings; show it for participant clarification. Resolve
`requires_manual_review` and unverified excerpts before submission.

**2. Prepare a review draft.** Pass the complete analysis response and the exact
original transcript to `POST /api/reports/prepare`:

```js
const prepared = await apiJson("/api/reports/prepare", {
  method: "POST", body: { source: "portal", transcript, analysis },
});
```

Use `source: "voice"` for text obtained through Anna's voice flow. The request
limit is 64 KiB, and the transcript limit is 5,000 characters. Successful `200`:

```json
{
  "draft":{
    "source":"portal","originalLanguage":"en",
    "originalTranscript":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
    "englishSummary":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
    "symptoms":[{"name":"headache","sourceExcerpt":"headache","evidenceVerified":true,"suggestedSymptomCode":"headache","mappingStatus":"suggested","unresolvedReason":null,"reportedIntensityText":"4 out of 10","onsetText":null,"ongoingCandidate":null}]
  },
  "symptomCatalog":[{"symptomCode":"headache","displayName":"Headache"}],
  "allSymptomsMapped":true,
  "requiresParticipantConfirmation":true
}
```

`symptomCatalog` actually includes all active catalog entries. Suggestions require
a unique display-name match after case/whitespace/Unicode normalization plus
verified original-transcript evidence. Unresolved symptoms remain in the draft
with a null suggested code and one of `unverified_transcript_evidence`,
`no_exact_catalog_match`, `ambiguous_catalog_match`, or `duplicate_catalog_code`.
Do not discard these symptoms or invent codes. Preserve the original description
and have the participant resolve the mapping. `englishSummary` currently takes
`analysis.english_translation`, not `analysis.summary`. Nothing is saved yet.

**3. Collect participant confirmation, then submit.** Build a separate body for
`POST /api/reports`; do not send the prepared draft unchanged. For the fictional
example below, the UI must first collect explicit confirmation of the symptom,
the numeric intensity, and the report itself:

```js
async function submitConfirmedReport(confirmedReport) {
  return apiJson("/api/reports", { method: "POST", body: confirmedReport });
}

// Call only from the participant's explicit confirmation action.
const confirmedReport = {
  workflowStatus: "submitted",
  confirmed: true,
  source: prepared.draft.source,
  originalLanguage: prepared.draft.originalLanguage,
  originalTranscript: prepared.draft.originalTranscript,
  englishSummary: prepared.draft.englishSummary,
  symptoms: [{
    symptomCode: "headache",       // Resolved active catalog code, confirmed by participant.
    reportedIntensity: 4,          // Explicitly participant-reported and confirmed; else null.
    onsetDate: null,
    ongoing: null,
    participantDescription: "headache",
  }],
};
```

The numeric `4` above illustrates this fictional confirmed statement; do not use
it as a default. Intensity is an integer from 0 through 10 or null, never clinical
severity. Do not translate adjectives such as "mild" into numbers. Dates must be
participant-confirmed `YYYY-MM-DD` or null; `ongoing` is boolean or null. Preserve
the participant's original symptom description, up to 2,000 characters, without
silently truncating longer draft excerpts.

The body requires `workflowStatus: "submitted"`, `confirmed: true`, source,
language, a nonblank transcript, and a symptoms array with at most 30 distinct
active catalog codes. `englishSummary` and symptom detail fields are optional or
nullable. Unknown fields, role/identity fields, clinical severity, unsupported
statuses, and malformed intensities are rejected. Successful `201`:

```json
{"report":{"id":"<server-generated UUID>","workflowStatus":"submitted","submittedAt":"<server UTC timestamp>","symptomCount":1}}
```

The server associates the authenticated participant, sets submission time, and
saves report/symptoms atomically. Disable duplicate submissions while pending.
Do not automatically retry a submission after an uncertain network failure:
creation has no idempotency key yet.

## Coordinator dashboard

Only a coordinator session may call
`GET /api/coordinator/reports?limit=20&offset=0`. It reads the actual configured
database; the frontend must display returned results rather than substitute
hardcoded demo rows. No CSRF header is required for this read:

```js
const page = await apiJson("/api/coordinator/reports?limit=20&offset=0");
const reports = page.reports;
// If page.pagination.hasMore, request its nextOffset with the same limit.
```

`limit` is 1–100 (default 20), `offset` is a nonnegative integer (default 0), and
their sum must be a safe JavaScript integer. Unknown/duplicate query parameters
are rejected. Successful `200`:

```json
{
  "reports":[{
    "id":"22222222-2222-4222-8222-222222222222",
    "participantCode":"DEMO-001",
    "source":"portal",
    "originalLanguage":"en",
    "originalTranscript":"I have a headache.",
    "englishSummary":"I have a headache.",
    "submittedAt":"2026-10-11T17:15:00.000Z",
    "workflowStatus":"submitted",
    "symptoms":[{"symptomCode":"headache","displayName":"Headache","reportedIntensity":null,"onsetDate":null,"ongoing":null,"participantDescription":"headache"}]
  }],
  "pagination":{"limit":20,"offset":0,"hasMore":false,"nextOffset":null}
}
```

Report states include `submitted`, `reviewed`, `follow_up_requested`, and `closed`;
drafts are excluded. Sorting is newest submission first, then report ID descending.
Empty results are `200` with `reports: []`. Unknown intensity is null, not zero;
symptoms can be empty. Inactive historical catalog entries remain visible. No
participant UUID is returned. This endpoint is read-only; there is no review or
status-update action in this milestone. Offset pages can shift as new reports
arrive.

## UI and error handling

On application start, show a loading state until session status resolves. Only
then choose the participant/coordinator view or login form. On logout or expired
session, clear private report/draft state and show login; do not retain another
user's data while switching accounts.

- `400`, `413`, `415`, `422`: request format, body size, or validation problem;
  show the safe server message and available field error.
- `401`: missing/invalid/expired authentication; return to the appropriate login.
  Failed login uses a generic response, without distinguishing unknown users.
- `403`: role mismatch, CSRF failure, or a participant unavailable for submission.
  Check the returned error and the selected role/origin; do not retry by supplying
  a participant ID or coordinator role.
- `429`: login/analysis rate limit; wait, honor `Retry-After` when present, and
  avoid automatic retry loops.
- `503`: configuration, catalog, or database temporarily unavailable; preserve
  unsent work in memory and show an availability/setup error rather than success.
- `500`, `502`, `504`: safe internal/provider errors; show retry controls for
  analysis. Do not automatically retry uncertain report creation.

New auth endpoints, report preparation/submission, and coordinator retrieval use
`{error:{code,message,field?}}`; not every error includes `field`. Analyze retains
its established `{error:"message"}` shape. Browser auth errors expose no password,
SQL, connection string, signing key, or provider internals.

Authentication error codes are `400 INVALID_LOGIN`, `413 PAYLOAD_TOO_LARGE`,
`415 UNSUPPORTED_MEDIA_TYPE`, `401 INVALID_CREDENTIALS` (login),
`401 UNAUTHORIZED` (protected session request), `403 FORBIDDEN` (wrong role),
`403 CSRF_REJECTED`, `429 LOGIN_RATE_LIMITED`, `503 BROWSER_AUTH_UNAVAILABLE`,
and `500 AUTH_FAILED`. Login rate limiting returns `Retry-After: 900`. A database
outage fails closed: browser-session checks, login, logout revocation, and shared
rate limiting return `503`; bearer-token authentication remains independent.
Logout with a missing or invalid cookie still clears it and returns `204` after
passing CSRF checks.

## Anna's future transcription endpoint

Leave Anna's route and provider code unchanged in this milestone. When she adds
authentication, import `authenticateParticipantRequest` and
`withPrivateResponse` from the backend request-auth helper, authenticate before
reading audio or calling ElevenLabs, and wrap all response paths with the private
response helper. The participant helper returns the server-authenticated UUID
and accepts the same browser session or existing participant bearer credential.
A cookie-authenticated transcription POST needs the same Origin and
`X-Symora-CSRF: 1` checks; its body may be multipart according to Anna's contract.
Never set multipart Content-Type manually when sending browser `FormData`.
Do not add a route runtime export. Coordinate Anna's final audio body/response
contract separately.

## Demo limitations and handoff checklist

Browser sessions and login/analysis rate buckets are stored in TigerData, so
revocation and fixed-window counters are shared across Vercel instances. Session
cookies remain signed locally; each cookie-authenticated request also checks its
hashed session ID and current account-configuration fingerprint in PostgreSQL.
Session identifiers and account/bucket identifiers are stored only as hashes.
Expired rows are cleaned up opportunistically in bounded batches during login;
expiration checks do not depend on cleanup.

Limits remain 30 login attempts per minute globally, five per configured account
per 15 minutes (including successes), at most four concurrent password checks
per Node process, and 120 analysis requests per minute globally. The concurrency
and fixed-window limits have per-instance/boundary tradeoffs and are demo abuse
controls, not complete production abuse prevention. Database failures intentionally
make browser auth and analysis unavailable rather than falling back to per-instance
state. Use TigerData's pooled connection endpoint; each warm Vercel instance caps
its PostgreSQL pool at two clients and database statements at five seconds, so
aggregate connections still depend on active instance count. Password reset, MFA,
registration, trial-scoped permissions, and automatic credential delivery are
outside this milestone.

Configured participant UUIDs must already identify approved fictional active
participants. Login/analyze/prepare do not query participant status; submission
does. Remove a withdrawn demo account from configuration to revoke its remaining
browser access. The coordinator can read all submitted reports in the configured
database across trials; the schema has no fictional-data flag. Use only the
team's fictional demo database/data.

Shrinika's next steps:

1. Add participant and coordinator login forms with transient password input.
2. Check `/api/auth/session` before showing private views; add logout.
3. Apply the same-origin fetch/CSRF contract to existing API calls.
4. Keep symptom clarification, mapping, and explicit participant confirmation in
   the portal before submission; never infer clinical severity.
5. Populate the coordinator dashboard from the paginated GET response and handle
   loading, empty results, expiry, and availability errors.
6. Test both role-isolation directions and logout with synthetic mocked sessions,
   then coordinate a separately authorized live fictional demo rehearsal.

This work does not run migrations, seed records, change database permissions, or
make live TigerData, Gemini, or ElevenLabs calls. Local tests prove application
behavior with mocks; deployed cookie behavior and provider/database availability
still require an explicitly authorized demo rehearsal.
