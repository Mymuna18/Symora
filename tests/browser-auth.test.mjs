import test from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { createBrowserAuth, createBrowserState, readBrowserConfig, browserAuth } from "../lib/browser-auth.mjs";
import { createBrowserAuthHandlers } from "../lib/browser-auth-http.mjs";
import { authenticateParticipantRequest, authenticateCoordinatorRequest, withPrivateResponse } from "../lib/request-auth.mjs";

// Public, synthetic test material only. Tests run with an empty environment.
const password = "synthetic-browser-password";
const salt = "12".repeat(16);
const passwordHash = scryptSync(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1 }).toString("hex");
const participantId = "11111111-1111-4111-8111-111111111111";
const coordinatorId = "fictional-coordinator";
const now = Date.parse("2026-10-11T12:00:00.000Z");
const origin = "http://localhost:3000";
const key = Buffer.alloc(32, 7).toString("base64url");
const expiresAt = "2099-01-01T00:00:00.000Z";

function accounts() {
  return [
    { username: "fictional-participant", role: "participant", participantId, passwordSalt: salt, passwordHash, expiresAt },
    { username: "fictional-coordinator", role: "coordinator", coordinatorId, passwordSalt: salt, passwordHash, expiresAt },
  ];
}
function config() { return { origin, key, accounts: accounts(), production: false, cookieName: "symora_session" }; }
function fixture() {
  let clock = now;
  const state = createBrowserState();
  const configuration = config();
  const auth = createBrowserAuth({ state, now: () => clock, readConfig: () => configuration });
  return { auth, state, configuration, advance: (ms) => { clock += ms; } };
}
function request({ body = { username: "fictional-participant", password }, headers = {}, method = "POST", raw } = {}) {
  return new Request(`${origin}/api/auth/participant/login`, {
    method,
    headers: { "content-type": "application/json", origin, "x-symora-csrf": "1", ...headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: raw ?? JSON.stringify(body) }),
  });
}
function withoutHeader(name) {
  const req = request();
  req.headers.delete(name);
  return req;
}
const cookieHeader = (result) => result.cookie.split(";", 1)[0];
const errorIs = (status, code) => (error) => {
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  return true;
};
const validEnvironment = () => ({
  NODE_ENV: "test", SYMORA_BROWSER_AUTH_ENABLED: "true", SYMORA_BROWSER_AUTH_ORIGIN: origin,
  SYMORA_BROWSER_SESSION_KEY: key, SYMORA_BROWSER_ACCOUNTS: JSON.stringify(accounts()),
});
async function withEnvironment(changes, action) {
  const env = { ...validEnvironment(), ...changes };
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  try { return await action(); }
  finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

test("browser configuration accepts separate participant and coordinator identities", async () => {
  await withEnvironment({}, () => assert.deepEqual(readBrowserConfig(), config()));
});

for (const [label, changes] of [
  ["disabled", { SYMORA_BROWSER_AUTH_ENABLED: undefined }],
  ["missing signing key", { SYMORA_BROWSER_SESSION_KEY: undefined }],
  ["invalid signing key", { SYMORA_BROWSER_SESSION_KEY: "not-a-key" }],
  ["HTTP production origin", { NODE_ENV: "production" }],
  ["remote HTTP origin", { SYMORA_BROWSER_AUTH_ORIGIN: "http://symora.example" }],
  ["origin with path", { SYMORA_BROWSER_AUTH_ORIGIN: `${origin}/login` }],
  ["origin with credentials", { SYMORA_BROWSER_AUTH_ORIGIN: "https://user:password@symora.example" }],
  ["malformed accounts", { SYMORA_BROWSER_ACCOUNTS: "{" }],
  ["empty accounts", { SYMORA_BROWSER_ACCOUNTS: "[]" }],
  ["duplicate usernames", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([accounts()[0], accounts()[0]]) }],
  ["client identity confusion", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], coordinatorId }]) }],
  ["unsupported role", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], role: "admin" }]) }],
  ["invalid participant UUID", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], participantId: "bad" }]) }],
  ["plaintext password in config", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], password }]) }],
  ["invalid password hash", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], passwordHash: "invalid" }]) }],
  ["noncanonical expiry", { SYMORA_BROWSER_ACCOUNTS: JSON.stringify([{ ...accounts()[0], expiresAt: "2099-01-01" }]) }],
]) {
  test(`browser configuration fails closed for ${label}`, async () => {
    await withEnvironment(changes, () => assert.throws(readBrowserConfig, errorIs(503, "BROWSER_AUTH_UNAVAILABLE")));
  });
}

