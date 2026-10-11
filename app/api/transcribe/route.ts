
import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  authenticateParticipantRequest,
  withPrivateResponse,
} from "../../../lib/request-auth.mjs";
import { ReportError } from "../../../lib/report-errors.mjs";

const LANGS: Record<string, string> = {
  en: "en",
  es: "es",
  vi: "vi",
  zh: "zh",
};

const MAX_BYTES = 10 * 1024 * 1024;

async function handler(req: Request): Promise<Response> {
  try {
    await authenticateParticipantRequest(req);
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // Check the API key before creating the client.
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }

  let form: FormData;

  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }

  const audio = form.get("audio");
  const language = String(form.get("language") ?? "");

  if (!(audio instanceof Blob) || !LANGS[language]) {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }

  if (audio.size === 0) {
    return NextResponse.json(
      { error: "Empty recording" },
      { status: 400 }
    );
  }

  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Recording too large" },
      { status: 413 }
    );
  }

  try {
    // Initialize only when a transcription is requested.
    const client = new ElevenLabsClient({ apiKey });

    const result = await client.speechToText.convert({
      file: audio,
      modelId: "scribe_v1",
      languageCode: LANGS[language],
    });

    const transcript = result.text?.trim() ?? "";

    if (!transcript) {
      return NextResponse.json(
        { error: "No speech detected" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      transcript,
      languageCode: language,
    });
  } catch {
    console.error("Transcription request failed");

    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 502 }
    );
  }
}

export const POST = withPrivateResponse(handler);
