import { createHash } from "node:crypto";

export const participantId = "11111111-1111-4111-8111-111111111111";
export const reportId = "22222222-2222-4222-8222-222222222222";
// Deliberately synthetic test credential. Never configured in a real environment.
export const token = "synthetic_test_credential_".padEnd(43, "x");
export const now = Date.parse("2026-10-10T12:00:00.000Z");
export function authConfig() {
  return { enabled: "true", participants: JSON.stringify([{
    tokenSha256: createHash("sha256").update(token).digest("hex"),
    participantId,
    expiresAt: "2026-10-10T13:00:00.000Z",
  }]) };
}

export function payload() {
  return {
    workflowStatus: "submitted", confirmed: true, source: "voice",
    originalLanguage: "es", originalTranscript: "  Tengo dolor de cabeza.\n",
    englishSummary: "The participant reports a headache.",
    symptoms: [{ symptomCode: "headache", reportedIntensity: 4, onsetDate: "2026-10-09", ongoing: true, participantDescription: "  dolor de cabeza\n" }],
  };
}

export function request(body = payload(), headers = {}) {
  return new Request("http://localhost/api/reports", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function database({ failAt, rollbackFails = false, active = true, codes = ["headache", "nausea"] } = {}) {
  const calls = [];
  const released = [];
  let count = 0;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      count += 1;
      if (count === failAt || (rollbackFails && sql === "ROLLBACK")) throw new Error("PRIVATE_SQL_AND_PASSWORD");
      if (sql.startsWith("SELECT id FROM participants")) return { rows: active ? [{ id: participantId }] : [] };
      if (sql.startsWith("SELECT id, code FROM symptoms")) return { rows: codes.map((code, index) => ({ code, id: `catalog-${index}` })) };
      if (sql.startsWith("INSERT INTO reports")) return { rows: [{ id: reportId, submitted_at: new Date(now) }] };
      return { rows: [] };
    },
    release(destroy) { released.push(destroy); },
  };
  let connections = 0;
  return {
    getPool: () => ({ async connect() { connections += 1; return client; } }),
    calls, released, client, get connections() { return connections; },
  };
}
