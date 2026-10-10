import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  TEST_IMAGE, TEST_USER, RUN_LABEL, LOCAL_DOCKER_HOST,
  requireSqlApproval, runIdentity, verifyContainer, localPoolOptions, isolatedEnvironment,
} from "../tests/integration/local-postgres.mjs";

const execute = promisify(execFile);

export async function runLocalPostgres(args) {
  // Must run before inspecting Docker, creating containers, importing pg, or SQL.
  requireSqlApproval(args);
  let docker;
  for (const candidate of ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker", "/usr/bin/docker"]) {
    try { await access(candidate, constants.X_OK); docker = candidate; break; } catch { /* Try next installed location. */ }
  }
  if (!docker) throw new Error("Docker is not installed in a supported local location. Install/start Docker Desktop before an approved test run.");
  try { await access("/var/run/docker.sock"); } catch {
    throw new Error("The local Docker socket /var/run/docker.sock is unavailable. Remote Docker hosts and contexts are not supported.");
  }

  const directory = await mkdtemp(join(tmpdir(), "symora-pg-test-"));
  const env = isolatedEnvironment(directory);
  const identity = runIdentity(randomUUID());
  // Fresh disposable credential: only passed privately to Docker and pg.
  const password = randomBytes(32).toString("hex");
  let containerId;
  let failed = false;
  const command = async (dockerArgs, additions = {}) => {
    const { stdout } = await execute(docker, ["--config", directory, "--host", LOCAL_DOCKER_HOST, ...dockerArgs], {
      env: { ...env, ...additions }, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  };
  try {
    let imageId;
    try { imageId = await command(["image", "inspect", "--format", "{{.Id}}", TEST_IMAGE]); } catch {
      throw new Error("The postgres:17 image is not available locally. Obtain the official image before an approved run; this runner never pulls images.");
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) throw new Error("Invalid local PostgreSQL image identity.");
    containerId = await command([
      "run", "--detach", "--rm", "--pull=never", "--name", identity.containerName,
      "--label", `${RUN_LABEL}=${identity.runId}`, "--network", "bridge",
      "--publish", "127.0.0.1::5432",
      "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=512m",
      "--memory", "768m", "--pids-limit", "128",
      "--env", "POSTGRES_PASSWORD", "--env", `POSTGRES_USER=${TEST_USER}`,
      "--env", `POSTGRES_DB=${identity.database}`,
      imageId,
    ], { POSTGRES_PASSWORD: password });
    const metadata = JSON.parse(await command(["inspect", containerId]));
    const target = verifyContainer(metadata[0], identity, imageId);

    // The child starts with a clean environment so pg cannot inherit PG* settings
    // or use a real password file. No .env loader is used anywhere in this runner.
    const childPath = fileURLToPath(new URL("../tests/integration/postgres-worker.mjs", import.meta.url));
    const options = localPoolOptions(target, password);
    const child = await execute(process.execPath, [childPath], {
      env: { ...env, SYMORA_ISOLATED_SQL_APPROVED: "yes", SYMORA_ISOLATED_PG: JSON.stringify(options) },
      timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    }).catch((error) => {
      // Only the worker's own test output is useful. Never print execFile errors:
      // their command/environment metadata can contain the synthetic credential.
      if (error.stdout) process.stdout.write(error.stdout);
      throw new Error("Isolated PostgreSQL checks failed; inspect the test results above.");
    });
    process.stdout.write(child.stdout);
  } catch (error) {
    failed = true;
    // Driver/Docker errors are not propagated to logs with connection details.
    if (error instanceof Error && /^(Docker is|The local Docker|The postgres:17|Invalid local|Isolated PostgreSQL|Refusing )/.test(error.message)) throw error;
    throw new Error("Local PostgreSQL setup failed. No shared database configuration was used.");
  } finally {
    if (containerId) {
      try {
        const label = await command(["inspect", "--format", `{{index .Config.Labels "${RUN_LABEL}"}}`, containerId]);
        if (label !== identity.runId || !/^[0-9a-f]{64}$/.test(containerId)) throw new Error("Ownership mismatch.");
        await command(["rm", "--force", containerId]);
      } catch {
        process.exitCode = 1;
        console.error("Could not verify/remove this run's disposable container. Inspect the container labeled with this run ID:", identity.runId);
      }
    }
    await rm(directory, { recursive: true, force: true });
    if (failed) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runLocalPostgres(process.argv.slice(2)); } catch (error) {
    console.error(error instanceof Error ? error.message : "Isolated test setup failed.");
    process.exitCode = 1;
  }
}
