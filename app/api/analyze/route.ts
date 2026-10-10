import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

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
        required: ["name", "source_excerpt"],
      },
    },
    medications_mentioned: { type: Type.ARRAY, items: { type: Type.STRING } },
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
  required: ["language", "english_translation", "summary", "symptoms", "medications_mentioned"],
};

const SYSTEM = `You convert a clinical trial participant's spoken transcript into a structured English record.
RULES:
- Extract ONLY what the speaker actually said. Never invent or infer dates, severity, medications, causes, or diagnoses.
- If a detail was not stated, use null (or [] for medications).
- onset_text: the speaker's own timing words, translated into ENGLISH (e.g. "desde ayer" becomes "since yesterday"). Do not convert to a calendar date.
- onset_text: if the speaker gives one timing for a group of symptoms ("X and Y since Tuesday"), apply it to all of them. Leave onset_text null only when the timing clearly belongs to a different symptom, or no timing was given.
- intensity: the speaker's own words or number, translated into ENGLISH. null if not given.
- source_excerpt: an exact quote from the ORIGINAL transcript, in its original language, supporting each symptom.
- If the speaker corrects themselves ("no wait, it was Monday"), use the final corrected version.
- Translate colloquial phrasing faithfully (e.g. "me siento mareado" = "I feel dizzy").
- clarification: ask ONE short, simple question about the most important missing detail, in English and in the participant's language. null if nothing important is missing.
- The participant may speak Spanish, Vietnamese, or Mandarin. Write the clarification question's participant_language version in that same language (Simplified Chinese for Mandarin), using simple everyday words.
- All fields must be in English except source_excerpt (original language) and clarification.participant_language.
- Do not give medical advice or say anything is serious or not serious.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(promise: Promise<any>, timeoutMs: number) {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function generateWithRetry(ai: any, params: any) {
  const models = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(
    Boolean
  ) as string[];

  if (models.length === 0) {
    models.push("gemini-2.5-flash");
  }

  let lastErr: any;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchWithTimeout(ai.models.generateContent({ ...params, model }), 10000);
      } catch (err: any) {
        lastErr = err;
        const status = err?.status ?? err?.code;
        const retryable = status === 503 || status === 429 || status === 500;
        if (!retryable) throw err;
        
        // Avoid sleeping after the final attempt
        if (attempt < 2) {
          await sleep(800 * 2 ** attempt);
        }
      }
    }
  }
  throw lastErr;
}

function validateGeminiOutput(analysis: any): boolean {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return false;
  if (typeof analysis.language !== "string") return false;
  if (typeof analysis.english_translation !== "string") return false;
  if (typeof analysis.summary !== "string") return false;
  if (!Array.isArray(analysis.symptoms)) return false;
  if (!Array.isArray(analysis.medications_mentioned)) return false;

  for (const s of analysis.symptoms) {
    if (!s || typeof s !== "object" || typeof s.name !== "string" || typeof s.source_excerpt !== "string") {
      return false;
    }
  }

  if (analysis.clarification !== null && analysis.clarification !== undefined) {
    if (
      typeof analysis.clarification !== "object" ||
      typeof analysis.clarification.english !== "string" ||
      typeof analysis.clarification.participant_language !== "string"
    ) {
      return false;
    }
  }

  return true;
}

export async function POST(req: Request) {
  // 1. Enforce payload size limit (max 50KB total body size)
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 51200) {
    return NextResponse.json({ error: "Payload exceeds 50KB limit" }, { status: 413 });
  }

  // 2. Configuration Check
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ANALYZE ERROR: Missing GEMINI_API_KEY configuration");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // 3. Strict JSON Body Parsing (Reject null, arrays, non-objects)
  let body: any;
  try {
    const rawText = await req.text();
    if (rawText.length > 51200) {
      return NextResponse.json({ error: "Payload exceeds size limit" }, { status: 413 });
    }
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { transcript, language } = body;

  // 4. Validate Language
  if (!language || typeof language !== "string" || !SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)) {
    return NextResponse.json(
      { error: `Unsupported language. Allowed: ${SUPPORTED_LANGUAGES.join(", ")}` },
      { status: 400 }
    );
  }

  // 5. Validate Transcript
  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "Transcript must be a non-empty string" }, { status: 400 });
  }

  if (transcript.length > 5000) {
    return NextResponse.json({ error: "Transcript exceeds maximum length of 5000 characters" }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const targetLang = LANG_NAMES[language as SupportedLanguage];

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

    let analysis: any;
    try {
      analysis = JSON.parse(res.text);
    } catch {
      return NextResponse.json({ error: "Failed to parse analysis structure" }, { status: 502 });
    }

    // 6. Complete Output Runtime Validation
    if (!validateGeminiOutput(analysis)) {
      return NextResponse.json({ error: "Analysis failed runtime schema validation" }, { status: 502 });
    }

    // 7. Verify Excerpts without silent deletion (flag low-confidence items)
    const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
    const normalizedTranscript = norm(transcript);

    let needsReview = false;
    analysis.symptoms = analysis.symptoms.map((s: any) => {
      const excerptMatches = s.source_excerpt ? normalizedTranscript.includes(norm(s.source_excerpt)) : false;
      if (!excerptMatches) {
        needsReview = true;
      }
      return {
        ...s,
        verified_excerpt: excerptMatches,
      };
    });

    return NextResponse.json({
      ...analysis,
      language,
      requires_manual_review: needsReview,
      demo_fallback: false,
    });
  } catch (err: any) {
    // Sanitize log: log standard message without credentials or raw transcript
    console.error("ANALYZE ERROR:", err?.message || "Internal generation failure");
    return NextResponse.json({ error: "Analysis processing failed" }, { status: 502 });
  }
}