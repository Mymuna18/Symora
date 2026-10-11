import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runLocalPostgres } from "../scripts/test-postgres.mjs";
import {
  RUN_LABEL, requireSqlApproval, runIdentity, verifyContainer,
  localPoolOptions, workerPoolOptions, isolatedEnvironment, LOCAL_DOCKER_HOST,
} from "./integration/local-postgres.mjs";

const runId = "11111111-1111-4111-8111-111111111111";
const identity = runIdentity(runId);
const imageId = `sha256:${"a".repeat(64)}`;
function metadata() {
  return {
    Id: "b".repeat(64), Name: `/${identity.containerName}`, Image: imageId,
    Config: { Labels: { [RUN_LABEL]: runId } },
    HostConfig: { NetworkMode: "bridge", Privileged: false, Binds: null, Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,size=512m" } },
    Mounts: [{ Type: "tmpfs" }],
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] } },
  };
}
const target = () => verifyContainer(metadata(), identity, imageId);

test("the runner rejects missing approval before inspecting Docker or opening connections", async () => {
  await assert.rejects(runLocalPostgres([]), /Approval required/);
});
for (const args of [[], ["--approve-local-sql", "postgres://shared.invalid/database"], ["--database-url=postgres://shared.invalid"], ["--approve"]]) {
  test(`approval gate rejects unsupported invocation ${JSON.stringify(args)}`, () => {
    assert.throws(() => requireSqlApproval(args), /Approval required/);
  });
}
test("approval parser accepts only the exact opt-in flag without performing any action", () => {
  assert.doesNotThrow(() => requireSqlApproval(["--approve-local-sql"]));
});
test("verified container yields a fixed loopback target and this run's database", () => {
  assert.deepEqual(target(), { host: "127.0.0.1", port: 55432, database: identity.database, user: "symora_test" });
  assert.ok(Object.isFrozen(target()));
  assert.equal(LOCAL_DOCKER_HOST, "unix:///var/run/docker.sock");
});

for (const [label, mutate] of [
  ["foreign run", (m) => { m.Config.Labels[RUN_LABEL] = "another-run"; }],
  ["missing label", (m) => { m.Config.Labels = {}; }],
  ["foreign image", (m) => { m.Image = `sha256:${"c".repeat(64)}`; }],
  ["foreign name", (m) => { m.Name = "/shared-postgres"; }],
  ["host networking", (m) => { m.HostConfig.NetworkMode = "host"; }],
  ["privileged container", (m) => { m.HostConfig.Privileged = true; }],
  ["bind mount", (m) => { m.HostConfig.Binds = ["/data:/data"]; }],
  ["persistent volume", (m) => { m.Mounts = [{ Type: "volume" }]; }],
  ["missing memory storage", (m) => { m.HostConfig.Tmpfs = {}; }],
  ["public port", (m) => { m.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0"; }],
  ["remote host", (m) => { m.NetworkSettings.Ports["5432/tcp"][0].HostIp = "tigerdata.invalid"; }],
  ["extra port binding", (m) => { m.NetworkSettings.Ports["5432/tcp"].push({ HostIp: "::", HostPort: "55432" }); }],
  ["invalid port", (m) => { m.NetworkSettings.Ports["5432/tcp"][0].HostPort = "65536"; }],
]) {
  test(`container guard rejects ${label}`, () => {
    const input = metadata(); mutate(input);
    assert.throws(() => verifyContainer(input, identity, imageId), /Refusing/);
  });
}

for (const changes of [
  { host: "shared.tigerdata.invalid" }, { host: "localhost" }, { host: "::1" },
  { database: "production" }, { user: "postgres" }, { port: 0 }, { port: "55432" },
  { connectionString: "postgres://shared.invalid/db" }, { ssl: { rejectUnauthorized: false } },
  { options: "-c search_path=production" },
]) {
  test(`pool guard rejects overrides ${Object.keys(changes).join(",")}`, () => {
    assert.throws(() => localPoolOptions({ ...target(), ...changes }, "f".repeat(64)), /Refusing/);
  });
}
test("pool options contain only explicit local settings and bounded timeouts", () => {
  const options = localPoolOptions(target(), "f".repeat(64));
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.database, identity.database);
  assert.equal(options.ssl, false);
  assert.equal(options.max, 2);
  assert.equal(options.statement_timeout, 5000);
  assert.equal(options.connectionString, undefined);
});
test("child environment is an allowlist with no inherited database or Docker credentials", () => {
  assert.deepEqual(Object.keys(isolatedEnvironment("/fictional/test-only")).sort(), ["DOCKER_CONFIG", "HOME", "NEXT_TELEMETRY_DISABLED", "PATH", "TMPDIR"]);
});

test("direct unapproved worker invocation fails before importing pg or executing SQL", async () => {
  const execute = promisify(execFile);
  await assert.rejects(execute(process.execPath, [fileURLToPath(new URL("./integration/postgres-worker.mjs", import.meta.url))], {
    env: {}, timeout: 10_000,
  }), (error) => error.code === 1 && error.stderr.includes("Isolated PostgreSQL preparation failed"));
});

test("worker accepts serialized connection options regardless of object property order", () => {
  const options = localPoolOptions(target(), "f".repeat(64));
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(options))).reverse());
  assert.deepEqual(workerPoolOptions(reordered), options);
});
test("worker rejects additional or changed connection settings", () => {
  const options = localPoolOptions(target(), "f".repeat(64));
  assert.throws(() => workerPoolOptions({ ...options, connectionString: "postgres://shared.invalid/db" }), /Unexpected/);
  assert.throws(() => workerPoolOptions({ ...options, ssl: true }), /Unexpected/);
  assert.throws(() => workerPoolOptions({ ...options, host: "shared.invalid" }), /Refusing/);
});
