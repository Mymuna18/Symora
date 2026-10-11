# Fictional Symora backend demo

Owner: Elvin. This guide uses the merged backend and Muna's analyze route without
changing Gemini prompts, Anna's voice integration, or Shrinika's frontend.

## Minimum authentication setup

All three POST endpoints accept the same `Authorization: Bearer <token>` header:
`/api/analyze`, `/api/reports/prepare`, and `/api/reports`. The server stores only
the token's SHA-256 hash, associated participant UUID, and expiry. Identity is
never selected from the request body. Missing/expired tokens return 401;
disabled or malformed auth configuration returns 503.

This is a local API-client demo setup, not a browser login/session implementation.
Do not embed tokens in frontend code, localStorage, URLs, `NEXT_PUBLIC_*`
variables, shared API-client collections, request logs, or screenshots. For a
browser demo, coordinate a separate HttpOnly session and CSRF design with Shrinika.

1. Obtain the UUID of an **approved fictional participant** already in `participants`
   with `status = 'active'`. Do not use a real person's row. Token configuration
   alone does not create that row. If none exists, participant provisioning needs
   separate database-write approval; the catalog script below never creates one.
2. Generate a one-hour credential privately using the following manual command.
   Replace only the UUID placeholder. The command writes outside the repository
   in an owner-only directory, prints only that directory path, and never logs the
   bearer token. No database or environment file is accessed by this command.

```sh
node --input-type=module <<'NODE'
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const participantId = 'REPLACE_WITH_APPROVED_FICTIONAL_PARTICIPANT_UUID';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participantId)) {
  throw new Error('Set the approved fictional participant UUID first.');
}
const token = randomBytes(32).toString('base64url');
const entries = [{ participantId, tokenSha256: createHash('sha256').update(token).digest('hex'),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }];
const directory = mkdtempSync(join(tmpdir(), 'symora-private-demo-'));
chmodSync(directory, 0o700);
writeFileSync(join(directory, 'bearer-token.txt'), token, { mode: 0o600, flag: 'wx' });
writeFileSync(join(directory, 'server-auth.env'),
  `SYMORA_DEMO_AUTH_ENABLED=true\nSYMORA_DEMO_PARTICIPANTS='${JSON.stringify(entries)}'\n`,
  { mode: 0o600, flag: 'wx' });
console.log('Private files created in: ' + directory);
NODE
```

3. Privately copy the two settings from `server-auth.env` into your local
   `.env.local`. Merge participant entries if you already configured others;
   do not duplicate token hashes. Keep the array on one line, within single quotes.
   These are the required server-only variables:

```dotenv
SYMORA_DEMO_AUTH_ENABLED=true
SYMORA_DEMO_PARTICIPANTS='[{"tokenSha256":"<64-hex-generated-hash>","participantId":"<approved-fictional-UUID>","expiresAt":"<generated-UTC-expiry>"}]'
DATABASE_URL=<existing-private-TigerData-development-connection>
GEMINI_API_KEY=<privately-configured-Gemini-key>
```

   Keep your existing database configuration; do not replace it with placeholders.
   Require verified TLS in the connection (for example `sslmode=verify-full`).
   Optional `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` are server-only model names
   agreed with Muna; the route defaults to `gemini-2.5-flash` when neither is set.
   Do not rename any secret variable to `NEXT_PUBLIC_*`.
4. Import `bearer-token.txt` into your API client's **private local secret storage**
   with syncing, exports, and Authorization-header logging disabled. Set the
   Bearer authentication field from that secret for each endpoint. Never paste a
   real token into a shell command. Delete only the generated private directory
   after securely configuring the client and server; do not copy it into Git.
5. Start/restart the local backend manually from the repository:

```sh
npm run dev -- --hostname 127.0.0.1
```

   Next loads your local configuration. Changing the env file requires restarting
   the server. Revoke a participant token by removing its hash entry and restarting;
   set `SYMORA_DEMO_AUTH_ENABLED=false` to disable all demo authentication.

Analyze and prepare authenticate the configured token but do not check the
participant row's active status. Report submission does check it and returns 403
for an absent or withdrawn participant. Remove a token from configuration when
withdrawing/revoking a demo participant, so analyze/prepare access is also revoked.

## Catalog seed — implementation only; live execution awaits approval

The catalog is fixed and contains no diagnoses, intensity values, or patient data:

- `headache` — Headache
- `dizziness` — Dizziness
- `stomach_pain` — Stomach pain
- `nausea` — Nausea
- `fatigue` — Fatigue

Manual read-only preflight (not run by the agent):

```sh
node --env-file=.env.local scripts/seed-demo-catalog.mjs --preflight
```

Proposed write command **only after explicit seed approval**:

```sh
node --env-file=.env.local scripts/seed-demo-catalog.mjs --execute --approve-demo-catalog
```

Enter the expected development hostname, database `tsdb`, and, for execution,
`SEED SYMORA DEMO CATALOG`. The script contains no environment-file loader; Node
loads the local configuration only when you invoke it. Identity and verified TLS
are checked before catalog access. Default mode is read-only preflight.

Execution uses one transaction and a bounded lock on `public.symptoms`, reads only
matching catalog entries, and inserts missing rows with parameterized SQL and
`ON CONFLICT (code) DO NOTHING`. Matching active rows retain their IDs, timestamps,
and labels. Inactive codes, differently named codes, or another code with the same
normalized label cause rollback for review. Nothing is relabeled, reactivated,
deleted, or granted. A second successful run adds zero records. The script never
reads or writes participant/report rows. The lock is limited to 5 seconds and
each statement to 30 seconds. A lost commit response requires read-only inspection
before retrying; do not assume the transaction was rolled back.

