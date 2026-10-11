import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createParticipantFollowUpResponseHandler,
  createParticipantNotificationsHandler,
  listParticipantNotifications,
  saveParticipantFollowUpResponse,
} from "../lib/participant-notifications.mjs";
import { ReportError } from "../lib/report-errors.mjs";

const participantId = "11111111-1111-4111-8111-111111111111";
const otherParticipantId = "55555555-5555-4555-8555-555555555555";
const reportId = "22222222-2222-4222-8222-222222222222";
const notifications = [
  {
    notificationId: "44444444-4444-4444-8444-444444444444",
    reportId,
    message: "Your symptom report has been reviewed by the study team. Thank you for submitting your report.",
    createdAt: "2026-10-11T09:00:00.000Z",
    notificationType: "reviewed",
    participantResponse: null,
    responseUpdatedAt: null,
  },
  {
    notificationId: "66666666-6666-4666-8666-666666666666",
    reportId,
    message: "Please clarify when your fictional headache began.",
    createdAt: "2026-10-12T09:00:00.000Z",
    notificationType: "follow_up_requested",
    participantResponse: "will_schedule_later",
    responseUpdatedAt: "2026-10-12T10:00:00.000Z",
  },
  {
    notificationId: `reminder:${reportId}:2026-10-13`,
    reportId,
    message: "Reminder: Please schedule your follow-up appointment with the study team.",
    createdAt: "2026-10-13T00:00:00.000Z",
    notificationType: "follow_up_reminder",
    participantResponse: "will_schedule_later",
    responseUpdatedAt: "2026-10-12T10:00:00.000Z",
  },
];

function notificationDb({ rows = notifications, failSelect = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT * FROM (") && failSelect) throw new Error("private database diagnostic");
      if (sql.startsWith("SELECT * FROM (")) return { rows };
      return { rows: [] };
    },
    release() {},
  };
  return { calls, getPool: () => ({ connect: async () => client }) };
}

function responseDb({ owner = participantId, hasFollowUp = true } = {}) {
  const state = { response: null, respondedAt: null, statements: [] };
  const getPool = () => ({
    async connect() {
      return {
        async query(sql, values = []) {
          state.statements.push({ sql, values });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
          if (sql.includes("FROM public.reports")) {
            return { rows: values[1] === owner ? [{ id: reportId }] : [] };
          }
          if (sql.includes("FROM public.review_history")) return { rows: hasFollowUp ? [{ "?column?": 1 }] : [] };
          if (sql.includes("FROM public.participant_follow_up_responses")) {
            return { rows: state.response ? [{ response: state.response, responded_at: state.respondedAt }] : [] };
          }
          if (sql.startsWith("INSERT INTO public.participant_follow_up_responses")) {
            state.response = values[2];
            state.respondedAt = new Date("2026-10-12T10:00:00.000Z");
            return { rows: [{ response: state.response, responded_at: state.respondedAt }] };
          }
          if (sql.startsWith("UPDATE public.participant_follow_up_responses")) {
            state.response = values[2];
            state.respondedAt = new Date("2026-10-13T10:00:00.000Z");
            return { rows: [{ response: state.response, responded_at: state.respondedAt }] };
          }
          throw new Error(`Unexpected SQL ${sql}`);
        },
        release() {},
      };
    },
  });
  return { getPool, state };
}

