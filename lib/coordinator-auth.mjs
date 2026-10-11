// @ts-check
import { createHash, timingSafeEqual } from "node:crypto";
import { ReportError } from "./report-errors.mjs";

/**
 * Separate server-only credentials; participant authentication grants no access.
 * @param {Request} request
 * @param {() => {enabled?: string, coordinators?: string}} [readConfig]
 * @param {() => number} [now]
 * @returns {string} Server-configured coordinator identity.
 */
export function authenticateCoordinator(request, readConfig = () => ({
  enabled: process.env.SYMORA_COORDINATOR_AUTH_ENABLED,
  coordinators: process.env.SYMORA_COORDINATORS,
}), now = Date.now) {
  const unavailable = () => new ReportError(503, "COORDINATOR_AUTH_UNAVAILABLE", "Coordinator authentication is not configured.");
  const unauthorized = () => new ReportError(401, "UNAUTHORIZED", "A valid coordinator bearer token is required.");
  const config = readConfig();
  if (config.enabled !== "true" || !config.coordinators) throw unavailable();
  let entries;
  try { entries = JSON.parse(config.coordinators); } catch { throw unavailable(); }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) throw unavailable();
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object"
      || Object.keys(entry).some((key) => !["tokenSha256", "coordinatorId", "expiresAt"].includes(key))
      || typeof entry.tokenSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(entry.tokenSha256)
      || typeof entry.coordinatorId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.coordinatorId)
      || typeof entry.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.expiresAt)
      || !Number.isFinite(Date.parse(entry.expiresAt))
      || new Date(entry.expiresAt).toISOString() !== entry.expiresAt
      || seen.has(entry.tokenSha256.toLowerCase())) throw unavailable();
    seen.add(entry.tokenSha256.toLowerCase());
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw unauthorized();
  const digest = createHash("sha256").update(match[1]).digest();
  let coordinatorId;
  for (const entry of entries) {
    const matches = timingSafeEqual(digest, Buffer.from(entry.tokenSha256, "hex"));
    if (matches && Date.parse(entry.expiresAt) > now()) coordinatorId = entry.coordinatorId;
  }
  if (!coordinatorId) throw unauthorized();
  return coordinatorId;
}
