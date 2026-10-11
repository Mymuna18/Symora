import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Our codes -> codes Scribe accepts. Verify these in the current docs.
const LANGS: Record<string, string> = { es: "es", vi: "vi", zh: "zh" };

export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  const language = String(form.get("language") ?? "");

  if (!(audio instanceof Blob) || !LANGS[language]) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (audio.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  }

  try {
    const result = await client.speechToText.convert({
      file: audio,
      modelId: "scribe_v1",
      languageCode: LANGS[language],
    });
    return NextResponse.json({ transcript: result.text, languageCode: language });
  } catch (err) {
    console.error("Scribe error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }
}