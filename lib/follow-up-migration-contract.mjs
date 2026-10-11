import { checkTree } from "./migration-contract.mjs";

export const FOLLOW_UP_TABLES = ["participant_follow_up_responses", "participant_follow_up_reminders"];
export const FOLLOW_UP_OBJECT_NAMES = [
  ...FOLLOW_UP_TABLES,
  "participant_follow_up_responses_participant_idx",
  "participant_follow_up_responses_pkey",
  "participant_follow_up_reminders_pkey",
];
export const FOLLOW_UP_TYPE_NAMES = [...FOLLOW_UP_TABLES, ...FOLLOW_UP_TABLES.map((name) => `_${name}`)];

export const followUpColumns = {
  participant_follow_up_responses: [
    ["report_id", "uuid", true, null],
    ["participant_id", "uuid", true, null],
    ["response", "text", true, null],
    ["responded_at", "timestamp with time zone", true, "now()"],
  ],
  participant_follow_up_reminders: [
    ["report_id", "uuid", true, null],
    ["reminder_date", "date", true, null],
    ["created_at", "timestamp with time zone", true, "now()"],
  ],
};

export const followUpKeys = [
  { table: "participant_follow_up_responses", name: "participant_follow_up_responses_pkey",
    kind: "p", columns: ["report_id"] },
  { table: "participant_follow_up_reminders", name: "participant_follow_up_reminders_pkey",
    kind: "p", columns: ["report_id", "reminder_date"] },
];
export const followUpForeignKeys = [
  { table: "participant_follow_up_responses", name: "participant_follow_up_responses_report_id_fkey",
    kind: "f", columns: ["report_id"], target: "reports" },
  { table: "participant_follow_up_responses", name: "participant_follow_up_responses_participant_id_fkey",
    kind: "f", columns: ["participant_id"], target: "participants" },
  { table: "participant_follow_up_reminders", name: "participant_follow_up_reminders_report_id_fkey",
    kind: "f", columns: ["report_id"], target: "reports" },
];
export const followUpChecks = [{
  table: "participant_follow_up_responses",
  name: "participant_follow_up_responses_response_check",
  kind: "c",
  expression: "response IN ('appointment_scheduled', 'will_schedule_later')",
}];
export const followUpIndexes = [
  { table: "participant_follow_up_responses", name: "participant_follow_up_responses_pkey",
    columns: ["report_id"], descending: [false], unique: true },
  { table: "participant_follow_up_responses", name: "participant_follow_up_responses_participant_idx",
    columns: ["participant_id", "response"], descending: [false, false], unique: false },
  { table: "participant_follow_up_reminders", name: "participant_follow_up_reminders_pkey",
    columns: ["report_id", "reminder_date"], descending: [false, false], unique: true },
];

const equal = (actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Participant follow-up schema contract mismatch.");
};
const normalizeDefault = (value) => value === null ? null
  : value.replace(/::(?:text|character varying)\b/g, "").replaceAll("pg_catalog.", "").trim();

export function verifyFollowUpSchema(snapshot) {
  equal(snapshot.tables.map((row) => row.name).sort(), [...FOLLOW_UP_TABLES].sort());
  for (const row of snapshot.tables) {
    if (row.schema !== "public" || row.kind !== "r" || row.persistence !== "p" || !row.owned || row.row_security) {
      throw new Error("Unexpected participant follow-up table.");
    }
  }
  equal(snapshot.columns.length, Object.values(followUpColumns).flat().length);
  for (const [table, expected] of Object.entries(followUpColumns)) {
    equal(snapshot.columns.filter((row) => row.table === table)
      .map((row) => [row.name, row.type, row.not_null, normalizeDefault(row.default_expression)]), expected);
  }

  const expectedConstraints = [...followUpKeys, ...followUpForeignKeys, ...followUpChecks];
  const constraints = snapshot.constraints.filter((row) => row.kind !== "n");
  equal(constraints.length, expectedConstraints.length);
  for (const row of snapshot.constraints) {
    if (!row.validated || !row.enforced || row.deferrable || row.deferred) {
      throw new Error("Inactive participant follow-up constraint.");
    }
  }
  for (const expected of expectedConstraints) {
    const found = constraints.filter((row) => row.table === expected.table && row.name === expected.name);
    equal(found.length, 1);
    const row = found[0];
    equal(row.kind, expected.kind);
    if (expected.kind === "c") equal(checkTree(row.expression), checkTree(expected.expression));
    else equal(row.columns, expected.columns);
    if (expected.kind === "f") {
      equal([row.target_schema, row.target, row.target_columns, row.deletion, row.update, row.match],
        ["public", expected.target, ["id"], "r", "a", "s"]);
    }
  }

  equal(snapshot.indexes.length, followUpIndexes.length);
  for (const expected of followUpIndexes) {
    const found = snapshot.indexes.filter((row) => row.name === expected.name && row.table === expected.table);
    equal(found.length, 1);
    const row = found[0];
    equal([row.schema, row.columns, row.descending, row.nulls_first, row.unique, row.method],
      ["public", expected.columns, expected.descending, expected.descending, expected.unique, "btree"]);
    if (!row.valid || !row.ready || row.partial || row.expression || row.included) {
      throw new Error("Unexpected participant follow-up index.");
    }
  }
}
