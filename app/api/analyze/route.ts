import { GoogleGenAI, Type, type GenerateContentParameters } from "@google/genai";
import { authenticateParticipantRequest, withPrivateResponse } from "../../../lib/request-auth.mjs";
import { enforceSharedAnalysisRateLimit } from "../../../lib/browser-auth-runtime.mjs";
import { ReportError } from "../../../lib/report-errors.mjs";

const SUPPORTED_LANGUAGES = ["en", "es", "vi", "zh"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANG_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Spanish",
  vi: "Vietnamese",
  zh: "Mandarin Chinese (Simplified characters)",
};

const schema = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING, enum: [...SUPPORTED_LANGUAGES] },
    english_translation: { type: Type.STRING },
    summary: { type: Type.STRING },
    symptoms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          onset_text: { type: Type.STRING, nullable: true },
          intensity: { type: Type.STRING, nullable: true },
          ongoing: { type: Type.BOOLEAN, nullable: true },
          source_excerpt: { type: Type.STRING },
        },
        required: ["name", "onset_text", "intensity", "ongoing", "source_excerpt"],
      },
    },
    medications_mentioned: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    clarification: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        english: { type: Type.STRING },
        participant_language: { type: Type.STRING },
      },
      required: ["english", "participant_language"],
    },
  },
  required: [
    "language",
    "english_translation",
    "summary",
    "symptoms",
    "medications_mentioned",
    "clarification",
  ],
};

const SYSTEM = `You convert a clinical trial participant's spoken transcript into a structured English record.
RULES:
- Extract ONLY what the speaker actually said. Never invent or infer dates, severity, medications, causes, or diagnoses.
- Include every distinct symptom phrase, in transcript order, with one symptom object per phrase. Do not omit phrases joined by "and", commas, or equivalent wording, and never substitute a different symptom.
- Report EVERY distinct symptom the speaker mentions, even when joined by words like and, also, 还, 也, 和, or commas. Never merge, drop, or replace symptoms.
- Translate symptom words exactly: 头晕 = dizziness (NOT headache), 头痛 = headache, 肚子疼 = stomach pain.
- When a symptom matches one of these, use exactly this English name: headache, dizziness, stomach pain, nausea, fatigue. Otherwise use a short plain English name. Never use synonyms like stomachache or tummy ache for these.
- If a detail was not stated, use null (or [] for medications).
- onset_text: the speaker's own timing words, translated into ENGLISH.
- intensity: the speaker's own words or number, translated into ENGLISH. null if not given.
- source_excerpt: an exact quote from the ORIGINAL transcript supporting each symptom.
- clarification: ask ONE short question about the most important missing detail, in English and participant's language. null if nothing missing.
- language: output exactly the requested supported language code (en, es, vi, or zh), never the language name.
- All other fields in English except source_excerpt and clarification.participant_language.`;

const MAX_REQUEST_BYTES = 50 * 1024;
const GEMINI_TIMEOUT_MS = 10000;
const GEMINI_REQUEST_BUDGET_MS = 20000;
const GEMINI_MAX_ATTEMPTS_PER_MODEL = 2;
const GEMINI_RETRY_DELAY_MS = 300;

interface GeminiSymptom {
  name: string;
  onset_text: string | null;
  intensity: string | null;
  ongoing: boolean | null;
  source_excerpt: string;
}

interface GeminiAnalysis {
  language: string;
  english_translation: string;
  summary: string;
  symptoms: GeminiSymptom[];
  medications_mentioned: string[];
  clarification: {
    english: string;
    participant_language: string;
  } | null;
}

class PayloadTooLargeError extends Error {}
class GeminiRequestBudgetError extends Error {}

