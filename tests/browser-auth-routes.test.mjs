import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

const participantId = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";
const password = "fictional-test-password-only";
const salt = "ab".repeat(16);
const passwordHash = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
const origin = "http://localhost:3000";
const transcript = "I have a headache. I rate it 4 out of 10.";
const analysis = { language: "en", english_translation: transcript, summary: "Participant reports headache.",
  symptoms: [{ name: "headache", onset_text: null, intensity: "4 out of 10", ongoing: null, source_excerpt: "headache" }],
  medications_mentioned: [], clarification: null };
const moduleUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@google/genai") return { shortCircuit: true, url: moduleUrl(`
    export const Type = {OBJECT:'OBJECT',STRING:'STRING',ARRAY:'ARRAY',BOOLEAN:'BOOLEAN'};
    export class GoogleGenAI { constructor() { this.models = { generateContent: async () => {
      globalThis.__browserWorkflow.providerCalls++; return {text: JSON.stringify(globalThis.__browserWorkflow.analysis)};
    }}; }}
  `) };
  if (specifier === "./db.mjs" || specifier.endsWith("/lib/db.mjs")) return { shortCircuit: true,
    url: moduleUrl("export const getPool = () => globalThis.__browserWorkflow.pool;") };
  return nextResolve(specifier, context);
} });
globalThis.fetch = async () => { throw new Error("Network forbidden in browser auth tests."); };

const loginParticipant = (await import("../app/api/auth/participant/login/route.ts")).POST;
const loginCoordinator = (await import("../app/api/auth/coordinator/login/route.ts")).POST;
const session = (await import("../app/api/auth/session/route.ts")).GET;
const logout = (await import("../app/api/auth/logout/route.ts")).POST;
const analyze = (await import("../app/api/analyze/route.ts")).POST;
const prepare = (await import("../app/api/reports/prepare/route.ts")).POST;
const submit = (await import("../app/api/reports/route.ts")).POST;
const coordinator = (await import("../app/api/coordinator/reports/route.ts")).GET;

function request(path, body, cookie, overrides = {}, method = "POST") {
  return new Request(`${origin}${path}`, { method,
    headers: { origin, "x-symora-csrf": "1", "content-type": "application/json",
      ...(cookie ? { cookie } : {}), ...overrides },
    ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function login(role, cookie) {
  const response = await (role === "participant" ? loginParticipant : loginCoordinator)(
    request(`/api/auth/${role}/login`, { username: `demo-${role}`, password }, cookie));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /password|participantId|passwordHash|tokenSha256|symora_session/);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

beforeEach(() => {
  process.env.SYMORA_BROWSER_AUTH_ENABLED = "true";
  process.env.SYMORA_BROWSER_AUTH_ORIGIN = origin;
  process.env.SYMORA_BROWSER_SESSION_KEY = Buffer.alloc(32, 7).toString("base64url");
  process.env.SYMORA_BROWSER_ACCOUNTS = JSON.stringify(["participant", "coordinator"].map((role) => ({
    role, username: `demo-${role}`, passwordSalt: salt, passwordHash,
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...(role === "participant" ? { participantId } : { coordinatorId: "demo-coordinator" }),
  })));
  process.env.GEMINI_API_KEY = "fictional-key-only";
  const state = { analysis, providerCalls: 0, sql: [], sessions: new Map(), rateLimits: new Map(), pool: null };
  const query = async (sql, values) => {
    state.sql.push({ sql, values });
    if (sql.includes("SELECT account_key_hash") && sql.includes("FROM browser_auth_sessions")) {
      const row = state.sessions.get(values[0]);
      return { rows: row && row.expires > Date.now() ? [{
        account_key_hash: row.accountKeyHash, role: row.role,
        config_fingerprint: row.configFingerprint, expires_ms: String(row.expires),
      }] : [] };
    }
    if (sql.includes("INSERT INTO rate_limit_buckets")) {
      const [scope, hash, windowMs, cap] = values;
      const key = `${scope}:${hash}`;
      let bucket = state.rateLimits.get(key);
      if (!bucket || bucket.expires <= Date.now()) bucket = { attempts: 0, expires: Date.now() + windowMs };
      bucket.attempts = Math.min(bucket.attempts + 1, cap);
      state.rateLimits.set(key, bucket);
      return { rows: [{ attempts: bucket.attempts, expires_at: new Date(bucket.expires) }] };
    }
    if (sql.includes("DELETE FROM browser_auth_sessions") && values?.length) state.sessions.delete(values[0]);
    if (sql.includes("WITH page")) return { rows: [{ id: reportId, participantCode: "DEMO-001", workflowStatus: "submitted", symptoms: [] }] };
    if (sql.includes("SELECT code, display_name")) return { rows: [{ code: "headache", display_name: "Headache" }] };
    if (sql.includes("FROM participants")) return { rows: [{ id: participantId }] };
    if (sql.includes("SELECT id, code FROM symptoms")) return { rows: [{ id: "33333333-3333-4333-8333-333333333333", code: "headache" }] };
    if (sql.includes("INSERT INTO reports")) return { rows: [{ id: reportId, submitted_at: new Date("2026-10-11T12:00:00.000Z") }] };
    return { rows: [] };
  };
  state.pool = { query, connect: async () => ({ query, release() {} }) };
  state.pool.connect = async () => ({
    query: async (sql, values = []) => {
      state.sql.push({ sql, values });
      if (sql.includes("DELETE FROM browser_auth_sessions")) state.sessions.delete(values[0]);
      if (sql.includes("INSERT INTO browser_auth_sessions")) state.sessions.set(values[0], {
        accountKeyHash: values[1], role: values[2], configFingerprint: values[3],
        expires: new Date(values[5]).getTime(),
      });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
        || sql.includes("INSERT INTO browser_auth_sessions")
        || sql.includes("DELETE FROM browser_auth_sessions")) return { rows: [] };
      return query(sql, values);
    },
    release() {},
  });
  globalThis.__browserWorkflow = state;
});

test("actual cookie login -> analyze -> prepare -> confirm/save -> logout -> coordinator retrieval", async () => {
  const cookie = await login("participant");
  const status = await session(request("/api/auth/session", undefined, cookie, {}, "GET"));
  assert.equal((await status.json()).user.role, "participant");
  const analyzed = await analyze(request("/api/analyze", { transcript, language: "en" }, cookie));
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.headers.get("cache-control"), "no-store");
  assert.match(analyzed.headers.get("vary"), /Cookie/);
  const prepared = await prepare(request("/api/reports/prepare", { source: "portal", transcript, analysis: await analyzed.json() }, cookie));
  assert.equal(prepared.status, 200);
  const { draft } = await prepared.json();
  const submitted = await submit(request("/api/reports", {
    source: draft.source, originalLanguage: draft.originalLanguage, originalTranscript: draft.originalTranscript,
    englishSummary: draft.englishSummary, workflowStatus: "submitted", confirmed: true,
    symptoms: [{ symptomCode: draft.symptoms[0].suggestedSymptomCode, reportedIntensity: 4,
      onsetDate: null, ongoing: null, participantDescription: draft.symptoms[0].sourceExcerpt }],
  }, cookie, { "x-participant-id": "forged", "x-role": "coordinator" }));
  assert.equal(submitted.status, 201, await submitted.clone().text());
  assert.equal((await submitted.json()).report.id, reportId);
  assert.equal(globalThis.__browserWorkflow.sql.find(({ sql }) => sql.includes("INSERT INTO reports")).values[0], participantId);
  assert.equal((await logout(request("/api/auth/logout", undefined, cookie))).status, 204);
  assert.equal((await analyze(request("/api/analyze", {}, cookie))).status, 401);
  const coordinatorCookie = await login("coordinator");
  const retrieved = await coordinator(request("/api/coordinator/reports", undefined, coordinatorCookie, {}, "GET"));
  assert.equal(retrieved.status, 200);
  assert.equal((await retrieved.json()).reports[0].participantCode, "DEMO-001");
});

test("actual routes enforce session role before touching private data or providers", async () => {
  const participant = await login("participant");
  const reviewer = await login("coordinator");
  assert.equal((await coordinator(request("/api/coordinator/reports", undefined, participant, {}, "GET"))).status, 403);
  for (const handler of [analyze, prepare, submit]) {
    const response = await handler(request("/api/reports", {}, reviewer));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("vary"), /Cookie/);
  }
  assert.equal(globalThis.__browserWorkflow.providerCalls, 0);
  assert.equal(globalThis.__browserWorkflow.sql.some(({ sql }) => sql.includes("INSERT INTO reports")), false);
});

test("every participant endpoint rejects cross-origin cookie writes before services", async () => {
  const cookie = await login("participant");
  for (const handler of [analyze, prepare, submit]) {
    assert.equal((await handler(request("/", {}, cookie, { origin: "https://attacker.invalid" }))).status, 403);
    assert.equal((await handler(request("/", {}, cookie, { "x-symora-csrf": "" }))).status, 403);
  }
  assert.equal(globalThis.__browserWorkflow.providerCalls, 0);
  assert.equal(globalThis.__browserWorkflow.sql.some(({ sql }) => sql.includes("INSERT INTO reports")), false);
});

test("anonymous/expired browser sessions cannot reach protected endpoints", async () => {
  const cookie = await login("participant");
  for (const state of globalThis.__browserWorkflow.sessions.values()) state.expires = Date.now() - 1;
  for (const handler of [analyze, prepare, submit]) {
    assert.equal((await handler(request("/", {}, cookie))).status, 401);
    assert.equal((await handler(request("/", {}))).status, 401);
  }
  assert.equal((await coordinator(request("/", undefined, cookie, {}, "GET"))).status, 401);
  assert.deepEqual(await (await session(request("/", undefined, cookie, {}, "GET"))).json(), { authenticated: false });
  assert.equal(globalThis.__browserWorkflow.providerCalls, 0);
  assert.equal(globalThis.__browserWorkflow.sql.some(({ sql }) => sql.includes("INSERT INTO reports")), false);
});
