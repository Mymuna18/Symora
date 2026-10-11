import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEMO_STORAGE_KEY,
  createDemoReport,
  parseDemoState,
  readDemoState,
  updateDemoResponse,
  updateDemoStatus,
  writeDemoState,
} from "../lib/demo-mode.mjs";

const initialReport = () => createDemoReport({
  id: "synthetic-demo-report-1",
  description: "I have a headache and feel tired today.",
  createdAt: "2026-10-11T13:00:00.000Z",
});

test("demo analysis is deterministic, explicitly simulated, and contains only reported keyword matches", () => {
  const report = initialReport();
  assert.equal(report.analysis.label, "Simulated AI analysis — no Gemini API call was made.");
  assert.equal(report.analysis.summary, "Fictional participant description mentions: Headache, Fatigue.");
  assert.deepEqual(report.analysis.symptoms, ["Headache", "Fatigue"]);
  assert.equal(report.workflowStatus, "submitted");
  assert.equal(report.reviewNote, null);
  assert.throws(() => createDemoReport({
    id: "synthetic-demo-report-2",
    description: "  ",
    createdAt: "2026-10-11T13:00:00.000Z",
  }), TypeError);
});

test("coordinator status transitions produce local review and follow-up notifications", () => {
  const submitted = { report: initialReport() };
  const reviewed = updateDemoStatus(submitted, "reviewed", "2026-10-11T14:00:00.000Z");
  assert.equal(reviewed.report.workflowStatus, "reviewed");
  assert.equal(reviewed.report.statusUpdatedAt, "2026-10-11T14:00:00.000Z");
  const followUp = updateDemoStatus(reviewed, "follow_up_requested", "2026-10-11T15:00:00.000Z");
  assert.equal(followUp.report.workflowStatus, "follow_up_requested");
  assert.match(followUp.report.reviewNote, /additional details/);
  assert.throws(() => updateDemoStatus(followUp, "reviewed", "2026-10-11T16:00:00.000Z"));
});

test("participant follow-up response persists and can advance from later to scheduled", () => {
  const followUp = updateDemoStatus(
    { report: initialReport() },
    "follow_up_requested",
    "2026-10-11T15:00:00.000Z",
  );
  const later = updateDemoResponse(followUp, "will_schedule_later");
  assert.equal(later.report.participantResponse, "will_schedule_later");
  const scheduled = updateDemoResponse(later, "appointment_scheduled");
  assert.equal(scheduled.report.participantResponse, "appointment_scheduled");
  assert.throws(() => updateDemoResponse(scheduled, "will_schedule_later"));
});

test("localStorage serialization restores demo state after reload and reset key is isolated", () => {
  const values = new Map();
  const storage = {
    setItem(key, value) { values.set(key, value); },
    getItem(key) { return values.get(key) ?? null; },
  };
  const state = { report: initialReport() };
  writeDemoState(storage, state);
  assert.equal(DEMO_STORAGE_KEY, "symora-public-demo-v1");
  assert.deepEqual(readDemoState(storage.getItem(DEMO_STORAGE_KEY)), { state, error: null });
  assert.deepEqual(readDemoState(null), { state: { report: null }, error: null });
});

test("malformed or incompatible local data is rejected safely", () => {
  assert.equal(readDemoState("{").state.report, null);
  assert.match(readDemoState("{").error, /could not be read/);
  assert.equal(parseDemoState({ report: { ...initialReport(), workflowStatus: "closed" } }), null);
  assert.equal(parseDemoState({ report: { ...initialReport(), participantResponse: "booked" } }), null);
  assert.equal(parseDemoState({ report: { ...initialReport(), analysis: { symptoms: [42] } } }), null);
});

test("public demo route and homepage CTA remain isolated from protected APIs", async () => {
  const page = await readFile(new URL("../app/demo/page.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(home, /href="\/demo"[\s\S]*?Try Demo/);
  assert.match(page, /localStorage/);
  assert.doesNotMatch(page, /fetch\(|@\/lib\/frontend-api|\/api\//);
  assert.match(page, /Participant Portal/);
  assert.match(page, /Coordinator Dashboard/);
  assert.match(page, /Reset Demo/);
});
