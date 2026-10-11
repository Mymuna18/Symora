"use client";

import { useState } from "react";
import { mockReports } from "@/lib/mock";
import { MicHero } from "@/components/ui/MicHero";
import { SideTabs, type Tab } from "@/components/ui/SideTabs";
import type { Language } from "@/lib/types";

type Onboard = "language" | "code" | "done";
type Flow = "idle" | "followups" | "readback" | "done";

// Fictional placeholder for the demo
const STUDY_TEAM_PHONE = "[study team number]";

const sampleStory: Record<Language, string> = {
  es: "Me duele el estómago y me siento mareada desde el martes.",
  en: "My stomach hurts and I feel dizzy since Tuesday.",
};

const copy = {
  en: {
    tabs: { home: "Home", profile: "Profile", past: "Past reports" },
    pickCode: "Enter your participant code",
    codeHint: "No names. Only your code.",
    next: "Next",
    howFeeling: "How are you feeling today?",
    tap: "Tap and talk",
    listening: "Listening… tap to stop",
    typeInstead: "Type instead",
    typePlaceholder: "Write how you are feeling",
    questions: [
      "When did it start?",
      "How bad is it, from 1 to 10? Or can you still do your normal day?",
      "Are you taking anything for it?",
      "Is anything else bothering you?",
    ],
    answerPlaceholder: "Your answer",
    skip: "Skip",
    heard: "I heard:",
    isRight: "Is that right?",
    yes: "Yes, that's right",
    change: "No, let me change it",
    saved: "Your report was saved for your study team to review.",
    safetyTitle: "If you feel very unwell",
    safety: `Please call your study team at ${STUDY_TEAM_PHONE} now. If it's an emergency, call 911.`,
    noDiagnose: "This app does not diagnose. It only records what you tell it.",
    again: "Start a new report",
    notice: "Demo with fictional data.",
    labels: ["Started", "How bad", "Taking", "Other"],
    profileTitle: "Your profile",
    language: "Language",
    codeLabel: "Participant code",
    pastTitle: "Past reports",
    pastEmpty: "No past reports yet.",
    savedTag: "✓ Saved",
  },
  es: {
    tabs: { home: "Inicio", profile: "Perfil", past: "Reportes anteriores" },
    pickCode: "Escribe tu código de participante",
    codeHint: "Sin nombres. Solo tu código.",
    next: "Siguiente",
    howFeeling: "¿Cómo te sientes hoy?",
    tap: "Toca y habla",
    listening: "Escuchando… toca para detener",
    typeInstead: "Escribir en su lugar",
    typePlaceholder: "Escribe cómo te sientes",
    questions: [
      "¿Cuándo empezó?",
      "¿Qué tan fuerte es, del 1 al 10? ¿O todavía puedes hacer tu día normal?",
      "¿Estás tomando algo para esto?",
      "¿Algo más te molesta?",
    ],
    answerPlaceholder: "Tu respuesta",
    skip: "Omitir",
    heard: "Escuché:",
    isRight: "¿Es correcto?",
    yes: "Sí, es correcto",
    change: "No, quiero cambiarlo",
    saved: "Tu reporte se guardó para que tu equipo del estudio lo revise.",
    safetyTitle: "Si te sientes muy mal",
    safety: `Llama a tu equipo del estudio al ${STUDY_TEAM_PHONE} ahora. Si es una emergencia, llama al 911.`,
    noDiagnose: "Esta app no diagnostica. Solo registra lo que tú le dices.",
    again: "Iniciar un nuevo reporte",
    notice: "Demostración con datos ficticios.",
    labels: ["Empezó", "Qué tan fuerte", "Toma", "Otro"],
    profileTitle: "Tu perfil",
    language: "Idioma",
    codeLabel: "Código de participante",
    pastTitle: "Reportes anteriores",
    pastEmpty: "Aún no hay reportes anteriores.",
    savedTag: "✓ Guardado",
  },
};

const big = "min-h-16 w-full rounded-2xl px-6 py-4 text-xl font-semibold";
const primaryBtn = `${big} bg-primary text-primary-ink disabled:opacity-50`;
const secondaryBtn = `${big} border border-border bg-surface text-ink`;

