import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { DEMO_CATALOG } from "../lib/demo-catalog.mjs";

// Exercise the actual three App Router exports with both remote services replaced.
// Each Node test file runs in its own process. No dotenv or live network calls.
const token = "fictional_demo_workflow_token_".padEnd(43, "x");
const participant = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";
const transcript = "For this fictional demo, I have a headache. I rate it 4 out of 10.";
const output = () => ({
  language: "en", english_translation: transcript, summary: "Participant reports headache.",
  symptoms: [{ name: "headache", onset_text: null, intensity: "4 out of 10", ongoing: null, source_excerpt: "headache" }],
  medications_mentioned: [], clarification: null,
});
const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const dbUrl = new URL("../lib/db.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@google/genai") return { shortCircuit: true, url: dataModule(`
      export const Type = {OBJECT:'OBJECT',STRING:'STRING',ARRAY:'ARRAY',BOOLEAN:'BOOLEAN'};
      export class GoogleGenAI { constructor() { this.models = { generateContent: async () => {
        globalThis.__symoraWorkflow.geminiCalls++; return {text: JSON.stringify(globalThis.__symoraWorkflow.analysis)};
      }}; }}
    `) };
    if (specifier === "next/server") return { shortCircuit: true, url: dataModule("export const NextResponse = {json: (body, init) => Response.json(body, init)};") };
    if ((specifier === "./db.mjs" || specifier.endsWith("/lib/db.mjs"))
      && (specifier === "./db.mjs" || new URL(specifier, context.parentURL).href === dbUrl)) return {
      shortCircuit: true, url: dataModule("export const getPool = () => globalThis.__symoraWorkflow.pool;"),
    };
    return nextResolve(specifier, context);
  },
});
globalThis.fetch = async () => { throw new Error("Network forbidden in demo workflow tests."); };
process.env.GEMINI_API_KEY = "fictional-key-only";
const analyze = await import("../app/api/analyze/route.ts");
const prepare = await import("../app/api/reports/prepare/route.ts");
const reports = await import("../app/api/reports/route.ts");
const endpoints = [analyze, prepare, reports];

function auth(expiresAt = "2099-01-01T00:00:00.000Z") {
  process.env.SYMORA_DEMO_AUTH_ENABLED = "true";
  process.env.SYMORA_DEMO_PARTICIPANTS = JSON.stringify([{ participantId: participant,
    tokenSha256: createHash("sha256").update(token).digest("hex"), expiresAt }]);
}
const request = (path, body, authorized = true) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
beforeEach(() => {
  auth();
  const state = { analysis: output(), geminiCalls: 0, sql: [], rateLimits: new Map(), pool: null };
  const query = async (sql, values) => {
    state.sql.push({ sql, values });
    if (sql.includes("INSERT INTO rate_limit_buckets")) {
      const [scope, hash, windowMs, cap] = values;
      const key = `${scope}:${hash}`;
      let bucket = state.rateLimits.get(key);
      if (!bucket || bucket.expires <= Date.now()) bucket = { attempts: 0, expires: Date.now() + windowMs };
      bucket.attempts = Math.min(bucket.attempts + 1, cap);
      state.rateLimits.set(key, bucket);
      return { rows: [{ attempts: bucket.attempts, expires_at: new Date(bucket.expires) }] };
    }
    if (sql.includes("SELECT code, display_name")) return { rows: DEMO_CATALOG.map(({ code, displayName }) => ({ code, display_name: displayName })) };
    if (sql.includes("FROM participants")) return { rows: [{ id: participant }] };
    if (sql.includes("SELECT id, code FROM symptoms")) return { rows: [{ id: "33333333-3333-4333-8333-333333333333", code: "headache" }] };
    if (sql.includes("INSERT INTO reports")) return { rows: [{ id: reportId, submitted_at: new Date("2026-10-10T12:00:00.000Z") }] };
    return { rows: [] };
  };
  state.pool = { query, connect: async () => ({ query, release() {} }) };
  globalThis.__symoraWorkflow = state;
});
after(() => { delete process.env.GEMINI_API_KEY; delete process.env.SYMORA_DEMO_AUTH_ENABLED; delete process.env.SYMORA_DEMO_PARTICIPANTS; });

