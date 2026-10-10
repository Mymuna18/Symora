// @ts-check
import { ReportError } from "./report-errors.mjs";
import { validateReport } from "./report-validation.mjs";

export const MAX_REPORT_BYTES = 65_536;

/** @param {Request} request @returns {Promise<unknown>} */
async function readJson(request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const encoding = request.headers.get("content-encoding")?.toLowerCase();
  if (contentType !== "application/json" || (encoding && encoding !== "identity")) {
    throw new ReportError(415, "UNSUPPORTED_MEDIA_TYPE", "Send an uncompressed application/json request.");
  }
  const tooLarge = () => new ReportError(413, "PAYLOAD_TOO_LARGE", "The report must not exceed 64 KiB.");
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_REPORT_BYTES) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ReportError(400, "INVALID_JSON", "A valid JSON body is required.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPORT_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(400, "INVALID_JSON", "A valid UTF-8 JSON body is required.");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Factory is the route's implementation and test seam; no framework or database
 * environment is required to exercise complete HTTP behavior with mocks.
 * @param {{
 * authenticate: (request: Request) => string | Promise<string>,
 * save: (participantId: string, input: import("../types/reports").SubmitReportRequest) => Promise<import("../types/reports").CreatedReport>
 * }} dependencies
 */
export function createReportHandler({ authenticate, save }) {
  /** @param {Request} request */
  return async function POST(request) {
    const headers = { "Cache-Control": "no-store" };
    try {
      const participantId = await authenticate(request);
      const input = validateReport(await readJson(request));
      const report = await save(participantId, input);
      return Response.json({ report }, { status: 201, headers });
    } catch (error) {
      const failure = error instanceof ReportError ? error
        : new ReportError(500, "INTERNAL_ERROR", "The request could not be completed.");
      return Response.json({ error: {
        code: failure.code, message: failure.message,
        ...(failure.field ? { field: failure.field } : {}),
      } }, {
        status: failure.status,
        headers: { ...headers, ...(failure.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
      });
    }
  };
}