function geminiFailureDiagnostic(error: unknown, timedOut = false) {
  const errorObject = typeof error === "object" && error !== null ? error : null;
  const httpStatus = errorObject
    ? "status" in errorObject && typeof errorObject.status === "number"
      ? errorObject.status
      : "statusCode" in errorObject && typeof errorObject.statusCode === "number"
        ? errorObject.statusCode
        : null
    : null;
  const rawName = errorObject && "name" in errorObject && typeof errorObject.name === "string"
    ? errorObject.name
    : "UnknownError";
  const errorName = rawName.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "UnknownError";
  const category = timedOut || /timeout|abort/i.test(errorName)
    ? "timeout"
    : httpStatus === 400
      ? "invalid_request"
      : httpStatus === 401 || httpStatus === 403
        ? "authentication_or_permission"
        : httpStatus === 429
          ? "rate_limited"
          : httpStatus !== null && httpStatus >= 500
            ? "provider_failure"
            : "request_failure";

  return { httpStatus, errorName, category };
}

function logGeminiFailure(error: unknown, timedOut = false) {
  console.error("Gemini generateContent failed", geminiFailureDiagnostic(error, timedOut));
}

function sleepWithinBudget(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new GeminiRequestBudgetError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GeminiRequestBudgetError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readRequestText(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error("Invalid content length");
    }
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      throw new PayloadTooLargeError();
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">
) {
  const models = [
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_MODEL,
  ].filter(Boolean) as string[];

  if (models.length === 0) {
    models.push("gemini-2.5-flash");
  }

  const deadline = Date.now() + GEMINI_REQUEST_BUDGET_MS;
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(
    () => budgetController.abort(),
    GEMINI_REQUEST_BUDGET_MS
  );
  let lastErr: unknown;
  try {
    for (const model of models) {
      for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS_PER_MODEL; attempt++) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0 || budgetController.signal.aborted) {
          throw new GeminiRequestBudgetError();
        }

        const attemptTimeoutMs = Math.min(GEMINI_TIMEOUT_MS, remainingMs);
        const attemptTimeoutSignal = AbortSignal.timeout(attemptTimeoutMs);
        const abortSignal = AbortSignal.any([
          budgetController.signal,
          attemptTimeoutSignal,
        ]);
        try {
          const request: GenerateContentParameters = {
            ...params,
            model,
            config: {
              ...params.config,
              abortSignal,
              httpOptions: {
                ...params.config?.httpOptions,
                timeout: attemptTimeoutMs,
              },
            },
          };
          return await ai.models.generateContent(request);
        } catch (err: unknown) {
          lastErr = err;
          logGeminiFailure(
            err,
            attemptTimeoutSignal.aborted || budgetController.signal.aborted
          );
          if (
            budgetController.signal.aborted ||
            Date.now() >= deadline
          ) {
            throw new GeminiRequestBudgetError();
          }

          const status = typeof err === "object" && err !== null
            ? "status" in err && typeof err.status === "number"
              ? err.status
              : "statusCode" in err && typeof err.statusCode === "number"
                ? err.statusCode
                : undefined
            : undefined;
          const name = typeof err === "object" && err !== null && "name" in err
            ? err.name
            : undefined;
          const code = typeof err === "object" && err !== null && "code" in err
            ? err.code
            : undefined;
          const networkTimeout =
            attemptTimeoutSignal.aborted ||
            name === "RequestTimeoutError" ||
            name === "TimeoutError" ||
            (typeof code === "string" &&
              ["ETIMEDOUT", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]
                .includes(code.toUpperCase()));
          const retryable = [429, 500, 502, 503].includes(status ?? -1) || networkTimeout;
          if (!retryable) throw err;
          if (attempt + 1 === GEMINI_MAX_ATTEMPTS_PER_MODEL) break;

          const retryDelayMs = Math.min(GEMINI_RETRY_DELAY_MS, deadline - Date.now());
          if (retryDelayMs <= 0) throw new GeminiRequestBudgetError();
          await sleepWithinBudget(retryDelayMs, budgetController.signal);
        }
      }
    }
    throw lastErr ?? new Error("Gemini request failed");
  } finally {
    clearTimeout(budgetTimer);
  }
}

