import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Manual, local provisioning only. No environment files, databases or networks.
export function provisionBrowserAuth(args, outputRoot = tmpdir()) {
  if (args.length !== 4 || args[0] !== "--participant-id" || args[2] !== "--origin"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) {
    throw new Error("Usage: node scripts/provision-browser-auth.mjs --participant-id EXISTING_FICTIONAL_UUID --origin APP_ORIGIN");
  }
  const origin = new URL(args[3]);
  if (origin.origin !== args[3] || origin.username || origin.password
    || (origin.protocol !== "https:" && (origin.protocol !== "http:"
      || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) {
    throw new Error("Use an exact HTTPS origin, or HTTP loopback origin for local development.");
  }
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const logins = [], accounts = [];
  for (const role of ["participant", "coordinator"]) {
    const username = `demo-${role}`;
    const password = randomBytes(24).toString("base64url");
    const passwordSalt = randomBytes(16).toString("hex");
    const passwordHash = scryptSync(password, Buffer.from(passwordSalt, "hex"), 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    logins.push({ username, password, role, expiresAt });
    accounts.push({ username, role, ...(role === "participant" ? { participantId: args[1] } : { coordinatorId: "demo-coordinator" }),
      passwordSalt, passwordHash, expiresAt });
  }
  const directory = mkdtempSync(join(outputRoot, "symora-browser-auth-"));
  writeFileSync(join(directory, "server.env"), [
    "SYMORA_BROWSER_AUTH_ENABLED=true", `SYMORA_BROWSER_AUTH_ORIGIN=${origin.origin}`,
    `SYMORA_BROWSER_SESSION_KEY=${randomBytes(32).toString("base64url")}`,
    `SYMORA_BROWSER_ACCOUNTS='${JSON.stringify(accounts)}'`, "",
  ].join("\n"), { mode: 0o600 });
  writeFileSync(join(directory, "logins.json"), JSON.stringify(logins, null, 2), { mode: 0o600 });
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log("Private provisioning files:", provisionBrowserAuth(process.argv.slice(2)));
    console.log("Configure server.env manually and distribute logins.json privately. No existing configuration was modified.");
  } catch {
    console.error("Provisioning failed. Supply --participant-id EXISTING_FICTIONAL_UUID --origin APP_ORIGIN; use HTTPS or local loopback HTTP.");
    process.exitCode = 1;
  }
}
