import type { ReviewStatus } from "@/lib/types";

const styles: Record<ReviewStatus, { label: string; full: string; cls: string }> = {
  new: { label: "● New", full: "New", cls: "bg-blue-100 text-blue-900" },
  reviewed: { label: "✓ Reviewed", full: "Reviewed", cls: "bg-green-100 text-green-900" },
  follow_up_requested: {
    label: "⚑ Follow-up",
    full: "Follow-up requested",
    cls: "bg-amber-100 text-amber-900",
  },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const s = styles[status];
  return (
    <span
      title={s.full}
      className={`inline-flex h-8 w-28 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}