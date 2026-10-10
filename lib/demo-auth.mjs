// @ts-check
import { createHash, timingSafeEqual } from "node:crypto";
import { ReportError } from "./report-errors.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Node-only authentication. Configuration is read only on a request, never on import.
 * The server stores hashes of separately provisioned, random participant tokens.
 * @param {Request} request
 * @param {() => {enabled?: string, participants?: string}} [readConfig]
 * @param {() => number} [now]
 * @returns {string} Authenticated participant UUID, never a client-supplied identity.
 */
export function authenticateDemoParticipant(request, readConfig = () => ({
  enabled: process.env.SYMORA_DEMO_AUTH_ENABLED,
  participants: process.env.SYMORA_DEMO_PARTICIPANTS,
}), now = Date.now) {
  const unavailable = () => new ReportError(503, "DEMO_AUTH_UNAVAILABLE", "Demo authentication is not configured.");
  const unauthorized = () => new ReportError(401, "UNAUTHORIZED", "A valid participant bearer token is required.");
  const config = readConfig();
  if (config.enabled !== "true" || !config.participants) throw unavailable();

  /** @type {unknown} */
  let entries;
  try { entries = JSON.parse(config.participants); } catch { throw unavailable(); }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) throw unavailable();
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object"
      || Object.keys(entry).some((key) => !["tokenSha256", "participantId", "expiresAt"].includes(key))
      || typeof entry.tokenSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(entry.tokenSha256)
      || typeof entry.participantId !== "string" || !uuid.test(entry.participantId)
      || typeof entry.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.expiresAt)
      || !Number.isFinite(Date.parse(entry.expiresAt))
      || new Date(entry.expiresAt).toISOString() !== entry.expiresAt
      || seen.has(entry.tokenSha256.toLowerCase())) throw unavailable();
    seen.add(entry.tokenSha256.toLowerCase());
  }

  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw unauthorized();
  const digest = createHash("sha256").update(match[1]).digest();
  let participantId;
  for (const entry of entries) {
    const matches = timingSafeEqual(digest, Buffer.from(entry.tokenSha256, "hex"));
    if (matches && Date.parse(entry.expiresAt) > now()) participantId = entry.participantId;
  }
  if (!participantId) throw unauthorized();
  return participantId;
}
