import type { ReactNode } from "react";

export type Tab = "home" | "profile" | "past";

type Props = {
  tab: Tab;
  onChange: (t: Tab) => void;
  labels: Record<Tab, string>;
};

const icons: Record<Tab, ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  past: (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  ),
};

const order: Tab[] = ["home", "profile", "past"];

export function SideTabs({ tab, onChange, labels }: Props) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-screen w-20 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface px-1 py-4"
    >
      {order.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-current={tab === t ? "page" : undefined}
          className={`flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-xs font-medium ${
            tab === t ? "bg-primary text-primary-ink" : "text-ink"
          }`}
        >
          {icons[t]}
          <span>{labels[t]}</span>
        </button>
      ))}
    </nav>
  );
}