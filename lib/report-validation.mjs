// @ts-check
import { ReportError } from "./report-errors.mjs";

/** @param {string} field @param {string} message @returns {never} */
function invalid(field, message) {
  throw new ReportError(422, "VALIDATION_ERROR", message, field);
}

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field, "Expected a JSON object.");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} value @param {string[]} allowed @param {string} field */
function keys(value, allowed, field) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(field, "Unsupported fields are not allowed.");
}

/** @param {unknown} value @param {string} field @param {number} max @returns {string} */
function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    invalid(field, `Expected nonblank text of at most ${max} characters without null characters.`);
  }
  return value;
}

/** @param {unknown} value @param {string} field @param {number} max */
function optionalText(value, field, max) {
  return value == null ? null : text(value, field, max);
}

/**
 * Strict allowlists reject identity, roles, clinical severity, model metadata,
 * and draft/review statuses. No coercion of strings or AI-inferred intensity.
 * @param {unknown} input
 * @returns {import("../types/reports").SubmitReportRequest}
 */
export function validateReport(input) {
  const report = object(input, "body");
  keys(report, ["workflowStatus", "confirmed", "source", "originalLanguage", "originalTranscript", "englishSummary", "symptoms"], "body");
  if (report.workflowStatus !== "submitted") invalid("workflowStatus", "Only submitted reports are accepted.");
  if (report.confirmed !== true) invalid("confirmed", "Participant confirmation is required.");
  if (report.source !== "portal" && report.source !== "voice") invalid("source", "Expected portal or voice.");
  const originalLanguage = text(report.originalLanguage, "originalLanguage", 35);
  try { Intl.getCanonicalLocales(originalLanguage); } catch { invalid("originalLanguage", "Expected a valid BCP 47 language tag."); }
  const originalTranscript = text(report.originalTranscript, "originalTranscript", 20_000);
  const englishSummary = optionalText(report.englishSummary, "englishSummary", 10_000);
  if (!Array.isArray(report.symptoms) || report.symptoms.length > 30) invalid("symptoms", "Expected an array with at most 30 symptoms.");
  const seen = new Set();
  const symptoms = report.symptoms.map((item, index) => {
    const field = `symptoms[${index}]`;
    const symptom = object(item, field);
    keys(symptom, ["symptomCode", "reportedIntensity", "onsetDate", "ongoing", "participantDescription"], field);
    const symptomCode = text(symptom.symptomCode, `${field}.symptomCode`, 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(symptomCode)) invalid(`${field}.symptomCode`, "Expected a symptom catalog code.");
    if (seen.has(symptomCode)) invalid(`${field}.symptomCode`, "Duplicate symptom codes are not allowed.");
    seen.add(symptomCode);
    const reportedIntensity = symptom.reportedIntensity ?? null;
    if (reportedIntensity !== null && (typeof reportedIntensity !== "number" || !Number.isInteger(reportedIntensity) || reportedIntensity < 0 || reportedIntensity > 10)) {
      invalid(`${field}.reportedIntensity`, "Expected a participant-reported integer from 0 to 10, or null.");
    }
    const onsetDate = optionalText(symptom.onsetDate, `${field}.onsetDate`, 10);
    if (onsetDate !== null) {
      const timestamp = Date.parse(`${onsetDate}T00:00:00.000Z`);
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(onsetDate) || !Number.isFinite(timestamp)
        || new Date(timestamp).toISOString().slice(0, 10) !== onsetDate) {
        invalid(`${field}.onsetDate`, "Expected a real calendar date in YYYY-MM-DD format, or null.");
      }
    }
    const ongoing = symptom.ongoing ?? null;
    if (ongoing !== null && typeof ongoing !== "boolean") invalid(`${field}.ongoing`, "Expected a boolean or null.");
    return {
      symptomCode, reportedIntensity, onsetDate, ongoing,
      participantDescription: optionalText(symptom.participantDescription, `${field}.participantDescription`, 2_000),
    };
  });
  return { workflowStatus: "submitted", confirmed: true, source: report.source, originalLanguage, originalTranscript, englishSummary, symptoms };
}
