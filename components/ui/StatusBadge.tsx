import type { ReviewStatus } from "@/lib/types";

const styles: Record<ReviewStatus, { label: string; cls: string }> = {
  new: { label: "● New", cls: "bg-blue-100 text-blue-900" },
  reviewed: { label: "✓ Reviewed", cls: "bg-green-100 text-green-900" },
  follow_up_requested: { label: "⚑ Follow-up requested", cls: "bg-amber-100 text-amber-900" },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const s = styles[status];
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${s.cls}`}>{s.label}</span>;
}