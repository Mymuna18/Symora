# Local backend verification (Elvin-owned)

## Current status

Next.js type generation succeeded in a temporary project containing only reviewed
configuration/source files and a link to installed dependencies. No environment
files were copied, and the child process received a clean environment. The generated
`next-env.d.ts` and `.next/types/*` declarations were copied back. Frontend files and
the existing Next.js/TypeScript configuration were not edited.

Those generated files are already Git-ignored. A clean checkout needs type generation
before a repository-wide TypeScript check. The supported command is `next typegen`;
it loads Next.js configuration and normally can load environment files. To repeat
the secret-free procedure, run the installed command in a clean temporary copy of
the reviewed configuration and source with no `.env*` files and a clean child
environment, then copy only its generated declarations back. Do not run it against
the original checkout while a no-secret-access restriction is in effect.

The isolated PostgreSQL tests are implemented but have NOT been executed. No Docker
or PostgreSQL runtime was found in the checked PATH/common macOS installation
locations during preparation. Runtime installation, obtaining the test image, and
explicit SQL approval are prerequisites to the first real-database test run.

## Checks that need no database

```sh
node --test tests/*.test.mjs
npm run lint
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The root test glob deliberately excludes the integration worker/suite. The safety
tests use fictional container metadata and do not start Docker, connect to a database,
or execute SQL. Importing the suite does not execute it.

## Disposable database boundary

`scripts/test-postgres.mjs` accepts no URLs, hostnames, database names, or connection
options. It requires the exact `--approve-local-sql` flag, and an agent must also have
explicit human approval before using it. A flag alone is not human authorization.

The runner:

1. Uses a local Docker binary and the Unix socket `/var/run/docker.sock`, with a
   temporary empty Docker configuration. Remote Docker contexts are not used.
2. Requires the official `postgres:17` image to be present locally. It never pulls
   an image. PostgreSQL 17 is the isolated baseline, not a claim about TigerData's
   version or extensions. Confirm compatibility with the shared service separately.
3. Starts a uniquely named/labeled container with a fresh per-run database name,
   random disposable password, in-memory database storage, and one port published
   only on `127.0.0.1`. It pins that run to the inspected local image ID.
4. Verifies the run label, name, image ID, memory-only mounts, bridge networking,
   and local port before constructing any PostgreSQL pool.
5. Passes explicit local connection settings to a clean child environment. It never
   reads `DATABASE_URL`, `.env.local`, existing passwords, Docker credentials, or
   inherited `PG*` values. The worker rejects inherited database settings by name.
6. Checks the database/user identity and that the public schema has no tables.
7. Applies `001_initial_schema.sql` in a transaction, seeds only synthetic fixtures,
   then runs the integration suite. Each case clears only this run's report tables.
8. Closes connections and removes only the owned, labeled container. It never prunes
   Docker resources or deletes an existing local/shared database.

The ephemeral password is passed privately, never printed, saved to the repository,
or embedded in command arguments. The test container is disposable; do not put real
participant data or any shared credentials in it.

Docker run options follow the [Docker CLI reference](https://docs.docker.com/reference/cli/docker/container/run/).
Image initialization follows the [official PostgreSQL image documentation](https://hub.docker.com/_/postgres).

## Approval required before execution

After installing/starting local Docker and obtaining the official image, ask for
approval for this exact scope: create a disposable local PostgreSQL instance, execute
the initial migration, insert/delete synthetic data, run constraint and submission
tests, and remove that instance afterward. Starting the image itself initializes a
database, so it also belongs inside this approval boundary.

Only after approval:

```sh
node scripts/test-postgres.mjs --approve-local-sql
```

Do not run `postgres-worker.mjs` directly. Do not point any integration tool at shared
TigerData. A run is unsuccessful if tests fail or container cleanup cannot be verified.
If interrupted, inspect only the uniquely labeled test container; never use blanket
cleanup commands. No setup, migration, seed, or teardown SQL has been executed yet.

## Coverage prepared for real PostgreSQL

- Exactly five tables and four foreign keys; foreign-key rejection and deletion rules.
- Submitted transcript/timestamp requirements, incomplete drafts, atomic draft submission.
- Nullable 0–10 participant intensity and duplicate symptom-link rejection.
- Valid review records and inconsistent audit-record rejection.
- HTTP-handler submission with real persistence, server timestamp, and exact multilingual text.
- Unknown/inactive catalog codes and withdrawn participants save nothing.
- A real SQL constraint failure on the second symptom insert rolls back the report
  and the already-inserted first symptom.

The suite exercises the existing HTTP handler with real PostgreSQL; it does not start
a Next.js HTTP server, Gemini, ElevenLabs, or the frontend. Cookie authentication and
idempotency are still later priorities. This fixture catalog is synthetic and does
not establish Muna's final mapping contract.