for (const role of ["participant", "coordinator"]) {
  test(`${role} login sets a private local cookie and authenticates its configured identity`, async () => {
    const { auth } = fixture();
    const result = await auth.login(request({ body: { username: `fictional-${role}`, password } }), role);
    assert.match(result.cookie, /^symora_session=/);
    assert.match(result.cookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600$/);
    assert.doesNotMatch(result.cookie, /Domain=|; Secure/);
    assert.equal(auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(result) } }), role), role === "participant" ? participantId : coordinatorId);
    assert.deepEqual(result.body, { authenticated: true, user: { role, username: `fictional-${role}` }, expiresAt: "2026-10-11T13:00:00.000Z" });
    assert.equal(JSON.stringify(result.body).includes(passwordHash), false);
    assert.equal(JSON.stringify(result.body).includes(participantId), false);
  });
}

test("production login uses a Secure host-only HttpOnly session cookie", async () => {
  await withEnvironment({ NODE_ENV: "production", SYMORA_BROWSER_AUTH_ORIGIN: "https://symora.example" }, async () => {
    const auth = createBrowserAuth({ state: createBrowserState(), now: () => now });
    const result = await auth.login(request({ headers: { origin: "https://symora.example" } }), "participant");
    assert.match(result.cookie, /^__Host-symora_session=/);
    assert.match(result.cookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
    assert.doesNotMatch(result.cookie, /Domain=/);
  });
});

test("incorrect passwords, unknown usernames, wrong login role, and expired accounts share a generic failure", async () => {
  for (const [body, role, expired] of [
    [{ username: "fictional-participant", password: "incorrect" }, "participant", false],
    [{ username: "unknown-account", password }, "participant", false],
    [{ username: "fictional-participant", password }, "coordinator", false],
    [{ username: "fictional-participant", password }, "participant", true],
  ]) {
    const { auth, state, configuration } = fixture();
    if (expired) configuration.accounts[0].expiresAt = new Date(now).toISOString();
    await assert.rejects(auth.login(request({ body }), role), (error) => {
      assert.equal(error.message, "Invalid username or password.");
      return errorIs(401, "INVALID_CREDENTIALS")(error);
    });
    assert.equal(state.sessions.size, 0);
  }
});

test("login accepts only username and password, never a client role or identity", async () => {
  for (const body of [
    {}, [], null, { username: "fictional-participant" },
    { username: "fictional-participant", password, role: "coordinator" },
    { username: "fictional-participant", password, participantId },
    { username: "fictional-participant", password, coordinatorId },
    { username: "fictional-participant", password: "" },
    { username: "fictional-participant", password: "a".repeat(257) },
    { username: "fictional-participant", password: 123 },
    { username: "UPPER CASE", password },
  ]) {
    await assert.rejects(fixture().auth.login(request({ body }), "participant"), errorIs(400, "INVALID_LOGIN"));
  }
});

test("login rejects malformed JSON, invalid UTF-8, and absent bodies", async () => {
  for (const req of [request({ raw: "{" }), request({ raw: Uint8Array.of(0xc3) }), request({ method: "GET" })]) {
    await assert.rejects(fixture().auth.login(req, "participant"), errorIs(400, "INVALID_LOGIN"));
  }
});

test("login enforces content type, encoding, and the body byte limit even with a forged length", async () => {
  for (const headers of [{ "content-type": "text/plain" }, { "content-encoding": "gzip" }]) {
    await assert.rejects(fixture().auth.login(request({ headers }), "participant"), errorIs(415, "UNSUPPORTED_MEDIA_TYPE"));
  }
  for (const headers of [{ "content-length": "2049" }, { "content-length": "nonsense" }]) {
    await assert.rejects(fixture().auth.login(request({ headers }), "participant"), errorIs(413, "PAYLOAD_TOO_LARGE"));
  }
  await assert.rejects(fixture().auth.login(request({ raw: "x".repeat(2049), headers: { "content-length": "2" } }), "participant"), errorIs(413, "PAYLOAD_TOO_LARGE"));
});

test("login fails CSRF checks for absent/wrong Origin, absent header, and a cross-site fetch", async () => {
  for (const req of [withoutHeader("origin"), withoutHeader("x-symora-csrf"),
    request({ headers: { origin: "https://other.example" } }),
    request({ headers: { "x-symora-csrf": "wrong" } }),
    request({ headers: { "sec-fetch-site": "cross-site" } }),
    request({ headers: { "sec-fetch-site": "same-site" } })]) {
    await assert.rejects(fixture().auth.login(req, "participant"), errorIs(403, "CSRF_REJECTED"));
  }
});

test("anonymous requests have no session and cannot access either protected role", () => {
  const { auth } = fixture();
  assert.deepEqual(auth.status(request({ method: "GET" })), { authenticated: false });
  for (const role of ["participant", "coordinator"]) assert.throws(() => auth.authenticate(request({ method: "GET" }), role), errorIs(401, "UNAUTHORIZED"));
});

test("sessions cannot cross participant/coordinator role boundaries", async () => {
  for (const role of ["participant", "coordinator"]) {
    const { auth } = fixture();
    const result = await auth.login(request({ body: { username: `fictional-${role}`, password } }), role);
    assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(result) } }), role === "participant" ? "coordinator" : "participant"), errorIs(403, "FORBIDDEN"));
  }
});

