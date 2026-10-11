"use client";
import { useState } from "react";
import { useRecorder } from "../../hooks/useRecorder";

export default function RecorderTest() {
  const [language, setLanguage] = useState("vi");
  const r = useRecorder(language);

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 480 }}>
      <h1>Recorder test</h1>

      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
        <option value="es">Español</option>
        <option value="vi">Tiếng Việt</option>
        <option value="zh">中文</option>
      </select>

      <p>Status: {r.status}</p>

      {r.status === "idle" && <button onClick={r.start}>Record</button>}
      {r.status === "recording" && <button onClick={r.stop}>Stop</button>}
      {r.status === "processing" && <p>Transcribing...</p>}

      {r.status === "review" && (
        <>
          <textarea
            value={r.transcript}
            onChange={(e) => r.setTranscript(e.target.value)}
            rows={5}
            style={{ width: "100%" }}
          />
          <button onClick={r.reset}>Record again</button>
        </>
      )}

      {r.status === "error" && (
        <>
          <p style={{ color: "red" }}>{r.error}</p>
          <button onClick={r.reset}>Try again</button>
        </>
      )}
    </main>
  );
}