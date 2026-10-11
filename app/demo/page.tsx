"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BrandHeader } from "@/components/ui/BrandHeader";
import {
  DEMO_STORAGE_KEY,
  createDemoReport,
  readDemoState,
  updateDemoResponse,
  updateDemoStatus,
  writeDemoState,
} from "@/lib/demo-mode.mjs";

type DemoReport = {
  id: string;
  description: string;
  createdAt: string;
  workflowStatus: "submitted" | "reviewed" | "follow_up_requested";
  statusUpdatedAt: string | null;
  reviewNote: string | null;
  participantResponse: "appointment_scheduled" | "will_schedule_later" | null;
  analysis: { label: string; summary: string; symptoms: string[] };
};
type DemoState = { report: DemoReport | null };
type View = "participant" | "coordinator";

const statusLabel: Record<DemoReport["workflowStatus"], string> = {
  submitted: "Submitted",
  reviewed: "Reviewed",
  follow_up_requested: "Follow-up",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function DemoPage() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("participant");
  const [state, setState] = useState<DemoState>({ report: null });
  const [description, setDescription] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const loaded = readDemoState(window.localStorage.getItem(DEMO_STORAGE_KEY));
        setState(loaded.state);
        setStorageError(loaded.error ?? "");
      } catch {
        setStorageError("Demo storage is unavailable in this browser.");
      } finally {
        setReady(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function persist(next: DemoState) {
    setState(next);
    try {
      writeDemoState(window.localStorage, next);
      setStorageError("");
    } catch {
      setStorageError("Demo changes are only in this page and could not be saved in this browser.");
    }
  }

  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      const report = createDemoReport({
        id: window.crypto.randomUUID(),
        description,
        createdAt: new Date().toISOString(),
      });
      persist({ report });
      setDescription("");
      setNotificationOpen(false);
    } catch {
      setFormError("Enter a fictional symptom description of up to 1,000 characters.");
    }
  }

  function changeStatus(target: "reviewed" | "follow_up_requested") {
    try {
      persist(updateDemoStatus(state, target, new Date().toISOString()));
    } catch {
      setFormError("That demo status change is not available.");
    }
  }

  function respond(response: "appointment_scheduled" | "will_schedule_later") {
    try {
      persist(updateDemoResponse(state, response));
    } catch {
      setFormError("That demo response could not be saved.");
    }
  }

  function resetDemo() {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      setState({ report: null });
      setDescription("");
      setFormError("");
      setStorageError("");
      setNotificationOpen(false);
      setView("participant");
    } catch {
      setStorageError("The demo could not be reset in this browser.");
    }
  }

  const report = state.report;
  const hasFollowUp = report?.workflowStatus === "follow_up_requested";

  return (
    <div className="min-h-screen bg-[#d8e8dd] text-ink">
      <BrandHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-forest-800/15 bg-cream p-5 shadow-sm sm:p-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <span className="inline-flex rounded-full bg-glow/25 px-3 py-1 text-xs font-bold uppercase tracking-wider text-forest-900">
                Public demo · fictional data only
              </span>
              <h1 className="mt-3 font-[family-name:var(--font-fraunces)] text-3xl font-semibold text-forest-950 sm:text-4xl">
                Symora Demo Mode
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">
                Explore a sample participant-to-coordinator workflow. Demo reports stay in this browser and never reach protected APIs or TigerData.
              </p>
            </div>
            <button
              type="button"
              onClick={resetDemo}
              className="min-h-11 shrink-0 rounded-full border border-forest-800/30 bg-white px-5 py-2 font-semibold text-forest-800 transition hover:bg-sage/40"
            >
              Reset Demo
            </button>
          </div>

          {storageError && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-800/20 bg-amber-50 p-3 text-sm text-amber-950">
              {storageError}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-forest-950/5 p-1 sm:inline-grid sm:min-w-[26rem]">
            {([
              ["participant", "Participant Portal"],
              ["coordinator", "Coordinator Dashboard"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => { setView(value); setFormError(""); }}
                className={`min-h-12 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  view === value ? "bg-forest-800 text-white shadow-sm" : "text-forest-900 hover:bg-white/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {formError && (
          <p role="alert" className="rounded-xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
            {formError}
          </p>
        )}

        {!ready ? (
          <p role="status" className="rounded-3xl bg-white/80 p-8 text-center text-muted">Loading this browser’s demo…</p>
        ) : view === "participant" ? (
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-forest-800/15 bg-white/90 p-5 shadow-sm sm:p-7">
              <p className="text-sm font-semibold uppercase tracking-wider text-leaf">Participant Portal · Demo</p>
              <h2 className="mt-2 font-[family-name:var(--font-fraunces)] text-2xl font-semibold text-forest-950">
                How are you feeling today?
              </h2>
              <form onSubmit={submitReport} className="mt-5 flex flex-col gap-3">
                <label htmlFor="demo-description" className="text-sm font-medium text-forest-900">
                  Fictional symptom description
                </label>
                <textarea
                  id="demo-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="For example: I have had a headache and felt tired today."
                  className="w-full resize-y rounded-2xl border border-forest-800/20 bg-cream/70 p-4 text-base text-ink placeholder:text-muted/80"
                />
                <p className="text-xs text-muted">Use fictional information only. Up to 1,000 characters.</p>
                <button
                  type="submit"
                  disabled={!description.trim()}
                  className="min-h-12 self-start rounded-full bg-forest-800 px-6 py-3 font-semibold text-white transition hover:bg-leaf disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit Demo Report
                </button>
              </form>
            </div>

            <div className="rounded-3xl border border-glow/50 bg-[#fff9ed] p-5 shadow-sm sm:p-7">
              <p className="text-sm font-semibold uppercase tracking-wider text-amber-900">Simulated AI analysis</p>
              <h2 className="mt-2 font-[family-name:var(--font-fraunces)] text-2xl font-semibold text-forest-950">
                No Gemini API call is made
              </h2>
              {report ? (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-ink">{report.analysis.summary}</p>
                  <div>
                    <h3 className="text-sm font-semibold text-forest-900">Extracted demo symptoms</h3>
                    {report.analysis.symptoms.length ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {report.analysis.symptoms.map((symptom) => (
                          <li key={symptom} className="rounded-full bg-white px-3 py-1 text-sm text-forest-900">{symptom}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted">No sample keywords matched.</p>
                    )}
                  </div>
                  <p className="text-xs text-muted">This deterministic demonstration is not medical advice or a real clinical analysis.</p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted">Submit a fictional report to see a clearly labeled, local-only sample analysis.</p>
              )}
            </div>

            <div className="rounded-3xl border border-forest-800/15 bg-white/90 p-5 shadow-sm sm:col-span-2 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-leaf">Notification Center · Demo</p>
                  <h2 className="mt-1 font-[family-name:var(--font-fraunces)] text-2xl font-semibold text-forest-950">
                    Coordinator updates
                  </h2>
                </div>
                <button
                  type="button"
                  aria-expanded={notificationOpen}
                  onClick={() => setNotificationOpen((open) => !open)}
                  className="min-h-11 rounded-full border border-forest-800/30 px-5 py-2 font-semibold text-forest-800 hover:bg-sage/40"
                >
                  {notificationOpen ? "Close notifications" : "Open Notification Center"}
                </button>
              </div>

              {notificationOpen && (
                <div aria-live="polite" className="mt-4 rounded-2xl bg-sage/30 p-4">
                  {!report || report.workflowStatus === "submitted" ? (
                    <p className="text-sm text-muted">No coordinator updates yet. Switch to the Coordinator Dashboard to review the submitted demo report.</p>
                  ) : report.workflowStatus === "reviewed" ? (
                    <div>
                      <p className="font-medium text-forest-950">Your symptom report has been reviewed by the study team. Thank you for submitting your report.</p>
                      {report.statusUpdatedAt && <time className="mt-2 block text-xs text-muted" dateTime={report.statusUpdatedAt}>{formatDate(report.statusUpdatedAt)}</time>}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="font-medium text-forest-950">{report.reviewNote}</p>
                        {report.statusUpdatedAt && <time className="mt-2 block text-xs text-muted" dateTime={report.statusUpdatedAt}>{formatDate(report.statusUpdatedAt)}</time>}
                      </div>
                      {report.participantResponse === "appointment_scheduled" ? (
                        <p role="status" className="rounded-xl bg-white p-3 text-sm text-forest-900">
                          You reported that you scheduled a follow-up appointment. This demo did not book an appointment.
                        </p>
                      ) : (
                        <>
                          {report.participantResponse === "will_schedule_later" && (
                            <p role="status" className="text-sm text-muted">You selected “Will Schedule Later.” This demo reminder state is saved in this browser.</p>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() => respond("appointment_scheduled")}
                              className="min-h-11 rounded-full bg-forest-800 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf"
                            >
                              Appointment Scheduled
                            </button>
                            {report.participantResponse !== "will_schedule_later" && (
                              <button
                                type="button"
                                onClick={() => respond("will_schedule_later")}
                                className="min-h-11 rounded-full border border-forest-800/30 bg-white px-4 py-2 text-sm font-semibold text-forest-800 hover:bg-sage/40"
                              >
                                Will Schedule Later
                              </button>
                            )}
                          </div>
                        </>
                      )}
                      <p className="text-xs text-muted">Demo responses are local only; no appointment is booked and no reminder is sent.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-forest-800/15 bg-white/90 p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-leaf">Coordinator Dashboard · Demo</p>
                <h2 className="mt-2 font-[family-name:var(--font-fraunces)] text-2xl font-semibold text-forest-950">
                  Participant reports
                </h2>
              </div>
              {report && (
                <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  report.workflowStatus === "reviewed"
                    ? "bg-emerald-100 text-emerald-900"
                    : report.workflowStatus === "follow_up_requested"
                      ? "bg-amber-100 text-amber-950"
                      : "bg-slate-100 text-slate-800"
                }`}>
                  {statusLabel[report.workflowStatus]}
                </span>
              )}
            </div>
            {!report ? (
              <p className="mt-6 rounded-2xl bg-sage/30 p-5 text-sm text-muted">No demo report yet. Switch to the Participant Portal and submit a fictional description.</p>
            ) : (
              <article className="mt-6 rounded-2xl border border-forest-800/10 bg-cream/60 p-5">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>Fictional demo participant · report {report.id.slice(0, 8)}</span>
                  <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-forest-900">Participant description</h3>
                <p className="mt-1 whitespace-pre-wrap">{report.description}</p>
                <h3 className="mt-4 text-sm font-semibold text-forest-900">Simulated extraction · no Gemini call</h3>
                <p className="mt-1 text-sm text-muted">{report.analysis.summary}</p>
                {report.analysis.symptoms.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {report.analysis.symptoms.map((symptom) => (
                      <li key={symptom} className="rounded-full bg-white px-3 py-1 text-sm text-forest-900">{symptom}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  {report.workflowStatus === "submitted" && (
                    <button
                      type="button"
                      onClick={() => changeStatus("reviewed")}
                      className="min-h-11 rounded-full bg-forest-800 px-5 py-2 font-semibold text-white hover:bg-leaf"
                    >
                      Mark Reviewed
                    </button>
                  )}
                  {report.workflowStatus !== "follow_up_requested" && (
                    <button
                      type="button"
                      onClick={() => changeStatus("follow_up_requested")}
                      className="min-h-11 rounded-full border border-amber-800/30 bg-amber-100 px-5 py-2 font-semibold text-amber-950 hover:bg-amber-200"
                    >
                      Request Follow-Up
                    </button>
                  )}
                </div>
                {hasFollowUp && (
                  <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                    Follow-up message shown in the participant Notification Center: {report.reviewNote}
                  </p>
                )}
              </article>
            )}
          </section>
        )}

        <p className="pb-4 text-center text-xs text-muted">
          Public hackathon demo only. Fictional data is stored in this browser’s localStorage; do not enter real health information.
        </p>
      </main>
    </div>
  );
}
