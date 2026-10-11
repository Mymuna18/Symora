import { GoogleGenAI, Type, type GenerateContentParameters } from "@google/genai";
import { NextResponse } from "next/server";
import { authenticateDemoParticipant } from "../../../lib/demo-auth.mjs";
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
    language: { type: Type.STRING },
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
- If a detail was not stated, use null (or [] for medications).
- onset_text: the speaker's own timing words, translated into ENGLISH.
- intensity: the speaker's own words or number, translated into ENGLISH. null if not given.
- source_excerpt: an exact quote from the ORIGINAL transcript supporting each symptom.
- clarification: ask ONE short question about the most important missing detail, in English and participant's language. null if nothing missing.
- All fields in English except source_excerpt and clarification.participant_language.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_REQUEST_BYTES = 50 * 1024;
const GEMINI_TIMEOUT_MS = 10000;

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

// Per-process global cap only: client IP headers are untrusted here. Coordinate
// shared, per-user limits with the deployment proxy and Elvin's auth integration.
const rateLimitWindowMs = 60000;
const maxRequestsPerWindow = 120;
let rateLimitCount = 0;
let rateLimitResetTime = 0;
function checkRateLimit(): boolean {
  const now = Date.now();
  if (now >= rateLimitResetTime) {
    rateLimitCount = 0;
    rateLimitResetTime = now + rateLimitWindowMs;
  }
  if (rateLimitCount >= maxRequestsPerWindow) {
    return false;
  }
  rateLimitCount++;
  return true;
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

  let lastErr: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const request: GenerateContentParameters = {
          ...params,
          model,
          config: {
            ...params.config,
            abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
            httpOptions: {
              ...params.config?.httpOptions,
              timeout: GEMINI_TIMEOUT_MS,
            },
          },
        };
        return await ai.models.generateContent(request);
      } catch (err: unknown) {
        lastErr = err;
        const status =
          typeof err === "object" && err !== null && "status" in err
            ? err.status
            : typeof err === "object" && err !== null && "code" in err
              ? err.code
              : undefined;
        const retryable = status === 503 || status === 429 || status === 500;
        if (!retryable) throw err;
        if (attempt === 2) break;
        await sleep(800 * 2 ** attempt);
      }
    }
  }
  throw lastErr ?? new Error("Gemini request failed");
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

export async function POST(req: Request) {
  try {
    authenticateDemoParticipant(req);
  } catch (error) {
    if (error instanceof ReportError) {
      const unauthorized = error.status === 401;
      return NextResponse.json(
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
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!checkRateLimit()) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let rawText: string;
  try {
    rawText = await readRequestText(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Payload exceeds 50KB limit" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { transcript, language } = body as Record<string, unknown>;

  if (!isSupportedLanguage(language)) {
    return NextResponse.json(
      { error: `Unsupported language. Allowed: ${SUPPORTED_LANGUAGES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "Transcript must be a non-empty string" }, { status: 400 });
  }

  if (transcript.length > 5000) {
    return NextResponse.json({ error: "Transcript exceeds 5000 characters" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
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
      return NextResponse.json({ error: "Empty analysis generated" }, { status: 502 });
    }

    let analysis: unknown;
    try {
      analysis = JSON.parse(res.text);
    } catch {
      return NextResponse.json({ error: "Malformed model response JSON" }, { status: 502 });
    }

    if (!validateGeminiOutput(analysis, language)) {
      return NextResponse.json({ error: "Output failed strict schema validation" }, { status: 502 });
    }

    const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
    const normalizedTranscript = norm(transcript);

    let needsReview = false;
    analysis.symptoms = analysis.symptoms.map((s) => {
      const excerptMatches = s.source_excerpt ? normalizedTranscript.includes(norm(s.source_excerpt)) : false;
      if (!excerptMatches) needsReview = true;
      return { ...s, verified_excerpt: excerptMatches };
    });

    return NextResponse.json({
      ...analysis,
      language,
      requires_manual_review: needsReview,
      demo_fallback: false,
    });
  } catch {
    return NextResponse.json({ error: "Analysis processing failed" }, { status: 502 });
  }
}