export default function ReportPage() {
  const [onboard, setOnboard] = useState<Onboard>("language");
  const [tab, setTab] = useState<Tab>("home");
  const [flow, setFlow] = useState<Flow>("idle");
  const [lang, setLang] = useState<Language>("es");
  const [code, setCode] = useState("");
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [story, setStory] = useState("");
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<string[]>(["", "", "", ""]);

  const L = copy[lang];

  function toggleMic() {
    if (!listening) {
      setListening(true);
    } else {
      setListening(false);
      // Placeholder: replace with the transcript from POST /api/transcribe
      setStory(sampleStory[lang]);
      setQ(0);
      setFlow("followups");
    }
  }

  function nextQuestion() {
    if (q < L.questions.length - 1) setQ(q + 1);
    else setFlow("readback");
  }

  function reset() {
    setFlow("idle");
    setStory("");
    setTyping(false);
    setListening(false);
    setQ(0);
    setAnswers(["", "", "", ""]);
  }

  // Placeholder: replace with GET /api/reports?participantCode=...
  const past = mockReports.filter((r) => r.participantCode === code);

  // ---------- First open: language, then code ----------
  if (onboard !== "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        {onboard === "language" && (
          <section className="flex flex-1 flex-col justify-center gap-4">
            <button
              className={primaryBtn}
              onClick={() => {
                setLang("es");
                setOnboard("code");
              }}
            >
              Español
            </button>
            <button
              className={primaryBtn}
              onClick={() => {
                setLang("en");
                setOnboard("code");
              }}
            >
              English
            </button>
          </section>
        )}
        {onboard === "code" && (
          <section className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold">{L.pickCode}</h1>
            <label className="flex flex-col gap-2">
              <span className="text-muted">{L.codeHint}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="DEMO-014"
                autoComplete="off"
                className="min-h-16 rounded-2xl border border-border bg-surface px-4 text-2xl"
              />
            </label>
            <button
              className={primaryBtn}
              disabled={!code.trim()}
              onClick={() => setOnboard("done")}
            >
              {L.next}
            </button>
          </section>
        )}
        <p className="mt-auto text-sm text-muted">{L.notice}</p>
      </main>
    );
  }

  // ---------- Main app with side tabs ----------
  return (
    <div className="flex min-h-screen">
      <SideTabs tab={tab} onChange={setTab} labels={L.tabs} />

      <main className="mx-auto flex min-h-screen w-full max-w-md flex-1 flex-col gap-6 p-6">
        {tab === "home" && flow === "idle" && (
          <section className="flex flex-1 flex-col items-center justify-center gap-6">
            <h1 className="text-center text-3xl font-bold">{L.howFeeling}</h1>
            <MicHero
              listening={listening}
              onClick={toggleMic}
              label={listening ? L.listening : L.tap}
            />
            <p aria-live="polite" className="text-center text-xl font-medium">
              {listening ? L.listening : L.tap}
            </p>
            {!typing ? (
              <button className={secondaryBtn} onClick={() => setTyping(true)}>
                {L.typeInstead}
              </button>
            ) : (
              <div className="flex w-full flex-col gap-3">
                <textarea
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  placeholder={L.typePlaceholder}
                  rows={4}
                  className="rounded-2xl border border-border bg-surface p-4 text-lg"
                />
                <button
                  className={primaryBtn}
                  disabled={!story.trim()}
                  onClick={() => {
                    setQ(0);
                    setFlow("followups");
                  }}
                >
                  {L.next}
                </button>
              </div>
            )}
          </section>
        )}

        {tab === "home" && flow === "followups" && (
          <section className="flex flex-col gap-4">
            <p className="text-muted">
              {q + 1} / {L.questions.length}
            </p>
            <h1 className="text-3xl font-bold">{L.questions[q]}</h1>
            {/* Placeholder: Anna's mic + read-aloud (POST /api/speak) goes here */}
            <textarea
              value={answers[q]}
              onChange={(e) => {
                const next = [...answers];
                next[q] = e.target.value;
                setAnswers(next);
              }}
              placeholder={L.answerPlaceholder}
              rows={3}
              className="rounded-2xl border border-border bg-surface p-4 text-lg"
            />
            <button className={primaryBtn} onClick={nextQuestion}>
              {L.next}
            </button>
            <button className={secondaryBtn} onClick={nextQuestion}>
              {L.skip}
            </button>
          </section>
        )}

        {tab === "home" && flow === "readback" && (
          <section className="flex flex-col gap-4">
            {/* Placeholder: replace with Muna's POST /api/analyze summary in the patient's language */}
            <h1 className="text-3xl font-bold">{L.heard}</h1>
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-lg">
              <p>&ldquo;{story}&rdquo;</p>
              {answers.map(
                (a, i) =>
                  a.trim() && (
                    <p key={i}>
                      <strong>{L.labels[i]}:</strong> {a}
                    </p>
                  ),
              )}
            </div>
            <p className="text-xl font-medium">{L.isRight}</p>
            {/* Placeholder: call POST /api/reports here before showing the done screen */}
            <button className={primaryBtn} onClick={() => setFlow("done")}>
              {L.yes}
            </button>
            <button
              className={secondaryBtn}
              onClick={() => {
                setFlow("idle");
                setTyping(false);
              }}
            >
              {L.change}
            </button>
          </section>
        )}

        {tab === "home" && flow === "done" && (
          <section className="flex flex-col gap-4">
            <p className="rounded-2xl bg-green-100 p-4 text-xl font-semibold text-green-900">
              ✓ {L.saved}
            </p>
            <div className="rounded-2xl border-2 border-accent bg-surface p-4">
              <h2 className="text-xl font-bold">{L.safetyTitle}</h2>
              <p className="text-lg">{L.safety}</p>
            </div>
            <p className="text-muted">{L.noDiagnose}</p>
            <button className={primaryBtn} onClick={reset}>
              {L.again}
            </button>
          </section>
        )}

        {tab === "profile" && (
          <section className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold">{L.profileTitle}</h1>
            <fieldset>
              <legend className="mb-2 text-lg font-medium">{L.language}</legend>
              <div className="flex gap-3">
                {(["es", "en"] as Language[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={`${big} flex-1 border ${
                      lang === l
                        ? "border-primary bg-primary text-primary-ink"
                        : "border-border bg-surface"
                    }`}
                  >
                    {l === "es" ? "Español" : "English"}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-2 text-lg font-medium">
              {L.codeLabel}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoComplete="off"
                className="min-h-16 rounded-2xl border border-border bg-surface px-4 text-2xl font-normal"
              />
              <span className="text-base font-normal text-muted">{L.codeHint}</span>
            </label>
          </section>
        )}

        {tab === "past" && (
          <section className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold">{L.pastTitle}</h1>
            {past.length === 0 ? (
              <p className="text-lg text-muted">{L.pastEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {past.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between text-sm text-muted">
                      <span>
                        {new Date(r.createdAt).toLocaleDateString(
                          lang === "es" ? "es-US" : "en-US",
                          { dateStyle: "medium" },
                        )}
                      </span>
                      <span>{L.savedTag}</span>
                    </div>
                    <p className="mt-2 text-lg">&ldquo;{r.transcript}&rdquo;</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <p className="mt-auto text-sm text-muted">{L.notice}</p>
      </main>
    </div>
  );
}