// Exact contract for the reviewed 001 migration. No connections or file reads.
export const MIGRATION_SHA256 = "1f5fd5e7e9aa1e4e0d1925f4a6e62c9b2fc59fa9b169c4f1fe0f4873f553495b";
export const DATABASE = "tsdb";
export const SCHEMA = "public";
// [name, PostgreSQL format_type, not-null, default expression]
export const columns = {
  participants: [
    ["id", "uuid", true, "gen_random_uuid()"], ["participant_code", "text", true, null],
    ["trial_id", "text", true, null], ["preferred_language", "character varying(35)", true, "'en'"],
    ["timezone", "character varying(64)", true, "'UTC'"], ["status", "text", true, "'active'"],
    ["created_at", "timestamp with time zone", true, "now()"],
  ],
  reports: [
    ["id", "uuid", true, "gen_random_uuid()"], ["participant_id", "uuid", true, null],
    ["source", "text", true, "'portal'"], ["original_language", "character varying(35)", true, null],
    ["original_transcript", "text", false, null], ["english_summary", "text", false, null],
    ["submitted_at", "timestamp with time zone", false, "now()"], ["workflow_status", "text", true, "'submitted'"],
  ],
  symptoms: [
    ["id", "uuid", true, "gen_random_uuid()"], ["code", "text", true, null],
    ["display_name", "text", true, null], ["is_active", "boolean", true, "true"],
    ["created_at", "timestamp with time zone", true, "now()"],
  ],
  report_symptoms: [
    ["report_id", "uuid", true, null], ["symptom_id", "uuid", true, null],
    ["reported_intensity", "smallint", false, null], ["onset_date", "date", false, null],
    ["ongoing", "boolean", false, null], ["participant_description", "text", false, null],
  ],
  review_history: [
    ["id", "uuid", true, "gen_random_uuid()"], ["report_id", "uuid", true, null],
    ["reviewer_user_id", "text", true, null], ["action", "text", true, null],
    ["previous_workflow_status", "text", false, null], ["new_workflow_status", "text", false, null],
    ["review_note", "text", false, null], ["created_at", "timestamp with time zone", true, "now()"],
  ],
};
export const TABLES = Object.keys(columns);
const statuses = "('submitted', 'reviewed', 'follow_up_requested', 'closed')";
export const checks = {
  participants: { participants_status_check: "status IN ('active', 'withdrawn')" },
  reports: {
    reports_source_check: "source IN ('portal', 'voice')",
    reports_workflow_status_check: "workflow_status IN ('draft','submitted','reviewed','follow_up_requested','closed')",
    reports_submission_complete: "(workflow_status = 'draft' AND submitted_at IS NULL) OR (workflow_status <> 'draft' AND submitted_at IS NOT NULL AND original_transcript IS NOT NULL AND original_transcript ~ '[^[:space:]]')",
  },
  report_symptoms: { report_symptoms_reported_intensity_check: "reported_intensity IS NULL OR reported_intensity BETWEEN 0 AND 10" },
  review_history: {
    review_history_action_check: "action IN ('status_changed', 'note_added')",
    review_history_previous_workflow_status_check: `previous_workflow_status IS NULL OR previous_workflow_status IN ${statuses}`,
    review_history_new_workflow_status_check: `new_workflow_status IS NULL OR new_workflow_status IN ${statuses}`,
    review_history_reviewer_present: "reviewer_user_id ~ '[^[:space:]]'",
    review_history_note_nonblank: "review_note IS NULL OR review_note ~ '[^[:space:]]'",
    review_history_action_consistent: "previous_workflow_status IS NOT NULL AND new_workflow_status IS NOT NULL AND ((action = 'status_changed' AND previous_workflow_status <> new_workflow_status) OR (action = 'note_added' AND previous_workflow_status = new_workflow_status AND review_note IS NOT NULL))",
  },
};
export const keys = [
  ...TABLES.map((table) => ({ table, name: `${table}_pkey`, kind: "p", columns: table === "report_symptoms" ? ["report_id", "symptom_id"] : ["id"] })),
  { table: "participants", name: "participants_participant_code_key", kind: "u", columns: ["participant_code"] },
  { table: "symptoms", name: "symptoms_code_key", kind: "u", columns: ["code"] },
];
export const foreignKeys = [
  ["reports", "participant_id", "participants", "r"],
  ["report_symptoms", "report_id", "reports", "c"],
  ["report_symptoms", "symptom_id", "symptoms", "r"],
  ["review_history", "report_id", "reports", "r"],
].map(([table, column, target, deletion]) => ({ table, name: `${table}_${column}_fkey`, kind: "f", columns: [column], target, deletion }));
export const indexes = [
  ...keys.map((key) => ({ ...key, unique: true, descending: key.columns.map(() => false) })),
  { table: "reports", name: "reports_participant_submitted_idx", columns: ["participant_id", "submitted_at"], descending: [false, true], unique: false },
  { table: "reports", name: "reports_review_queue_idx", columns: ["workflow_status", "submitted_at"], descending: [false, true], unique: false },
  { table: "reports", name: "reports_submitted_at_idx", columns: ["submitted_at"], descending: [true], unique: false },
  { table: "report_symptoms", name: "report_symptoms_symptom_report_idx", columns: ["symptom_id", "report_id"], descending: [false, false], unique: false },
  { table: "review_history", name: "review_history_report_created_idx", columns: ["report_id", "created_at"], descending: [false, true], unique: false },
];
export const OBJECT_NAMES = [...TABLES, ...indexes.map(({ name }) => name)];
export const TYPE_NAMES = [...TABLES, ...TABLES.map((name) => `_${name}`)];

