"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getBrowserSession,
  getCoordinatorReports,
  logoutBrowserSession,
} from "@/lib/frontend-api";
import {
  updateCoordinatorReportStatus,
  type ReviewStatusInput,
} from "@/lib/coordinator-review-api";
import {
  appendChatMessage,
  dailyChatKey,
  readChatMessages,
  subscribeToChatMessages,
  writeFollowUpState,
  type ChatMessage,
} from "@/lib/chat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { CoordinatorReport, CoordinatorWorkflowStatus } from "@/types/reports";

type Section = "reports" | "participants" | "trial";
type StatusF = "all" | CoordinatorWorkflowStatus;
type IntensityF = "all" | "high" | "medium" | "low";

const langName = {
  en: "English",
  es: "Spanish",
  zh: "Mandarin Chinese",
  vi: "Vietnamese",
} as const;
// The server requires a nonempty note for follow-ups. Coordinators don't type
// one, so this fixed note is sent and stored in the review history.
const FOLLOW_UP_NOTE = "Follow-up requested by the study team.";

// Fictional placeholders (not saved anywhere yet)
const coordinators = ["Unassigned", "Coordinator A", "Coordinator B"];

const sections: { id: Section; label: string }[] = [
  { id: "reports", label: "Symptom reports" },
  { id: "participants", label: "Participants" },
  { id: "trial", label: "Trial overview" },
];

const borderByStatus: Record<CoordinatorWorkflowStatus, string> = {
  submitted: "border-l-blue-500",
  reviewed: "border-l-green-600",
  follow_up_requested: "border-l-amber-500",
  closed: "border-l-slate-500",
};

// Hover = a rounded button shape with a soft amber glow
const hoverShape =
  "transition-all duration-300 ease-out hover:bg-white/60 hover:ring-1 hover:ring-glow/80 hover:shadow-[0_0_18px_rgba(240,180,90,0.3)]";

// Frosted-glass look for the large panels
const glass = "border border-white/60 bg-white/40 shadow-lg backdrop-blur-md";

// Table cell styles (every cell has a visible line)
const th =
  "w-44 border border-forest-800/25 bg-sage/70 px-3 py-2 text-sm font-semibold text-forest-800";
const td = "border border-forest-800/25 px-3 py-2";

// Demo notification: written to this browser's chat store, which the participant
// page reads (same browser only). The participant page shows the translated text
// based on `kind`; `text` is the English fallback.
function notifyParticipant(
  participantCode: string,
  status: "reviewed" | "follow_up_requested",
) {
  try {
    const day = new Date().toLocaleDateString("en-CA");
    const key = dailyChatKey(participantCode, day);
    const time = new Date().toLocaleTimeString("en-US", { timeStyle: "short" });
    if (status === "reviewed") {
      appendChatMessage(key, {
        from: "doctor",
        text: "Your doctor has reviewed your symptom report. Thank you for sharing how you are feeling.",
        kind: "reviewed",
        auto: true,
        time,
        readByPatient: false,
      });
      return;
    }
    appendChatMessage(key, {
      from: "doctor",
      text: "Your doctor would like to follow up with you about your report. Please contact your doctor to schedule an appointment. If it is an emergency, call 911.",
      kind: "follow_up_requested",
      auto: true,
      time,
      readByPatient: false,
    });
    // Daily reminders start tomorrow; today's first message already counts.
    writeFollowUpState(participantCode, {
      pending: true,
      appointmentScheduled: false,
      lastReminderDate: day,
    });
  } catch {
    // The server update already succeeded; a browser-storage problem must not
    // be reported as a failed review.
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeStyle: "short" });
}
function formatLanguage(language: string) {
  return langName[language as keyof typeof langName] ?? language;
}

// Highest intensity the participant reported (no AI judgment)
function maxIntensity(r: CoordinatorReport): number | null {
  const nums = r.symptoms
    .map((s) => s.reportedIntensity)
    .filter((n): n is number => n !== null);
  return nums.length ? Math.max(...nums) : null;
}
function bucket(n: number | null): IntensityF | null {
  if (n === null) return null;
  return n >= 7 ? "high" : n >= 4 ? "medium" : "low";
}

