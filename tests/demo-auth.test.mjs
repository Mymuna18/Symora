import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticateDemoParticipant } from "../lib/demo-auth.mjs";
import { authConfig, now, participantId, request, token } from "./report-fixtures.mjs";

test("authentication resolves identity from a server token hash", () => {
  assert.equal(authenticateDemoParticipant(request({ participantId: "forged", role: "coordinator" }), authConfig, () => now), participantId);
});

for (const authorization of ["", "Basic abcd", "Bearer short", `Bearer ${"z".repeat(43)}`, `Bearer ${token}, Bearer ${token}`]) {
  test(`rejects missing, malformed, or unrecognized credentials: ${authorization.slice(0, 12)}`, () => {
    assert.throws(() => authenticateDemoParticipant(request({}, { authorization }), authConfig, () => now), (e) => e.status === 401);
  });
}

test("expired token is rejected at the exact expiry boundary", () => {
  assert.throws(() => authenticateDemoParticipant(request(), authConfig, () => now + 3_600_000), (e) => e.status === 401);
});

for (const label of ["disabled", "missing", "malformed", "empty", "bad hash", "bad identity", "missing expiry", "bad expiry", "duplicate hash", "unknown setting"]) {
  test(`authentication fails closed with ${label} configuration`, () => {
    const config = authConfig();
    const entries = JSON.parse(config.participants);
    switch (label) {
      case "disabled": config.enabled = "false"; break;
      case "missing": delete config.participants; break;
      case "malformed": config.participants = "{"; break;
      case "empty": config.participants = "[]"; break;
      case "bad hash": entries[0].tokenSha256 = "not-a-hash"; break;
      case "bad identity": entries[0].participantId = "not-a-uuid"; break;
      case "missing expiry": delete entries[0].expiresAt; break;
      case "bad expiry": entries[0].expiresAt = "2026-02-30T00:00:00.000Z"; break;
      case "duplicate hash": entries.push({ ...entries[0], tokenSha256: entries[0].tokenSha256.toUpperCase() }); break;
      case "unknown setting": entries[0].role = "admin"; break;
    }
    if (["bad hash", "bad identity", "missing expiry", "bad expiry", "duplicate hash", "unknown setting"].includes(label)) config.participants = JSON.stringify(entries);
    assert.throws(() => authenticateDemoParticipant(request(), () => config, () => now), (e) => e.status === 503 && !e.message.includes(token));
  });
}
