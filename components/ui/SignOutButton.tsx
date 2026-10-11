"use client";

import { useState } from "react";
import { logoutBrowserSession } from "@/lib/frontend-api";

export function SignOutButton({
  label,
  busyLabel,
  errorLabel,
}: {
  label: string;
  busyLabel: string;
  errorLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      await logoutBrowserSession();
      window.location.replace("/participant-login");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="min-h-14 w-full rounded-full border border-forest-800/30 bg-white/70 px-6 py-3 text-lg font-semibold text-forest-800 transition-all duration-300 ease-out hover:bg-white hover:ring-2 hover:ring-glow/60 disabled:opacity-50"
      >
        {busy ? busyLabel : label}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-red-900">
          {errorLabel}
        </p>
      )}
    </div>
  );
}