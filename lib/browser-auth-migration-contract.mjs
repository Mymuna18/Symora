import { checkTree } from "./migration-contract.mjs";

export const BROWSER_AUTH_TABLES = ["browser_auth_sessions", "rate_limit_buckets"];
export const BROWSER_AUTH_OBJECT_NAMES = [
  ...BROWSER_AUTH_TABLES,
  "browser_auth_sessions_expires_idx",
  "rate_limit_buckets_expires_idx",
  "browser_auth_sessions_pkey",
  "rate_limit_buckets_pkey",
];
export const BROWSER_AUTH_TYPE_NAMES = [...BROWSER_AUTH_TABLES, ...BROWSER_AUTH_TABLES.map((name) => `_${name}`)];

export const browserAuthColumns = {
  browser_auth_sessions: [
    ["session_id_hash", "text", true, null],
    ["account_key_hash", "text", true, null],
    ["role", "text", true, null],
    ["config_fingerprint", "text", true, null],
    ["created_at", "timestamp with time zone", true, "now()"],
    ["expires_at", "timestamp with time zone", true, null],
  ],
  rate_limit_buckets: [
    ["scope", "text", true, null],
    ["bucket_hash", "text", true, null],
    ["window_started_at", "timestamp with time zone", true, null],
    ["attempts", "integer", true, null],
    ["expires_at", "timestamp with time zone", true, null],
  ],
};

export const browserAuthChecks = [
  ["browser_auth_sessions", "browser_auth_sessions_session_hash_check", "session_id_hash ~ '^[0-9a-f]{64}$'"],
  ["browser_auth_sessions", "browser_auth_sessions_account_hash_check", "account_key_hash ~ '^[0-9a-f]{64}$'"],
  ["browser_auth_sessions", "browser_auth_sessions_role_check", "role IN ('participant', 'coordinator')"],
  ["browser_auth_sessions", "browser_auth_sessions_fingerprint_check", "config_fingerprint ~ '^[0-9a-f]{64}$'"],
  ["browser_auth_sessions", "browser_auth_sessions_expiry_check", "expires_at > created_at"],
  ["rate_limit_buckets", "rate_limit_buckets_scope_check", "scope IN ('login_global', 'login_account', 'login_unknown', 'analysis_global')"],
  ["rate_limit_buckets", "rate_limit_buckets_hash_check", "bucket_hash ~ '^[0-9a-f]{64}$'"],
  ["rate_limit_buckets", "rate_limit_buckets_attempts_positive_check", "attempts > 0"],
  ["rate_limit_buckets", "rate_limit_buckets_expiry_check", "expires_at > window_started_at"],
  ["rate_limit_buckets", "rate_limit_buckets_attempts_bound_check",
    "(scope = 'login_global' AND attempts <= 31) OR (scope IN ('login_account', 'login_unknown') AND attempts <= 6) OR (scope = 'analysis_global' AND attempts <= 121)"],
];

export const browserAuthKeys = [
  { table: "browser_auth_sessions", name: "browser_auth_sessions_pkey", columns: ["session_id_hash"] },
  { table: "rate_limit_buckets", name: "rate_limit_buckets_pkey", columns: ["scope", "bucket_hash"] },
];
export const browserAuthIndexes = [
  ...browserAuthKeys.map((key) => ({ ...key, unique: true, descending: key.columns.map(() => false) })),
  { table: "browser_auth_sessions", name: "browser_auth_sessions_expires_idx", columns: ["expires_at"], unique: false, descending: [false] },
  { table: "rate_limit_buckets", name: "rate_limit_buckets_expires_idx", columns: ["expires_at"], unique: false, descending: [false] },
];

const equal = (actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Browser-auth schema contract mismatch.");
};
const normalizeDefault = (value) => value === null ? null
  : value.replace(/::(?:text|character varying)\b/g, "").replaceAll("pg_catalog.", "").trim();

export function verifyBrowserAuthSchema(snapshot) {
  equal(snapshot.tables.map((row) => row.name).sort(), [...BROWSER_AUTH_TABLES].sort());
  for (const row of snapshot.tables) {
    if (row.schema !== "public" || row.kind !== "r" || row.persistence !== "p" || !row.owned || row.row_security) {
      throw new Error("Unexpected browser-auth table.");
    }
  }
  equal(snapshot.columns.length, Object.values(browserAuthColumns).flat().length);
  for (const [table, expected] of Object.entries(browserAuthColumns)) {
    equal(snapshot.columns.filter((row) => row.table === table)
      .map((row) => [row.name, row.type, row.not_null, normalizeDefault(row.default_expression)]), expected);
  }

  const expectedConstraints = [
    ...browserAuthKeys.map((key) => ({ ...key, kind: "p" })),
    ...browserAuthChecks.map(([table, name, expression]) => ({ table, name, kind: "c", expression })),
  ];
  const constraints = snapshot.constraints.filter((row) => row.kind !== "n");
  equal(constraints.length, expectedConstraints.length);
  for (const row of snapshot.constraints) {
    if (!row.validated || !row.enforced || row.deferrable || row.deferred) throw new Error("Inactive browser-auth constraint.");
  }
  for (const expected of expectedConstraints) {
    const found = constraints.filter((row) => row.table === expected.table && row.name === expected.name);
    equal(found.length, 1);
    const row = found[0];
    equal(row.kind, expected.kind);
    if (expected.kind === "c") equal(checkTree(row.expression), checkTree(expected.expression));
    else equal(row.columns, expected.columns);
  }

  equal(snapshot.indexes.length, browserAuthIndexes.length);
  for (const expected of browserAuthIndexes) {
    const found = snapshot.indexes.filter((row) => row.name === expected.name && row.table === expected.table);
    equal(found.length, 1);
    const row = found[0];
    equal([row.schema, row.columns, row.descending, row.nulls_first, row.unique, row.method],
      ["public", expected.columns, expected.descending, expected.descending, expected.unique, "btree"]);
    if (!row.valid || !row.ready || row.partial || row.expression || row.included) throw new Error("Unexpected browser-auth index.");
  }
}