test("cookie-authenticated writes require CSRF proof while GET works without Origin", async () => {
  const { auth } = fixture();
  const result = await auth.login(request(), "participant");
  const cookie = cookieHeader(result);
  assert.equal(auth.authenticate(new Request(`${origin}/api/reports`, { headers: { cookie } }), "participant"), participantId);
  for (const headers of [
    { cookie }, { cookie, origin }, { cookie, origin: "https://other.example", "x-symora-csrf": "1" },
    { cookie, origin, "x-symora-csrf": "1", "sec-fetch-site": "cross-site" },
  ]) {
    assert.throws(() => auth.authenticate(new Request(`${origin}/api/reports`, { method: "POST", headers }), "participant"), errorIs(403, "CSRF_REJECTED"));
  }
  assert.equal(auth.authenticate(request({ headers: { cookie } }), "participant"), participantId);
});

test("session expiry is enforced server-side and capped at the configured account expiry", async () => {
  const { auth, advance, configuration } = fixture();
  configuration.accounts[0].expiresAt = new Date(now + 30_000).toISOString();
  const result = await auth.login(request(), "participant");
  assert.match(result.cookie, /Max-Age=30$/);
  advance(30_000);
  const req = request({ method: "GET", headers: { cookie: cookieHeader(result) } });
  assert.deepEqual(auth.status(req), { authenticated: false });
  assert.throws(() => auth.authenticate(req, "participant"), errorIs(401, "UNAUTHORIZED"));
});

test("tampered session ID, expiry, signature, and duplicate session cookies are rejected", async () => {
  const { auth } = fixture();
  const result = await auth.login(request(), "participant");
  const cookie = cookieHeader(result);
  const value = cookie.slice(cookie.indexOf("=") + 1);
  const [id, expiry, signature] = value.split(".");
  const flip = (text) => (text[0] === "A" ? "B" : "A") + text.slice(1);
  for (const invalid of [
    `symora_session=${flip(id)}.${expiry}.${signature}`,
    `symora_session=${id}.${Number(expiry) + 1000}.${signature}`,
    `symora_session=${id}.${expiry}.${flip(signature)}`,
    `${cookie}; ${cookie}`, `symora_session=invalid`,
  ]) {
    assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: invalid } }), "participant"), errorIs(401, "UNAUTHORIZED"));
  }
});

test("server configuration edits, account removal, and key rotation revoke existing sessions", async () => {
  for (const edit of [
    (cfg) => { cfg.origin = "https://changed.example"; },
    (cfg) => { cfg.accounts = cfg.accounts.slice(1); },
    (cfg) => { cfg.accounts[0].passwordHash = "00".repeat(64); },
    (cfg) => { cfg.accounts[0].participantId = "22222222-2222-4222-8222-222222222222"; },
    (cfg) => { cfg.accounts[0].expiresAt = new Date(now).toISOString(); },
    (cfg) => { cfg.key = Buffer.alloc(32, 8).toString("base64url"); },
  ]) {
    const { auth, configuration } = fixture();
    const result = await auth.login(request(), "participant");
    edit(configuration);
    assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(result) } }), "participant"), errorIs(401, "UNAUTHORIZED"));
  }
});

test("logout requires CSRF, clears the cookie, and invalidates replay server-side", async () => {
  const { auth } = fixture();
  const result = await auth.login(request(), "participant");
  const cookie = cookieHeader(result);
  assert.throws(() => auth.logout(new Request(`${origin}/api/auth/logout`, { method: "POST", headers: { cookie } })), errorIs(403, "CSRF_REJECTED"));
  assert.equal(auth.authenticate(request({ method: "GET", headers: { cookie } }), "participant"), participantId);
  assert.equal(auth.logout(request({ headers: { cookie } })), "symora_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie } }), "participant"), errorIs(401, "UNAUTHORIZED"));
});

test("successful login rotates an existing session and invalidates the old cookie", async () => {
  const { auth } = fixture();
  const first = await auth.login(request(), "participant");
  const second = await auth.login(request({ headers: { cookie: cookieHeader(first) } }), "participant");
  assert.notEqual(cookieHeader(first), cookieHeader(second));
  assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(first) } }), "participant"), errorIs(401, "UNAUTHORIZED"));
  assert.equal(auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(second) } }), "participant"), participantId);
});