test("all three actual endpoints reject missing credentials before Gemini or database work", async () => {
  for (const endpoint of endpoints) assert.equal((await endpoint.POST(request("/", {}, false))).status, 401);
  assert.equal(globalThis.__symoraWorkflow.geminiCalls, 0);
  assert.deepEqual(globalThis.__symoraWorkflow.sql, []);
});

test("expired tokens and disabled configuration fail closed across all endpoints", async () => {
  auth("2000-01-01T00:00:00.000Z");
  for (const endpoint of endpoints) assert.equal((await endpoint.POST(request("/", {}))).status, 401);
  process.env.SYMORA_DEMO_AUTH_ENABLED = "false";
  for (const endpoint of endpoints) assert.equal((await endpoint.POST(request("/", {}))).status, 503);
  assert.equal(globalThis.__symoraWorkflow.geminiCalls, 0);
  assert.deepEqual(globalThis.__symoraWorkflow.sql, []);
});

test("fictional analyze -> prepare -> confirmed report works with the same participant token", async () => {
  const analyzed = await analyze.POST(request("/api/analyze", { transcript, language: "en" }));
  assert.equal(analyzed.status, 200);
  const analysis = await analyzed.json();
  assert.equal(analysis.symptoms[0].verified_excerpt, true);
  const prepared = await prepare.POST(request("/api/reports/prepare", { source: "portal", transcript, analysis }));
  assert.equal(prepared.status, 200);
  const body = await prepared.json();
  assert.equal(body.allSymptomsMapped, true);
  assert.equal(body.requiresParticipantConfirmation, true);
  assert.equal(body.draft.englishSummary, analysis.english_translation);
  const symptom = body.draft.symptoms[0];
  assert.equal(symptom.suggestedSymptomCode, "headache");
  assert.equal(symptom.reportedIntensityText, "4 out of 10");
  assert.equal(symptom.reportedIntensity, undefined);
  const submitted = await reports.POST(request("/api/reports", {
    workflowStatus: "submitted", confirmed: true, source: body.draft.source,
    originalLanguage: body.draft.originalLanguage, originalTranscript: body.draft.originalTranscript,
    englishSummary: body.draft.englishSummary,
    // The fictional participant explicitly confirmed 4/10; no AI severity conversion.
    symptoms: [{ symptomCode: symptom.suggestedSymptomCode, reportedIntensity: 4,
      onsetDate: null, ongoing: null, participantDescription: symptom.sourceExcerpt }],
  }));
  assert.equal(submitted.status, 201);
  assert.deepEqual(await submitted.json(), { report: { id: reportId, workflowStatus: "submitted", submittedAt: "2026-10-10T12:00:00.000Z", symptomCount: 1 } });
  const insert = globalThis.__symoraWorkflow.sql.find(({ sql }) => sql.includes("INSERT INTO reports"));
  assert.equal(insert.values[0], participant);
  assert.equal(insert.values[3], transcript);
  assert.equal(globalThis.__symoraWorkflow.sql.at(-1).sql, "COMMIT");
});

test("unrecognized Gemini names retain evidence and cannot be silently mapped", async () => {
  const analysis = output(); analysis.symptoms[0].name = "head discomfort";
  const response = await prepare.POST(request("/api/reports/prepare", { source: "voice", transcript, analysis }));
  const body = await response.json();
  assert.equal(body.allSymptomsMapped, false);
  assert.equal(body.draft.symptoms[0].suggestedSymptomCode, null);
  assert.equal(body.draft.symptoms[0].sourceExcerpt, "headache");
  assert.equal(body.draft.symptoms[0].unresolvedReason, "no_exact_catalog_match");
});

test("prepared drafts are not directly submit-ready and client identity overrides are rejected", async () => {
  const response = await prepare.POST(request("/api/reports/prepare", { source: "portal", transcript, analysis: output() }));
  const body = await response.json();
  assert.equal((await reports.POST(request("/api/reports", body.draft))).status, 422);
  assert.equal((await prepare.POST(request("/api/reports/prepare", { source: "portal", transcript, analysis: output(), participantId: participant }))).status, 422);
  assert.equal(globalThis.__symoraWorkflow.sql.some(({ sql }) => sql.includes("INSERT")), false);
});
