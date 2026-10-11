import assert from "node:assert/strict";
import { test } from "node:test";
import { createReportPreparationHandler, prepareReportDraft } from "../lib/report-analysis.mjs";
import { ReportError } from "../lib/report-errors.mjs";
import { validateReport } from "../lib/report-validation.mjs";

const catalog = [
  { code: "stomach_pain", displayName: "Stomach pain" },
  { code: "dizziness", displayName: "Dizziness" },
];

function input(overrides = {}) {
  return {
    source: "voice",
    transcript: "Me duele el estómago y estoy mareado desde el martes.",
    analysis: {
      language: "es",
      english_translation: "My stomach hurts and I feel dizzy since Tuesday.",
      summary: "Stomach pain and dizziness began Tuesday.",
      symptoms: [
        {
          name: "stomach pain",
          onset_text: "Tuesday",
          intensity: null,
          ongoing: null,
          source_excerpt: "Me duele el estómago",
        },
        {
          name: "dizziness",
          onset_text: "Tuesday",
          intensity: "mild",
          ongoing: true,
          source_excerpt: "estoy mareado",
        },
      ],
    },
    ...overrides,
  };
}

function request(body, headers = {}) {
  return new Request("http://localhost/api/reports/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("prepares exact catalog suggestions while preserving original transcript evidence and translation", () => {
  const result = prepareReportDraft(input(), catalog);
  assert.equal(result.draft.originalTranscript, input().transcript);
  assert.equal(result.draft.englishSummary, input().analysis.english_translation);
  assert.equal(result.requiresParticipantConfirmation, true);
  assert.equal(result.allSymptomsMapped, true);
  assert.deepEqual(result.draft.symptoms.map(({ suggestedSymptomCode }) => suggestedSymptomCode), [
    "stomach_pain",
    "dizziness",
  ]);
  assert.equal(result.draft.symptoms[0].sourceExcerpt, "Me duele el estómago");
  assert.equal(result.draft.symptoms[0].evidenceVerified, true);
  assert.equal(result.draft.symptoms[1].reportedIntensityText, "mild");
  assert.equal(result.draft.symptoms[1].onsetText, "Tuesday");
});

test("does not guess synonyms, dates, numeric intensities, or clinical severity", () => {
  const result = prepareReportDraft(input({
    analysis: {
      ...input().analysis,
      symptoms: [{
        name: "abdominal discomfort",
        onset_text: "Tuesday",
        intensity: "8",
        ongoing: true,
        source_excerpt: "Me duele el estómago",
      }],
    },
  }), catalog);
  const [symptom] = result.draft.symptoms;
  assert.equal(symptom.suggestedSymptomCode, null);
  assert.equal(symptom.unresolvedReason, "no_exact_catalog_match");
  assert.equal(symptom.reportedIntensityText, "8");
  assert.equal("reportedIntensity" in symptom, false);
  assert.equal("onsetDate" in symptom, false);
  assert.equal("severity" in symptom, false);
  assert.equal(result.allSymptomsMapped, false);
});

test("does not ignore punctuation when matching catalog labels", () => {
  const result = prepareReportDraft(input({
    analysis: {
      ...input().analysis,
      symptoms: [{
        name: "stomach-pain",
        onset_text: null,
        intensity: null,
        ongoing: null,
        source_excerpt: "Me duele el estómago",
      }],
    },
  }), catalog);
  assert.equal(result.draft.symptoms[0].suggestedSymptomCode, null);
  assert.equal(result.draft.symptoms[0].unresolvedReason, "no_exact_catalog_match");
});

test("keeps unverified evidence and ambiguous labels unresolved", () => {
  const result = prepareReportDraft(input({
    analysis: {
      ...input().analysis,
      symptoms: [
        { name: "Dizziness", onset_text: null, intensity: null, ongoing: null, source_excerpt: "invented excerpt" },
        { name: "Dizziness", onset_text: null, intensity: null, ongoing: null, source_excerpt: "estoy mareado" },
      ],
    },
  }), [...catalog, { code: "vertigo", displayName: "dizziness" }]);
  assert.equal(result.draft.symptoms[0].unresolvedReason, "unverified_transcript_evidence");
  assert.equal(result.draft.symptoms[1].unresolvedReason, "ambiguous_catalog_match");
  assert.equal(result.draft.symptoms.every(({ suggestedSymptomCode }) => suggestedSymptomCode === null), true);
});

test("keeps repeated mappings unresolved because reports allow one row per catalog symptom", () => {
  const result = prepareReportDraft(input({
    analysis: {
      ...input().analysis,
      symptoms: [
        { name: "dizziness", onset_text: null, intensity: null, ongoing: null, source_excerpt: "estoy mareado" },
        { name: "DIZZINESS", onset_text: null, intensity: null, ongoing: null, source_excerpt: "estoy mareado" },
      ],
    },
  }), catalog);
  assert.equal(result.draft.symptoms.every(({ unresolvedReason }) => unresolvedReason === "duplicate_catalog_code"), true);
  assert.equal(result.allSymptomsMapped, false);
});

test("prepared data cannot be submitted as a report until the participant confirms", () => {
  const prepared = prepareReportDraft(input(), catalog);
  const first = prepared.draft.symptoms[0];
  const unconfirmed = {
    workflowStatus: "submitted",
    source: prepared.draft.source,
    originalLanguage: prepared.draft.originalLanguage,
    originalTranscript: prepared.draft.originalTranscript,
    englishSummary: prepared.draft.englishSummary,
    symptoms: [{
      symptomCode: first.suggestedSymptomCode,
      participantDescription: first.sourceExcerpt,
    }],
  };
  assert.throws(() => validateReport(unconfirmed), (error) => error.field === "confirmed");
  const confirmed = { ...unconfirmed, confirmed: true };
  assert.equal(validateReport(confirmed).confirmed, true);
});

test("authenticated preparation reads the catalog; unauthorized requests do not", async () => {
  let catalogReads = 0;
  let authenticated = false;
  const handler = createReportPreparationHandler({
    authenticate: () => {
      if (!authenticated) {
        throw new ReportError(401, "UNAUTHORIZED", "A valid participant bearer token is required.");
      }
      return "synthetic-participant-id";
    },
    loadCatalog: async () => {
      catalogReads += 1;
      return catalog;
    },
  });

  const denied = await handler(request(input()));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("www-authenticate"), "Bearer");
  assert.equal(catalogReads, 0);

  authenticated = true;
  const accepted = await handler(request(input()));
  assert.equal(accepted.status, 200);
  assert.equal(catalogReads, 1);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
});

test("rejects forged identity fields and malformed analysis", () => {
  assert.throws(
    () => prepareReportDraft({ ...input(), participantCode: "forged" }, catalog),
    (error) => error.status === 422,
  );
  assert.throws(
    () => prepareReportDraft(input({ analysis: { language: "es", english_translation: "", symptoms: [] } }), catalog),
    (error) => error.status === 422,
  );
});
