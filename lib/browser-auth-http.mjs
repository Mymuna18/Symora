// @ts-check
import { browserAuth } from "./browser-auth.mjs";
import { ReportError } from "./report-errors.mjs";
import { withPrivateResponse } from "./request-auth.mjs";

/** @param {ReturnType<import("./browser-auth.mjs").createBrowserAuth>} [auth] */
export function createBrowserAuthHandlers(auth = browserAuth) {
  /** @param {(request: Request) => Promise<Response> | Response} action */
  const safe = (action) => withPrivateResponse(async (request) => {
    try { return await action(request); } catch (error) {
      const failure = error instanceof ReportError ? error
        : new ReportError(500, "AUTH_FAILED", "Authentication could not be completed.");
      return Response.json({ error: { code: failure.code, message: failure.message } }, {
        status: failure.status,
        headers: failure.status === 429 ? { "Retry-After": "900" } : {},
      });
    }
  });
  /** @param {"participant" | "coordinator"} role */
  const login = (role) => safe(async (request) => {
    const result = await auth.login(request, role);
    return Response.json(result.body, { headers: { "Set-Cookie": result.cookie } });
  });
  return {
    participantLogin: login("participant"), coordinatorLogin: login("coordinator"),
    session: safe((request) => Response.json(auth.status(request))),
    logout: safe((request) => new Response(null, { status: 204, headers: { "Set-Cookie": auth.logout(request) } })),
  };
}

export const browserAuthHandlers = createBrowserAuthHandlers();
