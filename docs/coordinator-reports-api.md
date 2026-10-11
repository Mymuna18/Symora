# Coordinator reports and review

`GET /api/coordinator/reports` is the demo-wide coordinator read endpoint. The
same authenticated coordinator can update statuses through the API documented in
[coordinator review and participant notifications](./coordinator-review-and-notifications.md).
No migration is needed; these endpoints use the existing database pool and
schema.

## Server configuration

Configure these server-only environment variables manually, then restart the
server. Never prefix them with `NEXT_PUBLIC_` or commit their values:

```dotenv
SYMORA_COORDINATOR_AUTH_ENABLED=true
SYMORA_COORDINATORS='[{"coordinatorId":"demo-coordinator","tokenSha256":"<64-character SHA-256 hex digest>","expiresAt":"<future UTC timestamp, e.g. YYYY-MM-DDTHH:mm:ss.SSSZ>"}]'
```

Each bearer coordinator must receive a **new** random token, separate from every
participant token. Generate at least 32 random bytes encoded as base64url; store
only its SHA-256 digest in the configuration. Identity comes from `coordinatorId`
in server configuration, never from a request role or participant ID. Canonical
UTC expiry is mandatory. Browser coordinator sessions are also supported when
the existing browser-auth configuration is enabled. Disable the applicable
authentication configuration or revoke the credential/session to remove access.
Missing/invalid configuration fails closed.

Optional local provisioning command (run manually): writes a fresh token and a
24-hour configuration to private temporary files, printing only their directory.
Copy the JSON into the server configuration yourself; import the token into a
local API client's private secret store, then delete these two temporary files.
Do not paste the token into chat, command history, logs, or screenshots.

```sh
node --input-type=module <<'NODE'
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'symora-coordinator-'));
const token = randomBytes(32).toString('base64url');
writeFileSync(join(directory, 'token.txt'), token, { mode: 0o600 });
writeFileSync(join(directory, 'config.json'), JSON.stringify([{
  coordinatorId: 'demo-coordinator',
  tokenSha256: createHash('sha256').update(token).digest('hex'),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}]), { mode: 0o600 });
console.log('Private provisioning files:', directory);
NODE
```

Send `Authorization: Bearer <coordinator-token>` from a trusted local API client
or server. Use HTTPS when deployed. Do not embed this bearer token in frontend
code, browser storage or public environment variables. The browser dashboard
uses the existing coordinator session and must not send bearer credentials.
Participant cookies/tokens alone cannot authorize coordinator routes.

## Contract for Shrinika

`GET /api/coordinator/reports?limit=20&offset=0`, no request body.
`limit`: integer 1–100, default 20. `offset`: nonnegative integer, default 0;
`offset + limit` must be a JavaScript safe integer. Duplicate or unknown query
parameters are rejected. There are no participant/status filters in this version.

Successful response (`200`):

```json
{
  "reports": [{
    "id": "22222222-2222-4222-8222-222222222222",
    "participantCode": "DEMO-001",
    "source": "voice",
    "originalLanguage": "en",
    "originalTranscript": "I feel dizzy.",
    "englishSummary": null,
    "submittedAt": "2026-10-10T12:00:00.000Z",
    "workflowStatus": "submitted",
    "symptoms": [{
      "symptomCode": "dizziness",
      "displayName": "Dizziness",
      "reportedIntensity": null,
      "onsetDate": null,
      "ongoing": true,
      "participantDescription": "I feel dizzy."
    }]
  }],
  "pagination": { "limit": 20, "offset": 0, "hasMore": false, "nextOffset": null }
}
```

Reports are ordered by submission time descending, then ID descending. Drafts
are excluded. Included states: `submitted`, `reviewed`, `follow_up_requested`,
`closed`. Source is `portal` or `voice`. Codes are returned exactly as stored;
this schema has no fictional-participant flag, so demo data must be provisioned
as fictional by the team. The coordinator can read all submitted reports in the
configured database, across trials; it is not a production tenant access model.

`reportedIntensity` is the participant's 0–10 value or null (unknown), never
clinical severity. `symptoms` can be empty; inactive catalog entries are retained
on historical reports. `onsetDate` is `YYYY-MM-DD` or null; `ongoing` is boolean
or null; `participantDescription` and `englishSummary` are string or null.
`submittedAt` is an ISO timestamp. No participant UUID or coordinator credential
is returned. Offset pages can shift if new reports arrive between requests.

Every response has `Cache-Control: no-store` and varies on `Cookie` and
`Authorization`. Empty
results return `200` with `reports: []`. Errors have
`{"error":{"code":"...","message":"..."}}`:

- `400 INVALID_PAGINATION`: unsupported/malformed query.
- `401 UNAUTHORIZED`: missing, invalid or expired coordinator token (Bearer challenge).
- `503 COORDINATOR_AUTH_UNAVAILABLE`: absent, disabled or malformed server configuration.
- `503 REPORTS_UNAVAILABLE`: database retrieval failed; no driver details are exposed.
- `500 INTERNAL_ERROR`: unexpected failure; no internal details are exposed.

Status changes and participant messages are documented in
[coordinator review and participant notifications](./coordinator-review-and-notifications.md).
Local verification uses mocks only; it does not verify SQL execution against
live TigerData or alter any database data.
