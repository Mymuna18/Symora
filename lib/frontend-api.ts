import type {
  AnalyzeRequest,
  AnalyzeResponse,
  BrowserSession,
  CoordinatorReportsResponse,
  PrepareReportRequest,
  PrepareReportResponse,
  SubmitReportRequest,
  SubmitReportResponse,
} from "@/types/reports";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.method?.toUpperCase() === "POST" ? { "X-Symora-CSRF": "1" } : {}),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Unable to reach Symora. Check your connection and try again.", 0);
  }

  let body: unknown = null;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const detail = envelope.error;
    const error = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
    const message =
      typeof detail === "string"
        ? detail
        : typeof error.message === "string"
          ? error.message
          : `The request failed (${response.status}).`;
    throw new ApiError(
      message,
      response.status,
      typeof error.code === "string" ? error.code : undefined,
      typeof error.field === "string" ? error.field : undefined,
    );
  }

  return body as T;
}

function postJson<T>(path: string, body: unknown) {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function analyzeReport(input: AnalyzeRequest) {
  return postJson<AnalyzeResponse>("/api/analyze", input);
}

export function prepareReport(input: PrepareReportRequest) {
  return postJson<PrepareReportResponse>("/api/reports/prepare", input);
}

export function submitReport(input: SubmitReportRequest) {
  return postJson<SubmitReportResponse>("/api/reports", input);
}

export function getBrowserSession(signal?: AbortSignal) {
  return requestJson<BrowserSession>("/api/auth/session", { method: "GET", signal });
}

export function loginParticipant(username: string, password: string) {
  return postJson<BrowserSession>("/api/auth/participant/login", { username, password });
}

export function loginCoordinator(username: string, password: string) {
  return postJson<BrowserSession>("/api/auth/coordinator/login", { username, password });
}

export function logoutBrowserSession() {
  return requestJson<null>("/api/auth/logout", { method: "POST" });
}

export function getCoordinatorReports(
  pagination: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    limit: String(pagination.limit ?? 20),
    offset: String(pagination.offset ?? 0),
  });
  return requestJson<CoordinatorReportsResponse>(`/api/coordinator/reports?${query}`, {
    method: "GET",
    signal,
  });
}