function validateGeminiOutput(
  analysis: unknown,
  expectedLanguage: SupportedLanguage
): analysis is GeminiAnalysis {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return false;
  const output = analysis as Record<string, unknown>;
  if (output.language !== expectedLanguage) return false;
  if (typeof output.english_translation !== "string") return false;
  if (typeof output.summary !== "string") return false;
  if (!Array.isArray(output.symptoms)) return false;
  if (!Array.isArray(output.medications_mentioned)) return false;
  if (!Object.prototype.hasOwnProperty.call(output, "clarification")) return false;

  for (const med of output.medications_mentioned) {
    if (typeof med !== "string") return false;
  }

  for (const s of output.symptoms) {
    if (!s || typeof s !== "object") return false;
    if (Array.isArray(s)) return false;
    const symptom = s as Record<string, unknown>;
    if (typeof symptom.name !== "string" || !symptom.name.trim()) return false;
    if (typeof symptom.source_excerpt !== "string" || !symptom.source_excerpt.trim()) return false;
    if (symptom.onset_text !== null && typeof symptom.onset_text !== "string") return false;
    if (symptom.intensity !== null && typeof symptom.intensity !== "string") return false;
    if (symptom.ongoing !== null && typeof symptom.ongoing !== "boolean") return false;
  }

  if (output.clarification !== null) {
    if (typeof output.clarification !== "object" || Array.isArray(output.clarification)) return false;
    const clarification = output.clarification as Record<string, unknown>;
    if (
      typeof clarification.english !== "string" ||
      typeof clarification.participant_language !== "string"
    ) {
      return false;
    }
  }

  return true;
}

function isSupportedLanguage(language: unknown): language is SupportedLanguage {
  return (
    typeof language === "string" &&
    SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)
  );
}

async function analyze(req: Request) {
  try {
    await authenticateParticipantRequest(req);
  } catch (error) {
    if (error instanceof ReportError) {
      const unauthorized = error.status === 401;
      return Response.json(
        { error: unauthorized ? "Authentication required" : "Authentication unavailable" },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
            ...(unauthorized ? { "WWW-Authenticate": "Bearer" } : {}),
          },
        }
      );
    }
    return Response.json(
      { error: "Authentication failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    await enforceSharedAnalysisRateLimit();
  } catch (error) {
    if (error instanceof ReportError) {
      return Response.json({ error: error.status === 429 ? "Rate limit exceeded" : "Authentication unavailable" }, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ error: "Authentication unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let rawText: string;
  try {
    rawText = await readRequestText(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "Payload exceeds 50KB limit" }, { status: 413 });
    }
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { transcript, language } = body as Record<string, unknown>;

  if (!isSupportedLanguage(language)) {
    return Response.json(
      { error: `Unsupported language. Allowed: ${SUPPORTED_LANGUAGES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return Response.json({ error: "Transcript must be a non-empty string" }, { status: 400 });
  }

  if (transcript.length > 5000) {
    return Response.json({ error: "Transcript exceeds 5000 characters" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const targetLang = LANG_NAMES[language];

    const res = await generateWithRetry(ai, {
      contents: `Participant language: ${targetLang}\nTranscript:\n"""${transcript}"""`,
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
      },
    });

    if (!res.text) {
      return Response.json({ error: "Empty analysis generated" }, { status: 502 });
    }

    let analysis: unknown;
    try {
      analysis = JSON.parse(res.text);
    } catch {
      return Response.json({ error: "Malformed model response JSON" }, { status: 502 });
    }

    if (!validateGeminiOutput(analysis, language)) {
      return Response.json({ error: "Output failed strict schema validation" }, { status: 502 });
    }

    const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
    const normalizedTranscript = norm(transcript);

    let needsReview = false;
    analysis.symptoms = analysis.symptoms.map((s) => {
      const excerptMatches = s.source_excerpt ? normalizedTranscript.includes(norm(s.source_excerpt)) : false;
      if (!excerptMatches) needsReview = true;
      return { ...s, verified_excerpt: excerptMatches };
    });

    return Response.json({
      ...analysis,
      language,
      requires_manual_review: needsReview,
      demo_fallback: false,
    });
  } catch (error) {
    if (error instanceof GeminiRequestBudgetError) {
      logGeminiFailure(error, true);
      return Response.json(
        { error: "Analysis timed out. Please try again." },
        { status: 504 }
      );
    }
    return Response.json({ error: "Analysis processing failed" }, { status: 502 });
  }
}

export const POST = withPrivateResponse(analyze);
