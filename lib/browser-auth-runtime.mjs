// @ts-check
import { createHash } from "node:crypto";
import { getPool } from "./db.mjs";
import { ReportError } from "./report-errors.mjs";
import { createBrowserAuthStore } from "./browser-auth-store.mjs";
import { createBrowserAuth } from "./browser-auth.mjs";

const store = createBrowserAuthStore({ getPool });
const pendingKey = Symbol.for("symora.browser-auth.pending.v1");
const cache = /** @type {typeof globalThis & {[key: symbol]: {value: number}}} */ (globalThis);
const pending = cache[pendingKey] ??= { value: 0 };

export const browserAuth = createBrowserAuth({ store, pending });

const analysisBucketHash = createHash("sha256")
  .update("symora:analysis:global:v1")
  .digest("hex");

export async function enforceSharedAnalysisRateLimit() {
  try {
    const result = await store.consumeRateLimit("analysis_global", analysisBucketHash, 120, 60_000);
    if (result.attempts > 120) {
      throw new ReportError(429, "RATE_LIMITED", "Rate limit exceeded.");
    }
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(503, "BROWSER_AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
  }
}
