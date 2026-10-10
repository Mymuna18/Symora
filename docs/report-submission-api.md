# Report submission API — proposed integration contract

Owner: Elvin. This adds backend submission only. No Gemini, ElevenLabs, frontend,
coordinator, draft-saving, login, or catalog-management features are implemented.

## Request

`POST /api/reports` with `Content-Type: application/json` and
`Authorization: Bearer <privately provisioned participant token>`.

```json
{
  "workflowStatus": "submitted",
  "confirmed": true,
  "source": "voice",
  "originalLanguage": "es",
  "originalTranscript": "Tengo dolor de cabeza. Lo calificaría con un cuatro de diez.",
  "englishSummary": "The participant reports a headache with a self-reported intensity of 4 out of 10.",
  "symptoms": [
    {
      "symptomCode": "headache",
      "reportedIntensity": 4,
      "onsetDate": null,
      "ongoing": null,
      "participantDescription": "Tengo dolor de cabeza. Lo calificaría con un cuatro de diez."
    }
  ]
}
```

`headache` is an illustrative code, not a claim that the shared database has that
entry. The team must agree on the catalog before a live integration test.

- Required: workflowStatus, confirmed, source, originalLanguage,
  originalTranscript, symptoms. This endpoint accepts only `submitted` and
  `confirmed: true`. It never accepts draft or coordinator review statuses.
- Source is `portal` or `voice`; language is a valid BCP 47 tag, at most 35 characters.
- Original transcript is nonblank, at most 20,000 characters, and preserved exactly.
  Original symptom descriptions are also preserved exactly (at most 2,000 characters).
- English summary is optional or null; when supplied it must be nonblank and at most
  10,000 characters. It is AI-generated/translated text, not the original statement.
- Symptoms is required but may be empty; maximum 30 distinct catalog codes. Codes
  are case-sensitive, 1–64 characters, start with a letter or digit, and contain
  only letters, digits, underscores, or hyphens.
- Intensity is optional/null or an integer from 0 to 10, stated by the participant.
  Numeric strings, fractions, inferred medical severity, and severity fields are
  rejected. The backend cannot independently establish the provenance of a number:
  Muna must extract only stated values and the participant must confirm them.
- Onset is optional/null or a real `YYYY-MM-DD` date. Ongoing is optional/null or a
  boolean. Unknown details stay null; relative dates need an agreed timezone rule.
- All unlisted fields are rejected, including participantId, participantCode, role,
  submittedAt, severity, raw model metadata, missingInformation, and clarificationQuestion.
  Keep model follow-up metadata in the extraction/confirmation flow until it is resolved.
- The entire uncompressed UTF-8 JSON body is limited to 64 KiB, including streamed bodies.
  Null characters in text are rejected because PostgreSQL text cannot store them.

## Success

`201 Created`, with `Cache-Control: no-store`:

```json
{
  "report": {
    "id": "22222222-2222-4222-8222-222222222222",
    "workflowStatus": "submitted",
    "submittedAt": "2026-10-10T12:00:00.000Z",
    "symptomCount": 1
  }
}
```

The server establishes participant identity, checks active participation, fixes
the status to submitted, and sets the timestamp using PostgreSQL NOW(). Report
and symptom rows use parameterized queries and one checked-out transaction client.
The response does not assert that any clinical staff received or reviewed the report.

## Errors and mapping behavior

```json
{
  "error": {
    "code": "UNKNOWN_SYMPTOM",
    "message": "This symptom code does not match an active catalog entry. Keep the original description and resolve the mapping before resubmitting.",
    "field": "symptoms[0].symptomCode"
  }
}
```

- 400 INVALID_JSON: missing, malformed, or invalid UTF-8 JSON.
- 401 UNAUTHORIZED: missing, invalid, or expired participant token.
- 403 PARTICIPANT_UNAVAILABLE: participant is absent or withdrawn.
- 413 PAYLOAD_TOO_LARGE: request exceeds 64 KiB.
- 415 UNSUPPORTED_MEDIA_TYPE: non-JSON or compressed input.
- 422 VALIDATION_ERROR: unsupported fields or invalid values; field identifies the location.
- 422 UNKNOWN_SYMPTOM: first unknown/inactive code, identified by array index.
- 503 DEMO_AUTH_UNAVAILABLE: demo authentication disabled or misconfigured.
- 503 REPORT_STORAGE_UNAVAILABLE: connection, query, or transaction failure.
- 500 INTERNAL_ERROR: unexpected failure; no internal details are returned.

No symptoms are silently discarded and no catalog entries or codes are invented.
An unknown/inactive code rejects the whole submission. The original text is not
persisted on an unsuccessful submission: Anna/Shrinika's caller must retain the
original transcript and descriptions for correction and resubmission. This endpoint
does not yet provide a queue for unmapped symptoms.

Submissions are not idempotent. Do not automatically retry after a timeout or uncertain
commit result; a lost response can occur after the database committed successfully.

## Protected local demo authentication

Authentication defaults to disabled. No credentials were generated or configured
by this implementation. No existing environment values were read during development.

Before a separately approved live test, configure these server-only variables:

- `SYMORA_DEMO_AUTH_ENABLED`: exactly `true`.
- `SYMORA_DEMO_PARTICIPANTS`: JSON array (1–100 entries), each containing only
  `tokenSha256` (64 hexadecimal characters), `participantId` (UUID), and `expiresAt`
  (UTC timestamp such as `2026-10-10T13:00:00.000Z`).
- `DATABASE_URL`: existing database configuration; do not expose it to callers.

Provision separate random tokens with at least 32 cryptographically random bytes,
base64url-encoded. Configure only their SHA-256 hashes on the server; distribute
the raw tokens privately to the intended test participants, with short expirations
(for example one hour). Revoke a token by removing its hash from configuration.
Every request checks expiration. No shared coordinator/admin token or client-selected
role is supported. Tokens are 43–128 base64url characters and compared by hash using
constant-time comparison.

Never put raw tokens in source code, URLs, browser bundles, localStorage, public
`NEXT_PUBLIC_*` variables, logs, committed files, or exported API-client collections.
Use private API-client secret storage for authorized local tests; do not paste secrets
into shell history. Use HTTPS outside localhost. The endpoint accepts only an explicit
Authorization header, not cookies or participant identity from the request body.

This is currently a manually provisioned API testing flow. Browser integration needs
a separately agreed short-lived session/login design (for example an HttpOnly session
cookie with appropriate CSRF protection). Do not solve frontend integration by embedding
these bearer tokens in Shrinika's code. No login/session endpoints are included here.

## Local validation

From the repository root:

```sh
node --test tests/*.test.mjs
npm run lint
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The tests inject synthetic authentication configuration and mock the PostgreSQL
client. They do not load environment files or open database connections. Route tests
exercise the same handler factory, validator, authentication, and transaction logic
used by the Next.js export. Schema tests remain static. No migration, seed, network
request, or running Next.js server is part of this test suite.

## Questions for integration

1. Muna: agree on catalog codes and the explicit mapping from Gemini symptom names;
   should unmapped symptoms block confirmation or use a future review queue?
2. Anna and Shrinika: agree on the final transcript/description fields and confirmation
   moment; retain user text whenever submission fails.
3. Team: choose the browser's short-lived session flow and provision fictional
   participants privately before any live demo.
4. Muna and Elvin: agree on onset timezone/relative-date handling and repeated symptoms
   within one report (the current schema allows one entry per catalog symptom).
