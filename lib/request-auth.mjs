// @ts-check
import { authenticateDemoParticipant } from "./demo-auth.mjs";
import { authenticateCoordinator } from "./coordinator-auth.mjs";
import { browserAuth } from "./browser-auth-runtime.mjs";

/** @param {Request} request */
export async function authenticateParticipantRequest(request) {
  // An explicit Authorization header must succeed on its own, never fall back.
  if (request.headers.has("authorization")) return authenticateDemoParticipant(request);
  if (request.headers.has("cookie")) return await browserAuth.authenticate(request, "participant");
  // Preserve existing bearer-client behavior when neither credential is sent.
  if (process.env.SYMORA_BROWSER_AUTH_ENABLED === "true") return await browserAuth.authenticate(request, "participant");
  return authenticateDemoParticipant(request);
}

/** @param {Request} request */
export async function authenticateCoordinatorRequest(request) {
  if (request.headers.has("authorization")) return authenticateCoordinator(request);
  if (request.headers.has("cookie")) return await browserAuth.authenticate(request, "coordinator");
  if (process.env.SYMORA_BROWSER_AUTH_ENABLED === "true") return await browserAuth.authenticate(request, "coordinator");
  return authenticateCoordinator(request);
}

/** @param {(request: Request) => Promise<Response> | Response} handler */
export function withPrivateResponse(handler) {
  /** @param {Request} request */
  return async (request) => {
    // Keep protected GETs dynamic with cacheComponents, even if configuration
    // is absent. Read outside handler catches so Next can stop prerendering.
    request.headers.get("cookie");
    const response = await handler(request);
    response.headers.set("Cache-Control", "no-store");
    const vary = new Set((response.headers.get("Vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
    vary.add("Cookie"); vary.add("Authorization");
    response.headers.set("Vary", [...vary].join(", "));
    return response;
  };
}
