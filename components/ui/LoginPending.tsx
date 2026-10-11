"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getBrowserSession,
  loginCoordinator,
  loginParticipant,
  logoutBrowserSession,
} from "@/lib/frontend-api";

 type Role = "participant" | "coordinator";

const content: Record<Role, { title: string; description: string; audience: string; destination: string }> = {
  participant: {
    title: "Participant sign in",
    description: "Use the username and password provided by your study team.",
    audience: "Participant portal",
    destination: "/report",
  },
  coordinator: {
    title: "Coordinator sign in",
    description: "Use your coordinator demo account to open the report workspace.",
    audience: "Coordinator workspace",
    destination: "/dashboard",
  },
};

export function LoginPending({ role }: { role: Role }) {
  const router = useRouter();
  const copy = content[role];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [existingRole, setExistingRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("session") === "expired") {
      startTransition(() => setSessionExpired(true));
    }
    let active = true;
    getBrowserSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated) {
          if (session.user.role === role) window.location.replace(copy.destination);
          else setExistingRole(session.user.role);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSessionUnavailable(cause instanceof ApiError && cause.status === 503);
        setError(cause instanceof Error ? cause.message : "Session status is unavailable.");
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [copy.destination, role]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || checkingSession || sessionUnavailable || existingRole) return;
    const enteredPassword = password;
    setPassword("");
    setError(null);
    setSubmitting(true);
    try {
      const session = role === "participant"
        ? await loginParticipant(username.trim(), enteredPassword)
        : await loginCoordinator(username.trim(), enteredPassword);
      if (!session.authenticated || session.user.role !== role) {
        throw new ApiError("This account is not available for this portal.", 403, "FORBIDDEN");
      }
      router.replace(copy.destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed. Please try again.");
      setSessionUnavailable(cause instanceof ApiError && cause.status === 503);
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutOtherRole() {
    setError(null);
    setSubmitting(true);
    try {
      await logoutBrowserSession();
      setExistingRole(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-br from-[#d8e8dd] via-[#c3dccd] to-[#a8cdbb] text-ink">
      <header className="flex items-center gap-3 bg-forest-950 px-6 py-3 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/symora-emblem.svg" alt="" className="h-9 w-9" />
        <span className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold leading-none">
          Symora
        </span>
      </header>
      <div className="flex flex-1 items-center justify-center p-4">
        <section className="flex w-full max-w-md flex-col gap-5 rounded-3xl border border-white/60 bg-white/55 p-6 shadow-lg backdrop-blur-md">
          <p className="text-sm font-semibold uppercase text-forest-700">{copy.audience}</p>
          <h1 className="text-3xl font-bold text-forest-800">{copy.title}</h1>
          <p className="text-muted">{copy.description}</p>
          {sessionExpired && (
            <p role="status" className="rounded-2xl border border-amber-700/20 bg-amber-50/80 p-4 text-sm text-amber-950">
              Your session expired or is no longer valid. Sign in again to continue.
            </p>
          )}

          {checkingSession ? (
            <p role="status" className="rounded-2xl bg-white/70 p-4 text-sm text-forest-800">
              Checking your session…
            </p>
          ) : existingRole ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
                This browser is signed in as a {existingRole}. Sign out before switching portals.
              </p>
              <button
                type="button"
                onClick={() => void signOutOtherRole()}
                disabled={submitting}
                className="min-h-14 w-full rounded-full bg-forest-800 px-6 py-3 font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Signing out…" : "Sign out current session"}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 font-medium text-forest-800">
                Username
                <input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  autoComplete="username"
                  minLength={3}
                  maxLength={64}
                  required
                  disabled={sessionUnavailable || submitting}
                  className="min-h-12 rounded-xl border border-forest-800/25 bg-white px-4"
                />
              </label>
              <label className="flex flex-col gap-2 font-medium text-forest-800">
                Password
                <input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  minLength={1}
                  maxLength={256}
                  required
                  disabled={sessionUnavailable || submitting}
                  className="min-h-12 rounded-xl border border-forest-800/25 bg-white px-4"
                />
              </label>
              {error && (
                <p role="alert" className="rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={sessionUnavailable || submitting || !username || !password}
                className="min-h-14 w-full rounded-full bg-forest-800 px-6 py-3 font-semibold text-white transition-colors hover:bg-leaf disabled:opacity-50"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
