import { ApiError } from "@/lib/frontend-api";
import type { CoordinatorWorkflowStatus } from "@/types/reports";

// Matches PATCH /api/coordinator/reports/[reportId]/status
// - "reviewed" takes no note (the server rejects one)
// - "follow_up_requested" requires a nonempty note of at most 1000 characters
export const MAX_REVIEW_NOTE_LENGTH = 1000;

export type ReviewStatusInput =
  | { workflowStatus: "reviewed" }
  | { workflowStatus: "follow_up_requested"; reviewNote: string };

export type ReviewStatusResult = {
  report: { id: string; workflowStatus: CoordinatorWorkflowStatus };
  review: {
    previousWorkflowStatus: CoordinatorWorkflowStatus;
    newWorkflowStatus: CoordinatorWorkflowStatus;
    reviewerUserId: string;
    reviewNote: string | null;
    createdAt: string;
  };
};

export async function updateCoordinatorReportStatus(
  reportId: string,
  input: ReviewStatusInput,
  signal?: AbortSignal,
): Promise<ReviewStatusResult> {
  let response: Response;
  try {
    response = await fetch(`/api/coordinator/reports/${encodeURIComponent(reportId)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Symora-CSRF": "1",
      },
      body: JSON.stringify(input),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new Error("Could not reach the server. Please try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response; handled below.
  }

  if (!response.ok) {
    const failure = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      failure?.message ?? "The review update could not be completed.",
      response.status,
      failure?.code ?? "REVIEW_UPDATE_FAILED",
    );
  }
  return payload as ReviewStatusResult;
}