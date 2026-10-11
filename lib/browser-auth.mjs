// @ts-check
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ReportError } from "./report-errors.mjs";

const SESSION_MS = 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1 };
/** @param {string} password @param {Buffer} salt @returns {Promise<Buffer>} */
const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, SCRYPT, (error, result) => error ? reject(error) : resolve(result));
});
const unauthorized = () => new ReportError(401, "UNAUTHORIZED", "Authentication required.");
const unavailable = () => new ReportError(503, "BROWSER_AUTH_UNAVAILABLE", "Browser authentication is unavailable.");
/** @param {"auth-enabled" | "origin" | "session-key-format" | "accounts-json-format" | "account-schema"} category */
const invalidConfiguration = (category) => {
  console.error("[symora] browser auth configuration validation failed", { category });
  return unavailable();
};

/** @param {string} text */
const digest = (text) => createHash("sha256").update(text).digest("hex");
/** @param {unknown} value */
const canonicalDate = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function readBrowserConfig() {
  try {
    if (process.env.SYMORA_BROWSER_AUTH_ENABLED !== "true") throw invalidConfiguration("auth-enabled");
    const origin = process.env.SYMORA_BROWSER_AUTH_ORIGIN;
    let url;
    try {
      url = new URL(origin ?? "");
    } catch {
      url = null;
    }
    if (!url) throw invalidConfiguration("origin");
    const production = process.env.NODE_ENV === "production";
    if (url.origin !== origin || url.username || url.password
      || (url.protocol !== "https:" && (production || url.protocol !== "http:"
        || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw invalidConfiguration("origin");
    const key = process.env.SYMORA_BROWSER_SESSION_KEY ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(key) || Buffer.from(key, "base64url").toString("base64url") !== key) {
      throw invalidConfiguration("session-key-format");
    }
    let accounts;
    try {
      accounts = JSON.parse(process.env.SYMORA_BROWSER_ACCOUNTS ?? "null");
    } catch {
      throw invalidConfiguration("accounts-json-format");
    }
    if (!Array.isArray(accounts) || !accounts.length || accounts.length > 100) {
      throw invalidConfiguration("accounts-json-format");
    }
    const seen = new Set();
    for (const account of accounts) {
      if (!account || typeof account !== "object" || Array.isArray(account)
        || !["participant", "coordinator"].includes(account.role)) throw invalidConfiguration("account-schema");
      const idKey = account.role === "participant" ? "participantId" : "coordinatorId";
      if (Object.keys(account).some((key) => !["username", "role", idKey, "passwordSalt", "passwordHash", "expiresAt"].includes(key))
        || typeof account.username !== "string" || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(account.username)
        || seen.has(account.username)
        || typeof account[idKey] !== "string"
        || !(idKey === "participantId" ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i : /^[A-Za-z0-9_-]{1,64}$/).test(account[idKey])
        || typeof account.passwordSalt !== "string" || !/^[0-9a-f]{32}$/.test(account.passwordSalt)
        || typeof account.passwordHash !== "string" || !/^[0-9a-f]{128}$/.test(account.passwordHash)
        || !canonicalDate(account.expiresAt)) throw invalidConfiguration("account-schema");
      seen.add(account.username);
    }
    return { origin, key, accounts, production,
      cookieName: production ? "__Host-symora_session" : "symora_session" };
  } catch { throw unavailable(); }
}

/** @param {Request} request @param {ReturnType<typeof readBrowserConfig>} config */
export function requireBrowserCsrf(request, config) {
  const site = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== config.origin
    || request.headers.get("x-symora-csrf") !== "1"
    || (site !== null && !["same-origin", "none"].includes(site))) {
    throw new ReportError(403, "CSRF_REJECTED", "A same-origin request with the CSRF header is required.");
  }
}

/** @param {{store: ReturnType<import("./browser-auth-store.mjs").createBrowserAuthStore>,
 * now?: () => number, readConfig?: typeof readBrowserConfig, pending?: {value: number}}} options */
export function createBrowserAuth({ store, now = Date.now, readConfig = readBrowserConfig, pending = { value: 0 } }) {
  if (!store) throw new TypeError("A shared browser-auth store is required.");

  /** @param {Request} request @param {ReturnType<typeof readBrowserConfig>} config */
  function cookieValue(request, config) {
    const matches = (request.headers.get("cookie") ?? "").split(";")
      .map((part) => part.trim()).filter((part) => part.split("=", 1)[0] === config.cookieName);
    if (matches.length !== 1) return null;
    return matches[0].slice(config.cookieName.length + 1);
  }

  /** @param {string} payload @param {ReturnType<typeof readBrowserConfig>} config */
  const sign = (payload, config) => createHmac("sha256", Buffer.from(config.key, "base64url"))
    .update(`${config.cookieName}.${payload}`).digest("base64url");

  /** @param {ReturnType<typeof readBrowserConfig>["accounts"][number]} account @param {ReturnType<typeof readBrowserConfig>} config */
  const accountKeyHash = (account, config) => createHmac("sha256", Buffer.from(config.key, "base64url"))
    .update(`symora:browser-auth:account:v1:${account.role}:${account.username}`).digest("hex");

  /** @param {Request} request @param {ReturnType<typeof readBrowserConfig>} config */
  async function findSession(request, config) {
    const value = cookieValue(request, config);
    if (!value || value.length > 200) return null;
    const match = /^([A-Za-z0-9_-]{43})\.(\d{10,13})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return null;
    const [, id, expiry, signature] = match;
    const expected = sign(`${id}.${expiry}`, config);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const sessionIdHash = digest(id);
    let session;
    try { session = await store.findSession(sessionIdHash); } catch { throw unavailable(); }
    if (!session) return null;
    if (typeof session.accountKeyHash !== "string" || !/^[0-9a-f]{64}$/.test(session.accountKeyHash)
      || (session.role !== "participant" && session.role !== "coordinator")
      || typeof session.configFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(session.configFingerprint)
      || !Number.isSafeInteger(session.expires)) throw unavailable();
    if (session.expires !== Number(expiry) || session.expires <= now()) {
      try { await store.deleteSession(sessionIdHash); } catch { throw unavailable(); }
      return null;
    }
    const fingerprint = digest(JSON.stringify(config));
    const account = config.accounts.find((entry) => {
      if (entry.role !== session.role) return false;
      const expectedAccountHash = Buffer.from(accountKeyHash(entry, config));
      const storedAccountHash = Buffer.from(String(session.accountKeyHash));
      return storedAccountHash.length === expectedAccountHash.length
        && timingSafeEqual(storedAccountHash, expectedAccountHash);
    });
    if (!account || fingerprint !== session.configFingerprint || Date.parse(account.expiresAt) <= now()) {
      try { await store.deleteSession(sessionIdHash); } catch { throw unavailable(); }
      return null;
    }
    return { idHash: sessionIdHash, session, account };
  }

  /** @param {ReturnType<typeof readBrowserConfig>} config @param {string} value @param {number} maxAge */
  function cookie(config, value, maxAge) {
    return `${config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? "; Secure" : ""}`;
  }

  /** @param {{role: string, username: string, expires: number}} session */
  const publicSession = (session) => ({ authenticated: true,
    user: { role: session.role, username: session.username }, expiresAt: new Date(session.expires).toISOString() });

  /** @param {Request} request @param {"participant" | "coordinator"} role */
  async function authenticate(request, role) {
    const config = readConfig();
    const found = await findSession(request, config);
    if (!found) throw unauthorized();
    if (found.session.role !== role) throw new ReportError(403, "FORBIDDEN", "This session cannot access this endpoint.");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) requireBrowserCsrf(request, config);
    return role === "participant" ? found.account.participantId : found.account.coordinatorId;
  }

  /** @param {Request} request */
  async function status(request) {
    const found = findSession(request, readConfig());
    const session = await found;
    return session ? publicSession({ ...session.session, username: session.account.username }) : { authenticated: false };
  }

  /** @param {Request} request */
  async function logout(request) {
    const config = readConfig();
    requireBrowserCsrf(request, config);
    const found = await findSession(request, config);
    if (found) {
      try { await store.deleteSession(found.idHash); } catch { throw unavailable(); }
    }
    return cookie(config, "", 0);
  }

  /** @param {ReturnType<typeof readBrowserConfig>} config
   * @param {"login_global" | "login_account" | "login_unknown"} scope
   * @param {string} key @param {number} max @param {number} window */
  async function limit(config, scope, key, max, window) {
    const bucketHash = createHmac("sha256", Buffer.from(config.key, "base64url"))
      .update(`symora:browser-auth:rate:v1:${scope}:${key}`).digest("hex");
    let result;
    try { result = await store.consumeRateLimit(scope, bucketHash, max, window); } catch { throw unavailable(); }
    if (result.attempts > max) {
      throw new ReportError(429, "LOGIN_RATE_LIMITED", "Too many login attempts. Please wait before trying again.");
    }
  }

  /** @param {Request} request @param {"participant" | "coordinator"} role */
  async function login(request, role) {
    const config = readConfig();
    requireBrowserCsrf(request, config);
    await limit(config, "login_global", "global", 30, 60_000);
    const input = await readLogin(request);
    const account = config.accounts.find((entry) => entry.username === input.username && entry.role === role);
    // Unknown usernames share a bucket; arbitrary input cannot grow memory.
    await limit(config, account ? "login_account" : "login_unknown", account ? `${account.role}:${account.username}` : "unknown", 5, 15 * 60_000);
    if (pending.value >= 4) throw new ReportError(429, "LOGIN_RATE_LIMITED", "Too many login attempts. Please wait before trying again.");
    pending.value++;
    let hash;
    try {
      // Perform the same expensive hash for unknown accounts as for known ones.
      hash = await derive(input.password, Buffer.from(account?.passwordSalt ?? "00".repeat(16), "hex"));
    } finally { pending.value--; }
    const matches = timingSafeEqual(hash, Buffer.from(account?.passwordHash ?? "00".repeat(64), "hex"));
    if (!matches || !account || Date.parse(account.expiresAt) <= now()) {
      throw new ReportError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }
    // A configuration edit during password verification must not issue a session.
    if (JSON.stringify(readConfig()) !== JSON.stringify(config)) throw unavailable();
    const previous = await findSession(request, config);
    const id = randomBytes(32).toString("base64url");
    const expires = Math.min(now() + SESSION_MS, Date.parse(account.expiresAt));
    const session = { username: account.username, role, expires };
    try {
      await store.replaceSession(previous?.idHash ?? null, {
        sessionIdHash: digest(id),
        accountKeyHash: accountKeyHash(account, config),
        role,
        configFingerprint: digest(JSON.stringify(config)),
        createdAt: now(),
        expires,
      });
    } catch { throw unavailable(); }
    const payload = `${id}.${expires}`;
    return { body: publicSession(session), cookie: cookie(config, `${payload}.${sign(payload, config)}`, Math.floor((expires - now()) / 1000)) };
  }
  return { authenticate, login, status, logout };
}

/** @param {Request} request */
async function readLogin(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) {
    throw new ReportError(415, "UNSUPPORTED_MEDIA_TYPE", "Send uncompressed application/json.");
  }
  const tooLarge = () => new ReportError(413, "PAYLOAD_TOO_LARGE", "Login request is too large.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 2048)) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ReportError(400, "INVALID_LOGIN", "Provide username and password only.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { void reader.cancel().catch(() => {}); throw tooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["username", "password"].includes(key))
      || typeof body.username !== "string" || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(body.username)
      || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256) throw new Error();
    return body;
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(400, "INVALID_LOGIN", "Provide username and password only.");
  } finally { reader.releaseLock(); }
}
