import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReport } from "../lib/report-validation.mjs";
import { payload } from "./report-fixtures.mjs";

test("preserves original multilingual transcript and descriptions without trimming", () => {
  const input = payload();
  const output = validateReport(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
  assert.notEqual(output.symptoms, input.symptoms);
});

test("unknown details remain null, with no invented intensity or onset", () => {
  const input = payload();
  delete input.englishSummary;
  input.symptoms = [{ symptomCode: "headache" }];
  assert.deepEqual(validateReport(input).symptoms[0], {
    symptomCode: "headache", reportedIntensity: null, onsetDate: null, ongoing: null, participantDescription: null,
  });
  assert.equal(validateReport(input).englishSummary, null);
});

test("empty symptom list is valid without inferring symptoms", () => {
  assert.deepEqual(validateReport({ ...payload(), symptoms: [] }).symptoms, []);
});

for (const field of ["workflowStatus", "confirmed", "source", "originalLanguage", "originalTranscript", "symptoms"]) {
  test(`rejects missing required field: ${field}`, () => {
    const input = payload(); delete input[field];
    assert.throws(() => validateReport(input), (e) => e.status === 422 && e.field === field);
  });
}

for (const [label, mutate] of [
  ["draft status", (p) => { p.workflowStatus = "draft"; }],
  ["coordinator status", (p) => { p.workflowStatus = "reviewed"; }],
  ["unconfirmed report", (p) => { p.confirmed = false; }],
  ["blank transcript", (p) => { p.originalTranscript = " \t\n"; }],
  ["null transcript", (p) => { p.originalTranscript = null; }],
  ["oversized transcript", (p) => { p.originalTranscript = "a".repeat(20001); }],
  ["null character", (p) => { p.originalTranscript = "hello\0world"; }],
  ["unsupported source", (p) => { p.source = "gemini"; }],
  ["bad language", (p) => { p.originalLanguage = "not_a_language"; }],
  ["body identity", (p) => { p.participantId = "someone-else"; }],
  ["body role", (p) => { p.role = "coordinator"; }],
  ["client timestamp", (p) => { p.submittedAt = "2026-10-10"; }],
  ["model metadata", (p) => { p.missingInformation = ["onset"]; }],
  ["nested severity", (p) => { p.symptoms[0].severity = "severe"; }],
  ["array item type", (p) => { p.symptoms = [null]; }],
  ["duplicate codes", (p) => { p.symptoms.push({ ...p.symptoms[0] }); }],
  ["malformed code", (p) => { p.symptoms[0].symptomCode = "free text symptom"; }],
  ["too many symptoms", (p) => { p.symptoms = Array.from({ length: 31 }, (_, i) => ({ symptomCode: `s${i}` })); }],
  ["impossible date", (p) => { p.symptoms[0].onsetDate = "2026-02-30"; }],
  ["invalid leap day", (p) => { p.symptoms[0].onsetDate = "2025-02-29"; }],
  ["timestamp instead of date", (p) => { p.symptoms[0].onsetDate = "2026-10-10T12:00:00Z"; }],
  ["string boolean", (p) => { p.symptoms[0].ongoing = "true"; }],
]) {
  test(`validation rejects ${label}`, () => {
    const input = payload(); mutate(input);
    assert.throws(() => validateReport(input), (e) => e.status === 422 && e.code === "VALIDATION_ERROR");
  });
}

for (const value of [-1, 11, 2.5, "4", true, {}, NaN, Infinity]) {
  test(`rejects malformed intensity ${String(value)}`, () => {
    const input = payload(); input.symptoms[0].reportedIntensity = value;
    assert.throws(() => validateReport(input), (e) => e.status === 422 && e.field === "symptoms[0].reportedIntensity");
  });
}
for (const value of [null, 0, 10]) {
  test(`accepts participant-reported intensity ${value}`, () => {
    const input = payload(); input.symptoms[0].reportedIntensity = value;
    assert.equal(validateReport(input).symptoms[0].reportedIntensity, value);
  });
}
for (const value of [null, [], "hello", 10]) {
  test(`rejects non-object JSON ${JSON.stringify(value)}`, () => {
    assert.throws(() => validateReport(value), (e) => e.status === 422);
  });
}