## Endpoint contracts and confirmation

Use `Content-Type: application/json` plus the private bearer header throughout.
The examples below contain fictional text and no authentication credentials.

**1. POST /api/analyze** accepts `{transcript, language}`. Languages: `en`, `es`,
`vi`, `zh`; nonblank transcript up to 5,000 characters; body limit 50 KiB.

```json
{"transcript":"For this fictional demo, I have a headache. I rate it 4 out of 10.","language":"en"}
```

On 200, the response is the analysis object itself:

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

Gemini wording is variable; this is an illustrative shape, not a guaranteed exact
model response. Errors are `{ "error": "message" }` with statuses 400, 401, 413,
429, 500, 502, or 503. The route currently ignores extra request fields; they never
override authenticated identity. It has a per-process rate limit, not a per-user
distributed quota. Coordinate any analyze route changes with Muna. No live model
request was made during this development task.

**2. POST /api/reports/prepare** accepts `{source, transcript, analysis}` where
source is `portal` or `voice`, transcript is the original text, and analysis is the
full analyze response. Body limit 64 KiB; transcript limit 5,000 characters.
On 200 it returns:

```json
{
  "draft":{
    "source":"portal","originalLanguage":"en",
    "originalTranscript":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
    "englishSummary":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
    "symptoms":[{"name":"headache","sourceExcerpt":"headache","evidenceVerified":true,
      "suggestedSymptomCode":"headache","mappingStatus":"suggested","unresolvedReason":null,
      "reportedIntensityText":"4 out of 10","onsetText":null,"ongoingCandidate":null}]
  },
  "symptomCatalog":[{"symptomCode":"headache","displayName":"Headache"}],
  "allSymptomsMapped":true,"requiresParticipantConfirmation":true
}
```

`symptomCatalog` contains **all active catalog entries**, so it will include all
five labels after seeding. Matching is a unique exact display-name match after
case/whitespace/Unicode normalization, with independently checked transcript
evidence. Synonyms such as "stomachache" or "abdominal discomfort" do not silently
become `stomach_pain`. Unmapped, duplicate, or ambiguous symptoms remain in the draft
with `suggestedSymptomCode: null` and an unresolved reason. No data is saved here.
Keep the original transcript and resolve every symptom with the participant.

`englishSummary` currently uses `analysis.english_translation`, **not**
`analysis.summary`. Numeric intensity and dates are not inferred. Prepare errors
use `{error:{code,message,field?}}` with 400, 401, 413, 415, 422, 500, or 503.

**3. POST /api/reports** accepts a separately constructed, participant-confirmed
request. The draft is not itself a valid submission body:

```json
{
  "workflowStatus":"submitted","confirmed":true,"source":"portal","originalLanguage":"en",
  "originalTranscript":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
  "englishSummary":"For this fictional demo, I have a headache. I rate it 4 out of 10.",
  "symptoms":[{"symptomCode":"headache","reportedIntensity":4,"onsetDate":null,"ongoing":null,"participantDescription":"headache"}]
}
```

Only use `4` if explicitly confirmed by the fictional participant; never convert
"mild", "moderate", or "severe" into a number. Unknown details stay null. Do not
send participantId, role, Gemini metadata, evidence flags, or clinical severity.
Resolve clarification and manual-review flags in the caller before submission.
Descriptions have a 2,000-character limit even though prepare accepts excerpts up
to 5,000; choose a confirmed supporting excerpt without silently truncating text.

On 201:

```json
{"report":{"id":"<server-generated UUID>","workflowStatus":"submitted","submittedAt":"<server UTC timestamp>","symptomCount":1}}
```

The report and symptom links are saved atomically. This endpoint supports only
submitted reports, requires a nonblank transcript, allows at most 30 distinct
active catalog codes, and preserves participant-reported intensity (integer 0–10
or null). It uses `{error:{code,message,field?}}`; see
[the submission contract](report-submission-api.md) for all statuses and limits.
Do not automatically retry an uncertain submission: report creation is not
idempotent yet.

## Remaining demo dependencies

- Approve and manually execute the catalog seed after reviewing its preflight.
- Confirm/provision one active fictional participant under separate write approval,
  then configure expiring authentication and the server's private Gemini key.
- Test live Gemini only when authorized; model access, billing and actual output
  quality cannot be established by mocks.
- Complete caller-side confirmation/mapping with Muna, Anna and Shrinika. The
  prepare response does not automatically become a submitted report.
- There is no GET report route/coordinator retrieval API in this branch. The
  submission response returns an ID, but a full retrieve-and-review demo needs a
  separately scoped, authorized read API (or separately approved read-only database
  verification). A request to GET `/api/reports` is not supported.
- Browser sessions and cross-instance rate limits remain separate work. Muna should
  apply `Cache-Control: no-store` consistently to analyze responses before browser
  deployment; prepare/reports already do so. No permission changes for `muna_dev`.

## Local verification (no environment file or live services)

```sh
node --test tests/*.test.mjs
node scripts/run-tests.mjs
npm run lint
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The second command is the existing analyze test runner, which replaces Gemini
and NextResponse with mocks. The new workflow tests import all three actual
App Router POST exports with mocked database/SDK dependencies and prohibit fetch.
No Docker integration suite needs to be repeated for this task.
