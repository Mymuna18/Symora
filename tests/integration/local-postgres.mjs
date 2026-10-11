// This module has no database, filesystem, environment, or Docker side effects.
export const TEST_IMAGE = "postgres:17";
export const TEST_USER = "symora_test";
export const RUN_LABEL = "com.symora.integration.run";
export const LOCAL_DOCKER_HOST = "unix:///var/run/docker.sock";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function requireSqlApproval(args) {
  if (args.length !== 1 || args[0] !== "--approve-local-sql") {
    throw new Error("Approval required: this runner initializes a disposable database, applies the migration, writes/deletes synthetic data, and removes its own test container. After explicit human approval, use --approve-local-sql. Database URLs and other arguments are not accepted.");
  }
}

export function runIdentity(runId) {
  if (!uuid.test(runId)) throw new Error("Invalid isolated test run identifier.");
  return {
    runId,
    containerName: `symora-pg-test-${runId}`,
    database: `symora_test_${runId.replaceAll("-", "")}`,
  };
}

// Docker must report a container belonging to this exact run before we connect.
export function verifyContainer(metadata, identity, imageId) {
  const expected = runIdentity(identity.runId);
  if (identity.database !== expected.database || identity.containerName !== expected.containerName
    || !/^sha256:[0-9a-f]{64}$/.test(imageId)
    || !metadata || !/^[0-9a-f]{64}$/.test(metadata.Id ?? "")
    || metadata.Name !== `/${expected.containerName}`
    || metadata.Config?.Labels?.[RUN_LABEL] !== expected.runId
    || metadata.Image !== imageId
    || metadata.HostConfig?.NetworkMode !== "bridge"
    || metadata.HostConfig?.Privileged !== false
    || metadata.HostConfig?.Binds?.length
    || !metadata.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"]
    || !Array.isArray(metadata.Mounts)
    || metadata.Mounts.some((mount) => mount.Type !== "tmpfs")) {
    throw new Error("Refusing an unverified or non-disposable PostgreSQL container.");
  }
  const bindings = metadata.NetworkSettings?.Ports?.["5432/tcp"];
  if (!Array.isArray(bindings) || bindings.length !== 1
    || bindings[0].HostIp !== "127.0.0.1"
    || !/^\d+$/.test(bindings[0].HostPort)
    || Number(bindings[0].HostPort) < 1024 || Number(bindings[0].HostPort) > 65535) {
    throw new Error("Refusing a PostgreSQL port that is not exclusively on local IPv4 loopback.");
  }
  return Object.freeze({
    host: "127.0.0.1", port: Number(bindings[0].HostPort),
    user: TEST_USER, database: expected.database,
  });
}

export function localPoolOptions(target, password) {
  const keys = Object.keys(target).sort();
  if (keys.join(",") !== "database,host,port,user"
    || target.host !== "127.0.0.1" || target.user !== TEST_USER
    || !/^symora_test_[0-9a-f]{32}$/.test(target.database)
    || !Number.isInteger(target.port) || target.port < 1024 || target.port > 65535
    || typeof password !== "string" || !/^[0-9a-f]{64}$/.test(password)) {
    throw new Error("Refusing non-local test database configuration.");
  }
  return {
    ...target, password, ssl: false, max: 2,
    connectionTimeoutMillis: 3_000, idleTimeoutMillis: 1_000,
    statement_timeout: 5_000, query_timeout: 10_000,
    application_name: "symora-isolated-integration",
    options: "-c search_path=public -c timezone=UTC",
  };
}

// Validate the runner-to-worker handoff without relying on JSON property order.
export function workerPoolOptions(received) {
  if (!received || typeof received !== "object" || Array.isArray(received)) throw new Error("Test configuration missing.");
  const options = localPoolOptions({ host: received.host, port: received.port, user: received.user, database: received.database }, received.password);
  if (Object.keys(received).sort().join(",") !== Object.keys(options).sort().join(",")
    || Object.entries(options).some(([key, value]) => received[key] !== value)) {
    throw new Error("Unexpected connection options.");
  }
  return options;
}

// Do not inherit DATABASE_URL, PG*, NODE_OPTIONS, Docker contexts, or credentials.
export function isolatedEnvironment(directory) {
  return {
    PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: directory, TMPDIR: directory, DOCKER_CONFIG: directory,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
