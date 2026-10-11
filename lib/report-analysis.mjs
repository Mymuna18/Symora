// @ts-check
import { ReportError } from "./report-errors.mjs";

const MAX_REQUEST_BYTES = 65_536;
const SUPPORTED_LANGUAGES = new Set(["en", "es", "vi", "zh"]);

/** @param {string} value */
function normalizeEvidence(value) {
  return value.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** @param {string} value */
function normalizeCatalogLabel(value) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** @param {string} transcript @param {string} excerpt */
function hasTranscriptEvidence(transcript, excerpt) {
  const normalizedExcerpt = normalizeEvidence(excerpt);
  return normalizedExcerpt.length > 0 && normalizeEvidence(transcript).includes(normalizedExcerpt);
}

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportError(422, "VALIDATION_ERROR", "Expected an object.", field);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} field @param {number} max */
function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new ReportError(422, "VALIDATION_ERROR", "Expected nonblank text within the allowed length.", field);
  }
  return value;
}

/** @param {Request} request @returns {Promise<unknown>} */
async function readJson(request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const encoding = request.headers.get("content-encoding")?.toLowerCase();
  if (contentType !== "application/json" || (encoding && encoding !== "identity")) {
    throw new ReportError(415, "UNSUPPORTED_MEDIA_TYPE", "Send an uncompressed application/json request.");
  }

  const tooLarge = () => new ReportError(413, "PAYLOAD_TOO_LARGE", "The request must not exceed 64 KiB.");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) {
      throw new ReportError(400, "INVALID_JSON", "A valid UTF-8 JSON body is required.");
    }
    if (Number(length) > MAX_REQUEST_BYTES) throw tooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ReportError(400, "INVALID_JSON", "A valid JSON body is required.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(400, "INVALID_JSON", "A valid UTF-8 JSON body is required.");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Build a review-only draft from an analyze response and the active catalog.
 * Codes are suggested only for a unique exact display-name match with verified
 * transcript evidence. No inferred onset date or intensity is supplied.
 * @param {unknown} input
 * @param {{code: string, displayName: string}[]} catalog
 */
export function prepareReportDraft(input, catalog) {
  const body = object(input, "body");
  if (Object.keys(body).some((key) => !["source", "transcript", "analysis"].includes(key))) {
    throw new ReportError(422, "VALIDATION_ERROR", "Unsupported fields are not allowed.", "body");
  }
  if (body.source !== "portal" && body.source !== "voice") {
    throw new ReportError(422, "VALIDATION_ERROR", "Expected portal or voice.", "source");
  }
  const transcript = text(body.transcript, "transcript", 5_000);
  const analysis = object(body.analysis, "analysis");
  if (typeof analysis.language !== "string" || !SUPPORTED_LANGUAGES.has(analysis.language)) {
    throw new ReportError(422, "VALIDATION_ERROR", "Unsupported analysis language.", "analysis.language");
  }
  const originalLanguage = analysis.language;
  const englishSummary = text(analysis.english_translation, "analysis.english_translation", 10_000);

  if (!Array.isArray(analysis.symptoms) || analysis.symptoms.length > 30) {
    throw new ReportError(422, "VALIDATION_ERROR", "Expected an array with at most 30 symptoms.", "analysis.symptoms");
  }

  const normalizedCatalog = catalog.map((entry) => {
    if (!entry || typeof entry.code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.code)
      || typeof entry.displayName !== "string" || !entry.displayName.trim()) {
      throw new ReportError(503, "REPORT_CATALOG_UNAVAILABLE", "The symptom catalog could not be loaded.");
    }
    return { code: entry.code, displayName: entry.displayName };
  });

  const preparedSymptoms = analysis.symptoms.map((value, index) => {
    const field = `analysis.symptoms[${index}]`;
    const symptom = object(value, field);
    const name = text(symptom.name, `${field}.name`, 2_000);
    const sourceExcerpt = text(symptom.source_excerpt, `${field}.source_excerpt`, 5_000);
    if (symptom.intensity !== null && typeof symptom.intensity !== "string") {
      throw new ReportError(422, "VALIDATION_ERROR", "Expected reported words or null.", `${field}.intensity`);
    }
    if (symptom.onset_text !== null && typeof symptom.onset_text !== "string") {
      throw new ReportError(422, "VALIDATION_ERROR", "Expected reported timing words or null.", `${field}.onset_text`);
    }
    if (symptom.ongoing !== null && typeof symptom.ongoing !== "boolean") {
      throw new ReportError(422, "VALIDATION_ERROR", "Expected a boolean or null.", `${field}.ongoing`);
    }

    const evidenceVerified = hasTranscriptEvidence(transcript, sourceExcerpt);
    const matches = normalizedCatalog.filter(
      (entry) => normalizeCatalogLabel(entry.displayName) === normalizeCatalogLabel(name),
    );
    const suggestedSymptomCode = evidenceVerified && matches.length === 1 ? matches[0].code : null;
    return {
      name,
      sourceExcerpt,
      evidenceVerified,
      suggestedSymptomCode,
      mappingStatus: suggestedSymptomCode ? "suggested" : "unresolved",
      unresolvedReason: !evidenceVerified
        ? "unverified_transcript_evidence"
        : matches.length === 0
          ? "no_exact_catalog_match"
          : matches.length > 1
            ? "ambiguous_catalog_match"
            : null,
      reportedIntensityText: symptom.intensity,
      onsetText: symptom.onset_text,
      ongoingCandidate: symptom.ongoing,
    };
  });

  const duplicateCodes = new Set(
    preparedSymptoms
      .filter((symptom) => symptom.suggestedSymptomCode)
      .filter((symptom, index, symptoms) =>
        symptoms.findIndex((other) => other.suggestedSymptomCode === symptom.suggestedSymptomCode) !== index)
      .map((symptom) => symptom.suggestedSymptomCode),
  );
  const symptoms = preparedSymptoms.map((symptom) => {
    if (!symptom.suggestedSymptomCode || !duplicateCodes.has(symptom.suggestedSymptomCode)) return symptom;
    return {
      ...symptom,
      suggestedSymptomCode: null,
      mappingStatus: "unresolved",
      unresolvedReason: "duplicate_catalog_code",
    };
  });

  return {
    draft: {
      source: body.source,
      originalLanguage,
      originalTranscript: transcript,
      englishSummary,
      symptoms,
    },
    symptomCatalog: normalizedCatalog.map(({ code, displayName }) => ({ symptomCode: code, displayName })),
    allSymptomsMapped: symptoms.every((symptom) => symptom.suggestedSymptomCode !== null),
    requiresParticipantConfirmation: true,
  };
}

/**
 * @param {{
 * authenticate: (request: Request) => string | Promise<string>,
 * loadCatalog: () => Promise<{code: string, displayName: string}[]>
 * }} dependencies
 */
export function createReportPreparationHandler({ authenticate, loadCatalog }) {
  /** @param {Request} request */
  return async function POST(request) {
    const headers = { "Cache-Control": "no-store" };
    try {
      await authenticate(request);
      const input = await readJson(request);
      let catalog;
      try {
        catalog = await loadCatalog();
      } catch {
        throw new ReportError(503, "REPORT_CATALOG_UNAVAILABLE", "The symptom catalog could not be loaded.");
      }
      return Response.json(prepareReportDraft(input, catalog), { status: 200, headers });
    } catch (error) {
      const failure = error instanceof ReportError
        ? error
        : new ReportError(500, "INTERNAL_ERROR", "The request could not be completed.");
      return Response.json({
        error: { code: failure.code, message: failure.message, ...(failure.field ? { field: failure.field } : {}) },
      }, {
        status: failure.status,
        headers: { ...headers, ...(failure.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
      });
    }
  };
}
