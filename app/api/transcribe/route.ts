import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Our codes -> codes Scribe accepts. Verify these in the current docs.
const LANGS: Record<string, string> = { en: "en", es: "es", vi: "vi", zh: "zh" };
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const audio = form.get("audio");
  const language = String(form.get("language") ?? "");

  if (!(audio instanceof Blob) || !LANGS[language]) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "Empty recording" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  }

  try {
    const result = await client.speechToText.convert({
      file: audio,
      modelId: "scribe_v1",
      languageCode: LANGS[language],
    });
    const transcript = result.text?.trim() ?? "";
    if (!transcript) {
      return NextResponse.json({ error: "No speech detected" }, { status: 422 });
    }
    return NextResponse.json({ transcript, languageCode: language });
  } catch {
    // Don't log the error object, it could include request details.
    console.error("Transcription request failed");
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }
}