test("switching roles through login revokes the earlier role's session", async () => {
  const { auth } = fixture();
  const participant = await auth.login(request(), "participant");
  const coordinator = await auth.login(request({ body: { username: "fictional-coordinator", password }, headers: { cookie: cookieHeader(participant) } }), "coordinator");
  assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(participant) } }), "participant"), errorIs(401, "UNAUTHORIZED"));
  assert.equal(auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(coordinator) } }), "coordinator"), coordinatorId);
  assert.throws(() => auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(coordinator) } }), "participant"), errorIs(403, "FORBIDDEN"));
});

test("a session from a previous process is not accepted by an empty server allowlist", async () => {
  const { auth } = fixture();
  const result = await auth.login(request(), "participant");
  assert.throws(() => fixture().auth.authenticate(request({ method: "GET", headers: { cookie: cookieHeader(result) } }), "participant"), errorIs(401, "UNAUTHORIZED"));
});

test("login rate limits cannot be bypassed by changing forwarded headers", async () => {
  const { auth, advance } = fixture();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(auth.login(request({ body: { username: "fictional-participant", password: "wrong" }, headers: { "x-forwarded-for": `192.0.2.${i}`, forwarded: `for=192.0.2.${i}`, "x-real-ip": `192.0.2.${i}` } }), "participant"), errorIs(401, "INVALID_CREDENTIALS"));
  }
  await assert.rejects(auth.login(request({ headers: { "x-forwarded-for": "192.0.2.200" } }), "participant"), errorIs(429, "LOGIN_RATE_LIMITED"));
  advance(15 * 60_000);
  assert.equal((await auth.login(request(), "participant")).body.authenticated, true);
});

test("unknown usernames share a bounded login-attempt bucket", async () => {
  const { auth, state } = fixture();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(auth.login(request({ body: { username: `unknown-${i}`, password } }), "participant"), errorIs(401, "INVALID_CREDENTIALS"));
  }
  await assert.rejects(auth.login(request({ body: { username: "unknown-new", password } }), "participant"), errorIs(429, "LOGIN_RATE_LIMITED"));
  assert.equal(state.attempts.size, 2);
});

test("global request and concurrent password-hash limits bound login work", async () => {
  const first = fixture();
  for (let i = 0; i < 30; i++) await assert.rejects(first.auth.login(request({ body: {} }), "participant"), errorIs(400, "INVALID_LOGIN"));
  await assert.rejects(first.auth.login(request(), "participant"), errorIs(429, "LOGIN_RATE_LIMITED"));
  const second = fixture();
  second.state.pending = 4;
  await assert.rejects(second.auth.login(request(), "participant"), errorIs(429, "LOGIN_RATE_LIMITED"));
  assert.equal(second.state.sessions.size, 0);
});

test("a configuration change during password verification prevents session creation", async () => {
  const state = createBrowserState();
  let reads = 0;
  const auth = createBrowserAuth({ state, now: () => now, readConfig: () => {
    const cfg = config();
    if (++reads > 1) cfg.key = Buffer.alloc(32, 8).toString("base64url");
    return cfg;
  } });
  await assert.rejects(auth.login(request(), "participant"), errorIs(503, "BROWSER_AUTH_UNAVAILABLE"));
  assert.equal(state.sessions.size, 0);
});