// Parse only the CHECK grammar used in the reviewed migration. This compares
// logical structure (including grouping), not loose substrings. PostgreSQL's
// IN -> ANY(ARRAY[]) and BETWEEN -> >= AND <= deparsing is normalized.
export function checkTree(expression) {
  const tokens = [];
  const pattern = /\s+|'(?:[^']|'')*'|::|>=|<=|<>|[(),[\]~=<>]|\d+|[a-z_][a-z_0-9]*/giy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) throw new Error("Unexpected CHECK syntax.");
    offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0][0] === "'" ? match[0] : match[0].toLowerCase());
  }
  let position = 0;
  const peek = () => tokens[position];
  const take = (value) => { if (tokens[position++] !== value) throw new Error("Unexpected CHECK syntax."); };
  const joined = (op, nodes) => nodes.length === 1 ? nodes[0] : [op, ...nodes.flatMap((node) => node[0] === op ? node.slice(1) : [node])];
  function primary() {
    let node;
    const token = peek();
    if (token === "(") { take("("); node = or(); take(")"); }
    else if (token?.startsWith("'")) { position++; node = ["string", token.slice(1, -1).replaceAll("''", "'")]; }
    else if (/^\d+$/.test(token ?? "")) { position++; node = ["number", Number(token)]; }
    else if (/^[a-z_][a-z_0-9]*$/.test(token ?? "")) { position++; node = ["column", token]; }
    else throw new Error("Unexpected CHECK syntax.");
    if (peek() === "::") { take("::"); take("text"); }
    return node;
  }
  function predicate() {
    const left = primary();
    if (peek() === "is") {
      take("is"); const not = peek() === "not"; if (not) take("not"); take("null");
      return [not ? "not-null" : "null", left];
    }
    if (peek() === "between") {
      take("between"); const low = primary(); take("and"); const high = primary();
      return ["and", [">=", left, low], ["<=", left, high]];
    }
    if (peek() === "in") {
      take("in"); take("("); const values = [primary()];
      while (peek() === ",") { take(","); values.push(primary()); } take(")");
      return ["in", left, values];
    }
    if (["=", "<>", ">=", "<=", "~", ">", "<"].includes(peek())) {
      const op = tokens[position++];
      if (peek() === "any") {
        if (op !== "=") throw new Error("Unexpected CHECK syntax.");
        take("any"); take("("); take("array"); take("["); const values = [primary()];
        while (peek() === ",") { take(","); values.push(primary()); } take("]"); take(")");
        return ["in", left, values];
      }
      return [op, left, primary()];
    }
    return left;
  }
  function and() { const nodes = [predicate()]; while (peek() === "and") { take("and"); nodes.push(predicate()); } return joined("and", nodes); }
  function or() { const nodes = [and()]; while (peek() === "or") { take("or"); nodes.push(and()); } return joined("or", nodes); }
  const result = or();
  if (position !== tokens.length) throw new Error("Unexpected CHECK syntax.");
  return result;
}

const equal = (actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Schema contract mismatch."); };
const normalizeDefault = (value) => value === null ? null : value.replace(/::(?:text|character varying)\b/g, "").replaceAll("pg_catalog.", "").trim();

export function verifySchema(snapshot) {
  equal(snapshot.tables.map((row) => row.name).sort(), [...TABLES].sort());
  for (const row of snapshot.tables) {
    if (row.schema !== SCHEMA || row.kind !== "r" || row.persistence !== "p" || !row.owned || row.row_security) throw new Error("Unexpected table.");
  }
  equal(snapshot.columns.length, Object.values(columns).flat().length);
  for (const [table, expected] of Object.entries(columns)) {
    equal(snapshot.columns.filter((row) => row.table === table).map((row) => [row.name, row.type, row.not_null, normalizeDefault(row.default_expression)]), expected);
  }
  const expectedChecks = Object.entries(checks).flatMap(([table, definitions]) => Object.entries(definitions).map(([name, expression]) => ({ table, name, kind: "c", expression })));
  const expectedConstraints = [...keys, ...foreignKeys, ...expectedChecks];
  // PG18 additionally catalogs NOT NULL; PG17 enforces it via attnotnull.
  const constraints = snapshot.constraints.filter((row) => row.kind !== "n");
  equal(constraints.length, expectedConstraints.length);
  for (const row of snapshot.constraints) {
    if (!row.validated || !row.enforced || row.deferrable || row.deferred) throw new Error("Inactive constraint.");
    if (row.kind === "n") {
      if (row.columns.length !== 1 || !columns[row.table]?.some(([name, , required]) => required && name === row.columns[0])) throw new Error("Unexpected NOT NULL constraint.");
    }
  }
  for (const expected of expectedConstraints) {
    const found = constraints.filter((row) => row.table === expected.table && row.name === expected.name);
    equal(found.length, 1); const row = found[0]; equal(row.kind, expected.kind);
    if (expected.kind === "c") equal(checkTree(row.expression), checkTree(expected.expression));
    else equal(row.columns, expected.columns);
    if (expected.kind === "f") {
      equal([row.target_schema, row.target, row.target_columns, row.deletion, row.update, row.match], [SCHEMA, expected.target, ["id"], expected.deletion, "a", "s"]);
    }
  }
  equal(snapshot.indexes.length, indexes.length);
  for (const expected of indexes) {
    const found = snapshot.indexes.filter((row) => row.name === expected.name && row.table === expected.table);
    equal(found.length, 1); const row = found[0];
    equal([row.schema, row.columns, row.descending, row.nulls_first, row.unique, row.method], [SCHEMA, expected.columns, expected.descending, expected.descending, expected.unique, "btree"]);
    if (!row.valid || !row.ready || row.partial || row.expression || row.included) throw new Error("Unexpected index.");
  }
}