function postRequest(body, headers = {}) {
  return new Request("http://localhost/api/participant/follow-up-response", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("notifications include reviewed, saved follow-up, and reminder events scoped by participant", async () => {
  const db = notificationDb();
  const result = await listParticipantNotifications(db.getPool, participantId);
  assert.deepEqual(result, { notifications });
  const materialization = db.calls.find(({ sql }) => sql.startsWith("INSERT INTO public.participant_follow_up_reminders"));
  const reminderLock = db.calls.find(({ sql }) => sql.includes("FOR UPDATE OF r"));
  const eventQuery = db.calls.find(({ sql }) => sql.startsWith("SELECT * FROM ("));
  assert.deepEqual(reminderLock.values, [participantId]);
  assert.match(reminderLock.sql, /f\.response = 'will_schedule_later'/);
  assert.deepEqual(eventQuery.values, [participantId, notifications[0].message, notifications[2].message]);
  assert.match(materialization.sql, /ON CONFLICT \(report_id, reminder_date\) DO NOTHING/);
  assert.match(materialization.sql, /NOW\(\) AT TIME ZONE 'UTC'/);
  assert.match(materialization.sql, /f\.participant_id = \$1/);
  assert.match(eventQuery.sql, /r\.participant_id = \$1/);
  assert.match(eventQuery.sql, /new_workflow_status IN \('reviewed', 'follow_up_requested'\)/);
  assert.match(eventQuery.sql, /rm\.reminder_date = \(NOW\(\) AT TIME ZONE 'UTC'\)::date/);
  assert.doesNotMatch(JSON.stringify(result), /reviewer_user_id|coordinator|participantCode|token/i);
});

test("reminders are materialized no earlier than the next UTC calendar day and one per day", async () => {
  const db = notificationDb();
  await listParticipantNotifications(db.getPool, participantId);
  const materialization = db.calls.find(({ sql }) => sql.startsWith("INSERT INTO public.participant_follow_up_reminders")).sql;
  const reminderLock = db.calls.find(({ sql }) => sql.includes("FOR UPDATE OF r")).sql;
  assert.match(materialization, /f\.response = 'will_schedule_later'/);
  assert.match(materialization, /\(NOW\(\) AT TIME ZONE 'UTC'\)::date > \(f\.responded_at AT TIME ZONE 'UTC'\)::date/);
  assert.match(materialization, /ON CONFLICT \(report_id, reminder_date\) DO NOTHING/);
  assert.match(reminderLock, /FOR UPDATE OF r/);
  const eventQuery = db.calls.find(({ sql }) => sql.startsWith("SELECT * FROM ("));
  assert.match(eventQuery.sql, /f\.response = 'will_schedule_later'/);
});

test("notification storage errors roll back and are sanitized", async () => {
  const db = notificationDb({ failSelect: true });
  await assert.rejects(listParticipantNotifications(db.getPool, participantId), { code: "NOTIFICATIONS_UNAVAILABLE" });
  assert.ok(db.calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("participant identity comes from authentication and unauthenticated reads do not query", async () => {
  let queried = false;
  const handler = createParticipantNotificationsHandler({
    authenticate: async () => participantId,
    list: async (id) => {
      assert.equal(id, participantId);
      return { notifications };
    },
  });
  const response = await handler(new Request("http://localhost/api/participant/notifications"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { notifications });

  const unauthorized = createParticipantNotificationsHandler({
    authenticate: async () => { throw new ReportError(401, "UNAUTHORIZED", "Unauthorized."); },
    list: async () => { queried = true; return { notifications: [] }; },
  });
  assert.equal((await unauthorized(new Request("http://localhost/api/participant/notifications"))).status, 401);
  assert.equal(queried, false);
});

test("participant responses require an owned report with a saved follow-up request", async () => {
  const db = responseDb();
  const saved = await saveParticipantFollowUpResponse(db.getPool, participantId, reportId, "will_schedule_later");
  assert.deepEqual(saved, {
    reportId,
    response: "will_schedule_later",
    respondedAt: "2026-10-12T10:00:00.000Z",
  });
  const ownerQuery = db.state.statements.find(({ sql }) => sql.includes("FROM public.reports"));
  assert.match(ownerQuery.sql, /id = \$1 AND participant_id = \$2 FOR UPDATE/);
  assert.deepEqual(ownerQuery.values, [reportId, participantId]);

  const foreign = responseDb({ owner: otherParticipantId });
  await assert.rejects(saveParticipantFollowUpResponse(foreign.getPool, participantId, reportId, "appointment_scheduled"),
    { status: 404, code: "REPORT_NOT_FOUND" });
  assert.equal(foreign.state.statements.some(({ sql }) => sql.includes("FROM public.review_history")), false);

  const noFollowUp = responseDb({ hasFollowUp: false });
  await assert.rejects(saveParticipantFollowUpResponse(noFollowUp.getPool, participantId, reportId, "will_schedule_later"),
    { status: 409, code: "FOLLOW_UP_NOT_FOUND" });
  assert.ok(noFollowUp.state.statements.some(({ sql }) => sql === "ROLLBACK"));
});

test("participant response retries are idempotent and later can become scheduled", async () => {
  const db = responseDb();
  const first = await saveParticipantFollowUpResponse(db.getPool, participantId, reportId, "will_schedule_later");
  const duplicate = await saveParticipantFollowUpResponse(db.getPool, participantId, reportId, "will_schedule_later");
  assert.deepEqual(duplicate, first);
  assert.equal(db.state.statements.filter(({ sql }) => sql.startsWith("INSERT INTO public.participant_follow_up_responses")).length, 1);
  assert.equal(db.state.statements.filter(({ sql }) => sql.startsWith("UPDATE public.participant_follow_up_responses")).length, 0);

  const scheduled = await saveParticipantFollowUpResponse(db.getPool, participantId, reportId, "appointment_scheduled");
  assert.equal(scheduled.response, "appointment_scheduled");
  assert.equal(db.state.statements.filter(({ sql }) => sql.startsWith("UPDATE public.participant_follow_up_responses")).length, 1);
});

test("a scheduled response cannot be reverted to later", async () => {
  const db = responseDb();
  db.state.response = "appointment_scheduled";
  db.state.respondedAt = new Date("2026-10-13T10:00:00.000Z");
  await assert.rejects(saveParticipantFollowUpResponse(db.getPool, participantId, reportId, "will_schedule_later"),
    { status: 409, code: "FOLLOW_UP_ALREADY_COMPLETED" });
  assert.equal(db.state.response, "appointment_scheduled");
});

test("response endpoint validates requests, returns no-store, and never queries before authentication", async () => {
  const db = responseDb();
  let authenticated = false;
  const handler = createParticipantFollowUpResponseHandler({
    authenticate: async (request) => {
      authenticated = true;
      assert.equal(request.headers.get("x-symora-csrf"), "1");
      return participantId;
    },
    save: (id, report, response) => saveParticipantFollowUpResponse(db.getPool, id, report, response),
  });
  const response = await handler(postRequest({ reportId, response: "will_schedule_later" }, {
    origin: "http://localhost", "x-symora-csrf": "1",
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).response, "will_schedule_later");
  assert.equal(authenticated, true);

  for (const body of [
    "{",
    { reportId: "invalid", response: "will_schedule_later" },
    { reportId, response: "book_appointment" },
    { reportId, response: "appointment_scheduled", participantId },
  ]) {
    const invalid = await handler(postRequest(body, { "x-symora-csrf": "1" }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_RESPONSE");
  }

  let queried = false;
  const unauthorized = createParticipantFollowUpResponseHandler({
    authenticate: async () => { throw new ReportError(401, "UNAUTHORIZED", "Unauthorized."); },
    save: async () => { queried = true; },
  });
  assert.equal((await unauthorized(postRequest({ reportId, response: "appointment_scheduled" }))).status, 401);
  assert.equal(queried, false);
});
