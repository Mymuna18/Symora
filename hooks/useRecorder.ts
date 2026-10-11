"use client";
import { useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "processing" | "review" | "error";

export function useRecorder(language: string) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  function fail(message: string) {
    setError(message);
    setStatus("error");
  }

  async function upload(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "recording");
      form.append("language", language);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranscript(data.transcript);
      setStatus("review");
    } catch {
      fail("Could not transcribe. Please try again.");
    }
  }

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (Date.now() - startedAt.current < 1000) {
          fail("Recording was too short. Please try again.");
          return;
        }
        await upload(new Blob(chunksRef.current, { type: rec.mimeType }));
      };
      recorderRef.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setStatus("recording");
    } catch (err) {
      const name = (err as DOMException).name;
      fail(
        name === "NotAllowedError" ? "Microphone permission was denied."
        : name === "NotFoundError" ? "No microphone found."
        : "Could not start recording."
      );
    }
  }

  function stop() {
    setStatus("processing");
    recorderRef.current?.stop();
  }

  function reset() {
    setTranscript("");
    setError("");
    setStatus("idle");
  }

  return { status, transcript, setTranscript, error, start, stop, reset };
}