import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

const LANG_NAMES: Record<string, string> = {
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

async function generateWithRetry(ai: any, params: any) {
  const models = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(
    Boolean
  ) as string[];

  if (models.length === 0) {
    models.push("gemini-2.5-flash"); // Default fallback model
  }

  let lastErr: any;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        lastErr = err;
        const status = err?.status ?? err?.code;
        const retryable = status === 503 || status === 429 || status === 500;
        if (!retryable) throw err;
        await sleep(800 * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  // Configuration check
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ANALYZE ERROR: Missing GEMINI_API_KEY");
    return NextResponse.json(
      { error: "Server configuration error: missing API key" },
      { status: 500 }
    );
  }

  // Input validation
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transcript, language } = body;

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json(
      { error: "Transcript is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  if (transcript.length > 5000) {
    return NextResponse.json(
      { error: "Transcript exceeds maximum length of 5000 characters" },
      { status: 400 }
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const targetLang = LANG_NAMES[language] ?? language ?? "English";

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
      throw new Error("Empty response received from Gemini");
    }

    const analysis = JSON.parse(res.text);

    // Anti-hallucination check
    const norm = (s: string) =>
      s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
    const t = norm(transcript);

    if (Array.isArray(analysis.symptoms)) {
      analysis.symptoms = analysis.symptoms.filter((s: any) =>
        s.source_excerpt ? t.includes(norm(s.source_excerpt)) : false
      );
    } else {
      analysis.symptoms = [];
    }

    return NextResponse.json({
      ...analysis,
      language: language || "en",
      demo_fallback: false,
    });
  } catch (err: any) {
    console.error("ANALYZE ERROR:", err?.message ?? err);
    return NextResponse.json(
      { error: "Analysis failed", details: err?.message },
      { status: 502 }
    );
  }
}