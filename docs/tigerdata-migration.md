# TigerData migration 001 — Elvin-owned tooling

The runner is implemented, but execution against TigerData is not yet approved.
No seed data, GRANT, REVOKE, or migration-tracking table is included. Muna's
`muna_dev` integration uses backend APIs; this runner does not grant her access.

From `/Users/elvinle/Desktop/symora/Symora`, run preflight manually:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --preflight
```

No flag also means preflight. Node loads the environment for your local process;
the script contains no environment-file reader. Enter the expected development
hostname from the TigerData console and the reviewed database name `tsdb`.
Never enter a connection string or password at either prompt. Do not share prompt
answers; share only the sanitized JSON result.

Execution command **only after separate migration approval**:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --execute --approve-migration=001
```

This additionally requires typing `APPLY SYMORA 001 TO tsdb.public` before a
connection is opened. Unknown arguments, one execution flag alone, or an
incorrect confirmation fail closed. The flags and confirmation cannot themselves
establish whether the team has approved the operation; the operator must obtain
that approval separately.

The runner uses the existing `createDatabase` infrastructure with a private,
single-connection pool. Explicit connection options avoid inherited PostgreSQL
overrides. Certificate and hostname verification is mandatory. It verifies the
configured host/database before connecting and verifies the server's actual
database identity, schema, and TLS state inside the transaction before any DDL.

Reviewed migration SHA-256:

```text
1f5fd5e7e9aa1e4e0d1925f4a6e62c9b2fc59fa9b169c4f1fe0f4873f553495b
```

The exact hashed bytes of `db/migrations/001_initial_schema.sql` are held in memory
and executed once. A changed file cannot be accepted by supplying another checksum
or path. The target schema is fixed to `public` and the reviewed target major
version is PostgreSQL 18. Other major versions require review.

Preflight uses `BEGIN ... READ ONLY` and `ROLLBACK`. It checks identity, schema
permissions, UUID-function access, PostgreSQL version, all proposed relation/type
names, and default privileges. If table default privileges would give access to
roles other than the creator (including PUBLIC), it stops for review rather than
changing those permissions. Preflight does not execute or trial-run the DDL.

Execution explicitly opens one READ WRITE transaction; the session otherwise
defaults to read-only. A transaction-scoped advisory lock prevents concurrent runs
of this same runner. It cannot prevent unrelated migration tools; coordinate a
quiet migration window with the team. Conflict checks occur immediately before
the DDL, and PostgreSQL rejects concurrent name collisions rather than replacing
objects. Lock timeout is 5 seconds, statement timeout 30 seconds, query timeout
35 seconds, and idle transaction timeout 60 seconds. Connection timeout is 10 seconds.

Before COMMIT, metadata verification checks all five tables, exact columns,
types/defaults/nullability, five primary keys, two unique constraints, four foreign
keys and their actions, eleven CHECK constraints and their logical expressions,
and twelve indexes (seven constraint indexes plus five explicit indexes).
No participant or report rows are inspected or written.

PostgreSQL 18 catalogs NOT NULL constraints and exposes `conenforced`; verification
handles those in addition to column nullability. PostgreSQL 17-style constraint
snapshots are tested too, but are not accepted as the shared target's major version.
References: [PostgreSQL 18 pg_constraint](https://www.postgresql.org/docs/18/catalog-pg-constraint.html)
and [PostgreSQL 17 pg_constraint](https://www.postgresql.org/docs/17/catalog-pg-constraint.html).
The runner has only been tested with mocks; it has not executed DDL on PostgreSQL 18.

Errors before COMMIT trigger ROLLBACK and connection cleanup. Failed rollback
causes the connection to be discarded. If COMMIT loses its response, the outcome
is unknown: rollback cannot prove that a commit did not already happen. The runner
never retries automatically. Inspect read-only before deciding the next action.
A confirmed commit followed by cleanup failure is reported as committed, not
rolled back. Normal success is `MIGRATION_001_COMMITTED`; preflight success is
`PREFLIGHT_PASSED_NO_CHANGES`. Driver errors and credentials are never logged.

## Migration 003 — participant follow-up responses and reminders

Migration 003 is additive and leaves 001 and 002 unchanged. It adds
`participant_follow_up_responses` for a participant's self-reported response and
`participant_follow_up_reminders` for a single in-app reminder per report and UTC
calendar date. It does not schedule appointments or send background notifications.
The migration runner verifies the complete existing 001 and 002 contracts before
checking or applying 003, then verifies the new tables, constraints, and indexes
before commit.

The runner supports a read-only preflight:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --migration=003 --preflight
```

Execution is **not approved by this code change** and must not be run without
separate explicit database-migration approval. If approved later, the runner
requires both flags below and an interactive confirmation of
`APPLY SYMORA 003 TO tsdb.public`:

```sh
node --env-file=.env.local scripts/migrate-tigerdata.mjs --migration=003 --execute --approve-migration=003
```

Reviewed migration SHA-256:
`da3893a28c406eda97a5abf6a960ab8b30cf4f6b4b7583f7c60a7bdb44b421a0`.
