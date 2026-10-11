
"use client";

import { useEffect, useRef, useState } from "react";

export type RecorderStatus =
  | "idle"
  | "recording"
  | "processing"
  | "review"
  | "error";

const messages: Record<string, Record<string, string>> = {
  en: {
    tooShort: "Recording was too short. Please try again.",
    denied: "Microphone permission was denied.",
    missing: "No microphone found.",
    start: "Could not start recording.",
    transcribe: "Could not transcribe. Check your sign-in and try again.",
  },
  es: {
    tooShort: "La grabación fue demasiado corta. Inténtalo de nuevo.",
    denied: "Se denegó el permiso para usar el micrófono.",
    missing: "No se encontró ningún micrófono.",
    start: "No se pudo iniciar la grabación.",
    transcribe: "No se pudo transcribir. Verifica tu inicio de sesión e inténtalo de nuevo.",
  },
  vi: {
    tooShort: "Bản ghi quá ngắn. Vui lòng thử lại.",
    denied: "Quyền sử dụng micrô đã bị từ chối.",
    missing: "Không tìm thấy micrô.",
    start: "Không thể bắt đầu ghi âm.",
    transcribe: "Không thể phiên âm. Hãy kiểm tra đăng nhập và thử lại.",
  },
  zh: {
    tooShort: "录音时间太短，请重试。",
    denied: "麦克风权限被拒绝。",
    missing: "未找到麦克风。",
    start: "无法开始录音。",
    transcribe: "无法转写。请检查登录状态并重试。",
  },
};

export function useRecorder(language: string) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const message = (key: string) => messages[language]?.[key] ?? messages.en[key];

  function fail(message: string) {
    setError(message);
    setStatus("error");
  }

  async function upload(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "recording");
      form.append("language", language);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "X-Symora-CSRF": "1",
        },
        credentials: "same-origin",
        body: form,
      });

      if (!res.ok) {
        throw new Error("Transcription request failed");
      }

      const data = await res.json();
      if (typeof data.transcript !== "string" || !data.transcript.trim()) {
        throw new Error("Transcription response was invalid");
      }
      setTranscript(data.transcript);
      setStatus("review");
    } catch {
      fail(message("transcribe"));
    }
  }

  async function start() {
    if (status === "recording" || status === "processing") return;
    setError("");

    let stream: MediaStream | null = null;
    try {
      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream = acquiredStream;

      let recordingFailed = false;
      const rec = new MediaRecorder(acquiredStream);

      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        acquiredStream.getTracks().forEach((track) => track.stop());

        if (recordingFailed) return;
        if (Date.now() - startedAt.current < 1000) {
          fail(message("tooShort"));
          return;
        }

        await upload(
          new Blob(chunksRef.current, {
            type: rec.mimeType,
          })
        );
      };

      recorderRef.current = rec;
      startedAt.current = Date.now();
      rec.onerror = () => {
        recordingFailed = true;
        acquiredStream.getTracks().forEach((track) => track.stop());
        fail(message("start"));
        if (rec.state !== "inactive") rec.stop();
      };
      rec.start();
      setStatus("recording");
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      const name = err instanceof DOMException ? err.name : "";

      fail(
        name === "NotAllowedError"
          ? message("denied")
          : name === "NotFoundError"
            ? message("missing")
            : message("start")
      );
    }
  }

  function stop() {
    if (recorderRef.current?.state !== "recording") return;
    setStatus("processing");
    recorderRef.current.stop();
  }

  function reset() {
    setTranscript("");
    setError("");
    setStatus("idle");
  }

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorder?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return {
    status,
    transcript,
    setTranscript,
    error,
    start,
    stop,
    reset,
  };
}
