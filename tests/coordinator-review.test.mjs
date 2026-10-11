import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoordinatorStatusHandler, updateCoordinatorReportStatus } from "../lib/coordinator-review.mjs";
import { ReportError } from "../lib/report-errors.mjs";

const reportId = "22222222-2222-4222-8222-222222222222";
const coordinatorId = "fictional-coordinator-7";
const createdAt = new Date("2026-10-11T09:00:00.000Z");

function request(body, options = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.csrf === false ? {} : { origin: "http://localhost:3000", "x-symora-csrf": "1" }),
  });
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`http://localhost/api/coordinator/reports/${reportId}/status`, {
    method: "PATCH", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function database(initialStatus = "submitted", { failAudit = false } = {}) {
  const state = { status: initialStatus, reviews: [], statements: [] };
  let queue = Promise.resolve();
  const getPool = () => ({
    async connect() {
      let unlock;
      let priorStatus;
      let priorReviewCount;
      let locked = false;
      return {
        async query(sql, values = []) {
          state.statements.push({ sql, values });
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("FOR UPDATE")) {
            const previous = queue;
            queue = new Promise((resolve) => { unlock = resolve; });
            await previous;
            locked = true;
            priorStatus = state.status;
            priorReviewCount = state.reviews.length;
            return { rows: [{ workflow_status: state.status }] };
          }
          if (sql.startsWith("UPDATE public.reports")) {
            state.status = values[1];
            return { rows: [{ id: values[0], workflow_status: state.status }] };
          }
          if (sql.startsWith("INSERT INTO public.review_history")) {
            if (failAudit) throw new Error("private PostgreSQL diagnostic");
            const review = {
              report_id: values[0],
              reviewer_user_id: values[1],
              previous_workflow_status: values[2],
              new_workflow_status: values[3],
              review_note: values[4],
              created_at: createdAt,
            };
            state.reviews.push(review);
            return { rows: [review] };
          }
          if (sql === "COMMIT") {
            if (locked) { locked = false; unlock(); }
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            state.status = priorStatus;
            state.reviews.length = priorReviewCount;
            if (locked) { locked = false; unlock(); }
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  });
  return { getPool, state };
}

function handlerFor(db, authenticate = async () => coordinatorId) {
  return createCoordinatorStatusHandler({
    authenticate,
    update: (id, reviewerId, input) => updateCoordinatorReportStatus(db.getPool, id, reviewerId, input),
  });
}

test("status handler records reviewed status and authenticated coordinator identity", async () => {
  const db = database();
  const response = await handlerFor(db)(request({ workflowStatus: "reviewed" }), reportId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    report: { id: reportId, workflowStatus: "reviewed" },
    review: {
      previousWorkflowStatus: "submitted",
      newWorkflowStatus: "reviewed",
      reviewerUserId: coordinatorId,
      reviewNote: null,
      createdAt: createdAt.toISOString(),
    },
  });
  assert.equal(db.state.reviews[0].reviewer_user_id, coordinatorId);
});

test("follow-up requires and persists the coordinator's note", async () => {
  const db = database();
  const response = await handlerFor(db)(request({
    workflowStatus: "follow_up_requested",
    reviewNote: " Please clarify when the fictional headache began. ",
  }), reportId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).review.reviewNote, "Please clarify when the fictional headache began.");
  assert.equal(db.state.status, "follow_up_requested");
  assert.equal(db.state.reviews[0].reviewer_user_id, coordinatorId);
});

test("a reviewed report can be escalated to a new follow-up request", async () => {
  const db = database("reviewed");
  const result = await updateCoordinatorReportStatus(db.getPool, reportId, coordinatorId,
    { workflowStatus: "follow_up_requested", reviewNote: "Please clarify the fictional symptom." });
  assert.equal(result.review.previousWorkflowStatus, "reviewed");
  assert.equal(result.report.workflowStatus, "follow_up_requested");
});

test("request body cannot choose a reviewer or role", async () => {
  const db = database();
  const response = await handlerFor(db)(request({
    workflowStatus: "reviewed", coordinatorId: "forged", role: "participant",
  }), reportId);
  assert.equal(response.status, 400);
  assert.equal(db.state.statements.length, 0);
});

test("unauthenticated requests stop before database access", async () => {
  const db = database();
  const response = await handlerFor(db, async () => {
    throw new ReportError(401, "UNAUTHORIZED", "A valid coordinator credential is required.");
  })(request({ workflowStatus: "reviewed" }), reportId);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  assert.equal(db.state.statements.length, 0);
});

test("rejects invalid UUIDs, malformed JSON, unsupported statuses, and invalid notes", async () => {
  const db = database();
  const handler = handlerFor(db);
  const cases = [
    [request({ workflowStatus: "reviewed" }), "not-a-uuid", "INVALID_REPORT_ID"],
    [request("{"), reportId, "INVALID_REVIEW_REQUEST"],
    [request({ workflowStatus: "closed" }), reportId, "INVALID_REVIEW_REQUEST"],
    [request({ workflowStatus: "reviewed", reviewNote: "not allowed" }), reportId, "INVALID_REVIEW_REQUEST"],
    [request({ workflowStatus: "follow_up_requested" }), reportId, "INVALID_REVIEW_NOTE"],
    [request({ workflowStatus: "follow_up_requested", reviewNote: "  " }), reportId, "INVALID_REVIEW_NOTE"],
    [request({ workflowStatus: "follow_up_requested", reviewNote: "x".repeat(1001) }), reportId, "INVALID_REVIEW_NOTE"],
  ];
  for (const [req, id, code] of cases) {
    const response = await handler(req, id);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, code);
  }
  assert.equal(db.state.statements.length, 0);
});

test("missing reports, duplicate transitions, drafts, and closed reports are rejected", async () => {
  const missing = database();
  missing.getPool = () => ({ connect: async () => ({
    query: async (sql) => sql.includes("FOR UPDATE") ? { rows: [] } : { rows: [] },
    release() {},
  }) });
  const missingResponse = await createCoordinatorStatusHandler({
    authenticate: async () => coordinatorId,
    update: (id, reviewerId, input) => updateCoordinatorReportStatus(missing.getPool, id, reviewerId, input),
  })(request({ workflowStatus: "reviewed" }), reportId);
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, "REPORT_NOT_FOUND");

  for (const [status, target, expected] of [
    ["reviewed", "reviewed", "DUPLICATE_STATUS"],
    ["draft", "reviewed", "INVALID_STATUS_TRANSITION"],
    ["closed", "reviewed", "INVALID_STATUS_TRANSITION"],
    ["follow_up_requested", "reviewed", "INVALID_STATUS_TRANSITION"],
  ]) {
    const db = database(status);
    await assert.rejects(updateCoordinatorReportStatus(db.getPool, reportId, coordinatorId,
      { workflowStatus: target, reviewNote: null }), { code: expected });
    assert.equal(db.state.reviews.length, 0);
  }
});

test("history insertion failure rolls back the status change and hides database details", async () => {
  const db = database("submitted", { failAudit: true });
  const response = await handlerFor(db)(request({ workflowStatus: "reviewed" }), reportId);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: {
    code: "REVIEW_STORAGE_UNAVAILABLE",
    message: "The review update could not be confirmed. Please reload the report.",
  } });
  assert.equal(db.state.status, "submitted");
  assert.equal(db.state.reviews.length, 0);
  assert.ok(db.state.statements.some(({ sql }) => sql === "ROLLBACK"));
});

test("row locking serializes concurrent conflicting changes and prevents a lost update", async () => {
  const db = database();
  const results = await Promise.allSettled([
    updateCoordinatorReportStatus(db.getPool, reportId, coordinatorId,
      { workflowStatus: "reviewed", reviewNote: null }),
    updateCoordinatorReportStatus(db.getPool, reportId, "another-coordinator",
      { workflowStatus: "reviewed", reviewNote: null }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.equal(rejection.reason.code, "DUPLICATE_STATUS");
  assert.equal(db.state.reviews.length, 1);
  assert.equal(db.state.status, "reviewed");
});
