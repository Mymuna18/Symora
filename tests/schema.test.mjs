import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Static migration contract checks only. No SQL is executed and no database
// driver is imported here. PostgreSQL execution awaits separate approval.
const sql = readFileSync(new URL("../db/migrations/001_initial_schema.sql", import.meta.url), "utf8");
const compact = (value) => value.replace(/\s+/g, " ").trim();
const tables = new Map([...sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)]
  .map(([, name, body]) => [name, compact(body)]));

function constraint(table, name) {
  const body = tables.get(table);
  const marker = `CONSTRAINT ${name} CHECK (`;
  const start = body.indexOf(marker);
  assert.notEqual(start, -1, `${table}.${name} must exist`);
  let depth = 1;
  let quoted = false;
  const from = start + marker.length;
  for (let index = from; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'") {
      if (quoted && body[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
    }
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return compact(body.slice(from, index));
  }
  assert.fail(`Unbalanced constraint ${name}`);
}

test("migration defines exactly the five expected tables and primary keys", () => {
  assert.deepEqual([...tables.keys()], ["participants", "reports", "symptoms", "report_symptoms", "review_history"]);
  for (const name of ["participants", "reports", "symptoms", "review_history"]) {
    assert.match(tables.get(name), /id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  }
  assert.match(tables.get("report_symptoms"), /PRIMARY KEY \(report_id, symptom_id\)/);
  assert.match(tables.get("participants"), /participant_code TEXT NOT NULL UNIQUE/);
  assert.match(tables.get("symptoms"), /code TEXT NOT NULL UNIQUE/);
});

test("all four foreign keys enforce the intended ownership and deletion rules", () => {
  const actual = [];
  for (const [table, body] of tables) {
    for (const [, column, target, key, deletion] of body.matchAll(/(\w+) UUID NOT NULL REFERENCES (\w+)\((\w+)\) ON DELETE (RESTRICT|CASCADE)/g)) {
      assert.ok(tables.has(target), `Referenced table ${target} exists`);
      actual.push([table, column, target, key, deletion]);
    }
  }
  assert.deepEqual(actual, [
    ["reports", "participant_id", "participants", "id", "RESTRICT"],
    ["report_symptoms", "report_id", "reports", "id", "CASCADE"],
    ["report_symptoms", "symptom_id", "symptoms", "id", "RESTRICT"],
    ["review_history", "report_id", "reports", "id", "RESTRICT"],
  ]);
  assert.equal([...sql.matchAll(/REFERENCES /g)].length, actual.length);
});

test("drafts explicitly omit submission time; every non-draft requires a transcript and timestamp", () => {
  const reports = tables.get("reports");
  assert.match(reports, /original_transcript TEXT,/);
  assert.match(reports, /submitted_at TIMESTAMPTZ DEFAULT NOW\(\)/);
  assert.match(reports, /workflow_status TEXT NOT NULL DEFAULT 'submitted' CHECK \( workflow_status IN \( 'draft', 'submitted', 'reviewed', 'follow_up_requested', 'closed' \) \)/);
  // Explicit IS NOT NULL checks are necessary: SQL CHECK accepts UNKNOWN.
  // The POSIX space class rejects spaces, tabs and newlines, unlike trim alone.
  assert.equal(constraint("reports", "reports_submission_complete"), compact(`
    (workflow_status = 'draft' AND submitted_at IS NULL)
    OR (workflow_status <> 'draft' AND submitted_at IS NOT NULL
      AND original_transcript IS NOT NULL AND original_transcript ~ '[^[:space:]]')
  `));
});

test("audit status changes require distinct statuses; notes preserve status and require text", () => {
  assert.equal(constraint("review_history", "review_history_action_consistent"), compact(`
    previous_workflow_status IS NOT NULL AND new_workflow_status IS NOT NULL
    AND (
      (action = 'status_changed' AND previous_workflow_status <> new_workflow_status)
      OR (action = 'note_added' AND previous_workflow_status = new_workflow_status AND review_note IS NOT NULL)
    )
  `));
  const history = tables.get("review_history");
  assert.match(history, /action TEXT NOT NULL CHECK \(action IN \('status_changed', 'note_added'\)\)/);
  for (const column of ["previous_workflow_status", "new_workflow_status"]) {
    assert.ok(history.includes(`${column} IN ( 'submitted', 'reviewed', 'follow_up_requested', 'closed' )`));
  }
});

test("audit records require a nonblank reviewer and reject blank supplied notes", () => {
  assert.match(tables.get("review_history"), /reviewer_user_id TEXT NOT NULL/);
  assert.equal(constraint("review_history", "review_history_reviewer_present"), "reviewer_user_id ~ '[^[:space:]]'");
  assert.equal(constraint("review_history", "review_history_note_nonblank"), "review_note IS NULL OR review_note ~ '[^[:space:]]'");
});

test("intensity stays nullable, participant-reported, range-limited, and without a default", () => {
  assert.match(tables.get("report_symptoms"), /reported_intensity SMALLINT CHECK \(reported_intensity IS NULL OR reported_intensity BETWEEN 0 AND 10\),/);
  assert.match(sql, /COMMENT ON COLUMN report_symptoms.reported_intensity IS\s+'Participant-reported value only; never inferred or assigned by an automated system\.'/);
  for (const body of tables.values()) assert.doesNotMatch(body, /\b(?:ai_severity|inferred_severity|clinical_severity)\b/);
});

test("participant history, coordinator queue, symptom, and audit lookup indexes are retained", () => {
  const indexes = [...sql.matchAll(/CREATE INDEX \w+\s+ON (\w+) \(([^;]+)\);/g)]
    .map(([, table, columns]) => [table, compact(columns)]);
  assert.deepEqual(indexes, [
    ["reports", "participant_id, submitted_at DESC"],
    ["reports", "workflow_status, submitted_at DESC"],
    ["reports", "submitted_at DESC"],
    ["report_symptoms", "symptom_id, report_id"],
    ["review_history", "report_id, created_at DESC"],
  ]);
});