function FilterGroup<T extends string>({
  title,
  name,
  value,
  options,
  onChange,
}: {
  title: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 font-semibold text-forest-800">{title}</legend>
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm has-[:checked]:bg-white/70 has-[:checked]:ring-1 has-[:checked]:ring-glow/80 ${hoverShape}`}
          >
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-[#1f6f6b]"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [reports, setReports] = useState<CoordinatorReport[]>([]);
  const [section, setSection] = useState<Section>("reports");
  const [selectedId, setSelectedId] = useState("");
  const [statusF, setStatusF] = useState<StatusF>("all");
  const [intensityF, setIntensityF] = useState<IntensityF>("all");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authenticationBlocked, setAuthenticationBlocked] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<ReviewStatusInput["workflowStatus"] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const statusBusy = busyAction !== null;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const session = await getBrowserSession(controller.signal);
        if (!session.authenticated) {
          router.replace("/coordinator-login");
          return;
        }
        if (session.user.role !== "coordinator") {
          router.replace("/report");
          return;
        }
        const response = await getCoordinatorReports({ limit: 20, offset: 0 }, controller.signal);
        startTransition(() => {
          setReports(response.reports);
          setNextOffset(response.pagination.nextOffset);
          setSelectedId((current) =>
            response.reports.some((report) => report.id === current)
              ? current
              : response.reports[0]?.id ?? "",
          );
          setLoadError(null);
          setAuthenticationBlocked(false);
          setLoading(false);
        });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          startTransition(() => {
            setReports([]);
            setSelectedId("");
            setMessages([]);
            router.replace("/coordinator-login?session=expired");
          });
          return;
        }
        const blocked = error instanceof ApiError && (
          error.status === 401 ||
          error.status === 403 ||
          error.code === "BROWSER_AUTH_UNAVAILABLE" ||
          error.code === "COORDINATOR_AUTH_UNAVAILABLE"
        );
        startTransition(() => {
          setLoadError(error instanceof Error ? error.message : "Reports could not be loaded.");
          setAuthenticationBlocked(blocked);
          if (blocked) {
            setReports([]);
            setSelectedId("");
            setMessages([]);
          }
          setLoading(false);
        });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, router]);

  const filtered = useMemo(
    () =>
      reports
        .filter((r) => statusF === "all" || r.workflowStatus === statusF)
        .filter((r) => intensityF === "all" || bucket(maxIntensity(r)) === intensityF)
        .filter((r) => {
          const q = query.trim().toLowerCase();
          return (
            !q ||
            r.participantCode.toLowerCase().includes(q) ||
            (r.englishSummary ?? "").toLowerCase().includes(q)
          );
        })
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [reports, statusF, intensityF, query],
  );

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;
  const needsReview = reports.filter((r) => r.workflowStatus === "submitted").length;

  // Allowed moves, matching the server: submitted -> reviewed / follow-up,
  // reviewed -> follow-up. Follow-up requested and closed cannot change.
  const canMarkReviewed = selected?.workflowStatus === "submitted";
  const canRequestFollowUp =
    selected?.workflowStatus === "submitted" || selected?.workflowStatus === "reviewed";

  // One chat per participant per day.
  const chatKey = selected && today ? dailyChatKey(selected.participantCode, today) : "";

  // Clear any action error whenever a different report is shown.
  const selectedReportId = selected?.id ?? "";
  useEffect(() => {
    startTransition(() => {
      setActionError(null);
    });
  }, [selectedReportId]);

  async function loadMoreReports() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await getCoordinatorReports({ limit: 20, offset: nextOffset });
      setReports((current) => [...current, ...response.reports]);
      setNextOffset(response.pagination.nextOffset);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setReports([]);
        setSelectedId("");
        setMessages([]);
        router.replace("/coordinator-login?session=expired");
        return;
      }
      setLoadError(error instanceof Error ? error.message : "More reports could not be loaded.");
      const blocked = error instanceof ApiError && (
        error.status === 401 ||
        error.status === 403 ||
        error.code === "BROWSER_AUTH_UNAVAILABLE" ||
        error.code === "COORDINATOR_AUTH_UNAVAILABLE"
      );
      setAuthenticationBlocked(blocked);
      if (blocked) {
        setReports([]);
        setSelectedId("");
        setMessages([]);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function changeStatus(input: ReviewStatusInput) {
    if (!selected || statusBusy) return;
    const reportId = selected.id;
    const participantCode = selected.participantCode;
    setBusyAction(input.workflowStatus);
    setActionError(null);
    try {
      const result = await updateCoordinatorReportStatus(reportId, input);
      // Use the status the server confirmed, not the one we asked for.
      setReports((current) =>
        current.map((report) =>
          report.id === reportId
            ? { ...report, workflowStatus: result.report.workflowStatus }
            : report,
        ),
      );
      notifyParticipant(participantCode, result.report.workflowStatus as "reviewed" | "follow_up_requested");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setReports([]);
        setSelectedId("");
        setMessages([]);
        router.replace("/coordinator-login?session=expired");
        return;
      }
      setActionError(
        error instanceof Error ? error.message : "The review update could not be completed.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function signOut() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLoadError(null);
    try {
      await logoutBrowserSession();
      setReports([]);
      setSelectedId("");
      setMessages([]);
      setAssignee({});
      setQuery("");
      router.replace("/coordinator-login");
      router.refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Sign out failed. Please try again.");
    } finally {
      setLogoutBusy(false);
    }
  }

  useEffect(() => {
    startTransition(() => {
      setToday(new Date().toLocaleDateString("en-CA"));
    });
  }, []);

  useEffect(() => {
    const syncMessages = (next: ChatMessage[]) => setMessages(next);
    syncMessages(readChatMessages(chatKey));
    return subscribeToChatMessages(chatKey, syncMessages);
  }, [chatKey]);

  const actionBtn =
    "min-h-11 w-full whitespace-nowrap rounded-full bg-forest-800 px-4 py-2.5 text-center font-medium text-white transition-all duration-300 ease-out hover:bg-leaf hover:ring-2 hover:ring-glow/70 hover:shadow-lg disabled:opacity-50";

  return (
    <div className="flex min-h-screen flex-col bg-[#c3dccd] bg-gradient-to-br from-[#d8e8dd] via-[#c3dccd] to-[#a8cdbb] text-ink print:bg-none print:bg-white">
      {/* Top bar */}
      <header className="relative flex items-center justify-between gap-4 overflow-hidden bg-forest-950 px-6 py-2 text-white print:hidden">
        <span aria-hidden="true" className="pointer-events-none absolute left-[38%] top-2 text-glow/60">✦</span>
        <span aria-hidden="true" className="pointer-events-none absolute left-[55%] bottom-1 text-sm text-glow/40">✦</span>
        <span aria-hidden="true" className="pointer-events-none absolute left-[70%] top-3 text-xs text-mint/50">•</span>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/symora-emblem.svg" alt="" className="h-9 w-9" />
          <h1 className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold leading-none tracking-wide">
            Symora
          </h1>
        </div>
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search reports</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-10 w-full rounded-full border border-white/15 bg-white/10 px-5 text-white placeholder:text-white/60 transition-all duration-300 ease-out hover:ring-1 hover:ring-glow/60"
          />
        </label>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={logoutBusy}
          className="min-h-10 shrink-0 rounded-full border border-white/25 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {logoutBusy ? "Signing out…" : "Sign out"}
        </button>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[250px_360px_1fr] print:block print:p-0">
        {/* Sidebar */}
        <aside className={`rounded-3xl p-5 print:hidden ${glass}`}>
          <nav aria-label="Sections" className="mb-6 flex flex-col gap-1.5">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left font-medium ${
                  section === s.id
                    ? "bg-gradient-to-r from-leaf to-forest-600 text-white shadow-[0_0_18px_rgba(240,180,90,0.3)] ring-1 ring-glow/70"
                    : `text-forest-800 ${hoverShape}`
                }`}
              >
                <span aria-hidden="true" className={section === s.id ? "text-glow" : "text-[#c27b1f]"}>
                  ✦
                </span>
                {s.label}
              </button>
            ))}
          </nav>

          <h2 className="mb-3 border-t border-forest-800/20 pt-4 text-lg font-bold text-forest-800">
            Filter reports
          </h2>
          <FilterGroup<StatusF>
            title="Status"
            name="status"
            value={statusF}
            onChange={setStatusF}
            options={[
              { value: "all", label: "All" },
              { value: "submitted", label: "Submitted" },
              { value: "follow_up_requested", label: "Follow-up requested" },
              { value: "reviewed", label: "Reviewed" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <FilterGroup<IntensityF>
            title="Participant-reported intensity"
            name="intensity"
            value={intensityF}
            onChange={setIntensityF}
            options={[
              { value: "all", label: "All" },
              { value: "high", label: "High (7–10)" },
              { value: "medium", label: "Medium (4–6)" },
              { value: "low", label: "Low (1–3)" },
            ]}
          />
        </aside>

        {section !== "reports" && (
          <section
            className={`flex flex-col items-center justify-center gap-4 rounded-3xl p-10 text-center lg:col-span-2 print:hidden ${glass}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/symora-emblem.svg" alt="" className="h-24 w-24" />
            <h2 className="text-3xl font-bold text-forest-800">
              {section === "participants" ? "Participants" : "Trial overview"}
            </h2>
            <p className="max-w-md text-forest-800">
              {section === "participants"
                ? "Per-participant timelines of reported intensity will appear here."
                : "Common symptoms this week and participants with no recent check-in will appear here."}
            </p>
            <p className="text-sm text-muted">Coming soon · needs the analytics endpoint</p>
          </section>
        )}

        {section === "reports" && (
          <>
            {/* Queue */}
            <section
              aria-label="Symptom report queue"
              className={`rounded-3xl p-4 print:hidden ${glass}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-forest-800">Symptom report queue</h2>
                <span className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full bg-white/70 px-4 text-sm font-medium text-forest-800">
                  Needs review: {needsReview}
                </span>
              </div>
              {loading ? (
                <p role="status" className="py-6 text-center text-forest-800">Loading coordinator reports…</p>
              ) : loadError ? (
                <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-800/20 bg-red-50 p-4 text-sm text-red-900">
                  <p>{loadError}</p>
                  {authenticationBlocked && (
                    <a href="/coordinator-login" className="font-semibold underline">
                      Open coordinator sign in
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setReloadKey((key) => key + 1);
                    }}
                    className="min-h-10 rounded-full border border-red-900/20 bg-white px-4 font-semibold"
                  >
                    Retry
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-forest-800">
                  {reports.length === 0 ? "No submitted reports are available." : "No reports match these filters."}
                </p>
              ) : (
                <>
                <ul className="flex flex-col gap-3">
                  {filtered.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        aria-current={selected?.id === r.id}
                        className={`w-full rounded-2xl border-l-8 bg-white/80 p-3 text-left text-ink shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-glow/70 ${
                          borderByStatus[r.workflowStatus]
                        } ${selected?.id === r.id ? "ring-2 ring-leaf" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">ID: {r.id}</span>
                          <StatusBadge status={r.workflowStatus} />
                        </div>
                        <p className="mt-1 text-sm">
                          {fmtDate(r.submittedAt)} · {r.participantCode}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">
                          {r.englishSummary ?? "English summary unavailable."}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                {nextOffset !== null && (
                  <button
                    type="button"
                    onClick={() => void loadMoreReports()}
                    disabled={loadingMore}
                    className="mt-3 min-h-10 w-full rounded-full border border-forest-800/20 bg-white/70 px-4 font-semibold text-forest-800 disabled:opacity-50"
                  >
                    {loadingMore ? "Loading…" : "Load more reports"}
                  </button>
                )}
                </>
              )}
            </section>

            {/* Report details */}
            <article
              aria-label="Selected report details"
              className="flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/60 p-5 text-ink shadow-xl backdrop-blur-md print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none"
            >
              {!selected ? (
                <p className="text-muted">Select a report.</p>
              ) : (
                <>
                  <h2 className="flex items-center gap-2 text-2xl font-bold text-forest-800">
                    <span aria-hidden="true" className="text-[#c27b1f] print:hidden">✦</span>
                    Selected report details: {selected.id}
                  </h2>

                  {/* Report information table */}
                  <div className="overflow-hidden rounded-2xl border border-forest-800/25 bg-white/90">
                    <table className="w-full border-collapse text-left">
                      <tbody>
                        <tr>
                          <th scope="row" className={th}>Participant code</th>
                          <td className={td}>{selected.participantCode}</td>
                          <th scope="row" className={th}>Report ID</th>
                          <td className={td}>{selected.id}</td>
                        </tr>
                        <tr>
                          <th scope="row" className={th}>Submitted</th>
                          <td className={td}>
                            {fmtDate(selected.submittedAt)}, {fmtTime(selected.submittedAt)}
                          </td>
                          <th scope="row" className={th}>Reported in</th>
                          <td className={td}>{formatLanguage(selected.originalLanguage)}</td>
                        </tr>
                        <tr>
                          <th scope="row" className={th}>Status</th>
                          <td className={td}>
                            <StatusBadge status={selected.workflowStatus} />
                          </td>
                          <th scope="row" className={th}>
                            <label htmlFor="assign">Assigned to (not saved yet)</label>
                          </th>
                          <td className={td}>
                            <div className="relative print:hidden">
                              <select
                                id="assign"
                                value={assignee[selected.id] ?? coordinators[0]}
                                onChange={(e) =>
                                  setAssignee({ ...assignee, [selected.id]: e.target.value })
                                }
                                className="h-10 w-full appearance-none rounded-full border border-forest-800/20 bg-white pl-4 pr-10 transition-all duration-300 ease-out hover:ring-2 hover:ring-glow/60"
                              >
                                {coordinators.map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-800"
                              >
                                <path d="M5 8l5 5 5-5" />
                              </svg>
                            </div>
                            <span className="hidden print:inline">
                              {assignee[selected.id] ?? coordinators[0]}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className={th}>Summary</th>
                          <td className={td} colSpan={3}>
                            {selected.englishSummary ?? "No English summary was provided."}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className={th}>
                            Participant&apos;s original report
                          </th>
                          <td className={`${td} italic`} colSpan={3}>
                            &ldquo;{selected.originalTranscript}&rdquo;
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Symptoms table */}
                  <div className="overflow-hidden rounded-2xl border border-forest-800/25 bg-white/90">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr>
                          <th className="border border-forest-800/25 bg-sage px-3 py-2 text-sm font-semibold text-forest-800">
                            Symptom
                          </th>
                          <th className="border border-forest-800/25 bg-sage px-3 py-2 text-sm font-semibold text-forest-800">
                            Reported intensity
                          </th>
                          <th className="border border-forest-800/25 bg-sage px-3 py-2 text-sm font-semibold text-forest-800">
                            Onset
                          </th>
                          <th className="border border-forest-800/25 bg-sage px-3 py-2 text-sm font-semibold text-forest-800">
                            Ongoing
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.symptoms.map((symptom) => (
                          <tr
                            key={symptom.symptomCode}
                            className="transition-all duration-300 ease-out hover:bg-mint/20"
                          >
                            <td className={`${td} font-semibold`}>{symptom.displayName}</td>
                            <td className={td}>
                              {symptom.reportedIntensity === null ? "Not reported" : `${symptom.reportedIntensity} /10`}
                            </td>
                            <td className={td}>{symptom.onsetDate ?? "Not reported"}</td>
                            <td className={td}>
                              {symptom.ongoing === null ? "Not reported" : symptom.ongoing ? "Yes" : "No"}
                            </td>
                          </tr>
                        ))}
                        {selected.symptoms.length === 0 && (
                          <tr>
                            <td className={`${td} text-sm text-muted`} colSpan={4}>
                              No symptoms were recorded in this report.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Actions: one line */}
                  <div className="grid grid-cols-3 gap-3 print:hidden">
                    <button
                      className={actionBtn}
                      type="button"
                      onClick={() =>
                        void changeStatus({
                          workflowStatus: "follow_up_requested",
                          reviewNote: FOLLOW_UP_NOTE,
                        })
                      }
                      disabled={!canRequestFollowUp || statusBusy}
                      title={
                        canRequestFollowUp
                          ? undefined
                          : "A follow-up has already been requested or the report is closed."
                      }
                    >
                      {busyAction === "follow_up_requested" ? "Saving…" : "Request follow-up"}
                    </button>
                    <button
                      className={actionBtn}
                      type="button"
                      onClick={() => void changeStatus({ workflowStatus: "reviewed" })}
                      disabled={!canMarkReviewed || statusBusy}
                      title={
                        canMarkReviewed
                          ? undefined
                          : "Only reports that are still submitted can be marked reviewed."
                      }
                    >
                      {busyAction === "reviewed" ? "Saving…" : "Mark reviewed"}
                    </button>
                    <button className={actionBtn} type="button" onClick={() => window.print()}>
                      Print / Save PDF
                    </button>
                  </div>

                  {actionError && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900 print:hidden"
                    >
                      {actionError}
                    </p>
                  )}

                  {/* Chat: fills the remaining space */}
                  <section
                    aria-label={`Message ${selected.participantCode}`}
                    className="flex min-h-64 flex-1 flex-col overflow-hidden rounded-2xl border border-forest-800/25 bg-white/90 print:hidden"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-forest-800/20 bg-sage/60 px-4 py-2">
                      <h3 className="font-semibold text-forest-800">
                        Message {selected.participantCode}
                      </h3>
                      <span className="whitespace-nowrap text-xs text-muted">
                        Automated messages · same browser only
                      </span>
                    </div>

                    <div
                      aria-live="polite"
                      className="flex max-h-64 flex-1 flex-col gap-2 overflow-y-auto p-4"
                    >
                      {messages.length === 0 ? (
                        <p className="m-auto text-sm text-muted">
                          No automated messages today.
                        </p>
                      ) : (
                        messages.map((m, i) => (
                          <div
                            key={i}
                            className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                              m.from === "doctor"
                                ? "self-end bg-forest-800 text-white"
                                : "self-start bg-sage text-ink"
                            }`}
                          >
                        {m.auto && (
                            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide opacity-70">
                                Automated message
                            </p>
                        )}
                        <p>{m.text}</p>
                            <p className="mt-0.5 text-right text-xs opacity-70">{m.time}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <p className="border-t border-forest-800/20 px-4 py-2 text-xs text-muted">
                      Demo only: automated messages are stored in this browser. Not for emergencies.
                    </p>
                  </section>
                </>
              )}
            </article>
          </>
        )}
      </div>
    </div>
  );
}