test("explicit invalid bearer credentials never fall back to a valid browser cookie", async () => {
  const validToken = "synthetic_bearer_token_".padEnd(43, "x");
  const tokenSha256 = createHash("sha256").update(validToken).digest("hex");
  await withEnvironment({
    SYMORA_DEMO_AUTH_ENABLED: "true", SYMORA_DEMO_PARTICIPANTS: JSON.stringify([{ participantId, tokenSha256, expiresAt }]),
    SYMORA_COORDINATOR_AUTH_ENABLED: "true", SYMORA_COORDINATORS: JSON.stringify([{ coordinatorId, tokenSha256, expiresAt }]),
  }, async () => {
    for (const [role, authenticate] of [["participant", authenticateParticipantRequest], ["coordinator", authenticateCoordinatorRequest]]) {
      const result = await browserAuth.login(request({ body: { username: `fictional-${role}`, password } }), role);
      const cookie = cookieHeader(result);
      const expected = role === "participant" ? participantId : coordinatorId;
      assert.equal(authenticate(request({ method: "GET", headers: { cookie } })), expected);
      assert.throws(() => authenticate(request({ method: "GET", headers: { cookie, authorization: "Bearer invalid" } })), errorIs(401, "UNAUTHORIZED"));
      assert.throws(() => authenticate(request({ method: "GET", headers: { cookie, authorization: "" } })), errorIs(401, "UNAUTHORIZED"));
      assert.equal(authenticate(request({ headers: { authorization: `Bearer ${validToken}` } })), expected);
      browserAuth.logout(request({ headers: { cookie } }));
    }
  });
});

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("vary"), /Cookie/);
  assert.match(response.headers.get("vary"), /Authorization/);
}

test("auth handlers return private, credential-free login/status responses and a 204 logout", async () => {
  const { auth } = fixture();
  const handlers = createBrowserAuthHandlers(auth);
  const login = await handlers.participantLogin(request());
  assert.equal(login.status, 200);
  assertPrivate(login);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const body = await login.json();
  assert.deepEqual(Object.keys(body).sort(), ["authenticated", "expiresAt", "user"]);
  assert.deepEqual(body.user, { role: "participant", username: "fictional-participant" });
  const status = await handlers.session(request({ method: "GET", headers: { cookie } }));
  assertPrivate(status);
  assert.deepEqual(await status.json(), body);
  const logout = await handlers.logout(request({ headers: { cookie } }));
  assert.equal(logout.status, 204);
  assertPrivate(logout);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(await logout.text(), "");
  const anonymous = await handlers.session(request({ method: "GET", headers: { cookie } }));
  assert.deepEqual(await anonymous.json(), { authenticated: false });
});

test("auth handlers sanitize unexpected failures and attach private headers to every error", async () => {
  const { auth } = fixture();
  const broken = createBrowserAuthHandlers({ ...auth, login: async () => { throw new Error("postgres://private:password@database SQL secret"); } });
  const unexpected = await broken.participantLogin(request());
  assert.equal(unexpected.status, 500);
  assertPrivate(unexpected);
  assert.deepEqual(await unexpected.json(), { error: { code: "AUTH_FAILED", message: "Authentication could not be completed." } });
  const csrf = await createBrowserAuthHandlers(auth).participantLogin(withoutHeader("origin"));
  assert.equal(csrf.status, 403);
  assertPrivate(csrf);
  assert.equal((await csrf.json()).error.code, "CSRF_REJECTED");
  assert.equal(csrf.headers.has("set-cookie"), false);
  const badLogin = await createBrowserAuthHandlers(auth).participantLogin(request({ body: { username: "fictional-participant", password: "wrong" } }));
  assert.equal(badLogin.status, 401);
  assertPrivate(badLogin);
  assert.equal(badLogin.headers.has("set-cookie"), false);
});

test("rate-limited HTTP responses include a retry delay without setting a session", async () => {
  const { auth, state } = fixture();
  state.pending = 4;
  const response = await createBrowserAuthHandlers(auth).participantLogin(request());
  assert.equal(response.status, 429);
  assertPrivate(response);
  assert.equal(response.headers.get("retry-after"), "900");
  assert.equal(response.headers.has("set-cookie"), false);
});

test("disabled browser configuration fails closed for login, session, and protected access", async () => {
  await withEnvironment({ SYMORA_BROWSER_AUTH_ENABLED: undefined }, async () => {
    const auth = createBrowserAuth({ state: createBrowserState() });
    const handlers = createBrowserAuthHandlers(auth);
    for (const response of [await handlers.participantLogin(request()), await handlers.session(request({ method: "GET" }))]) {
      assert.equal(response.status, 503);
      assertPrivate(response);
      assert.equal((await response.json()).error.code, "BROWSER_AUTH_UNAVAILABLE");
    }
    assert.throws(() => auth.authenticate(request({ method: "GET" }), "coordinator"), errorIs(503, "BROWSER_AUTH_UNAVAILABLE"));
  });
});

test("runtime header access occurs before handler catches, preventing cached auth responses", async () => {
  const request = new Request(`${origin}/api/auth/session`);
  const signal = new Error("Synthetic Next prerender stop");
  Object.defineProperty(request, "headers", { get() { throw signal; } });
  const handler = withPrivateResponse(() => assert.fail("handler must not swallow the runtime boundary"));
  await assert.rejects(handler(request), (error) => error === signal);
});
