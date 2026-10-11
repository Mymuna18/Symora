import assert from "node:assert/strict";
import { test } from "node:test";
import { createParticipantNotificationsHandler, listParticipantNotifications } from "../lib/participant-notifications.mjs";
import { ReportError } from "../lib/report-errors.mjs";

const participantId = "11111111-1111-4111-8111-111111111111";
const notification = {
  notificationId: "44444444-4444-4444-8444-444444444444",
  reportId: "22222222-2222-4222-8222-222222222222",
  message: "Please clarify when your fictional headache began.",
  createdAt: "2026-10-11T09:00:00.000Z",
};

test("notifications are participant-scoped and expose only the message contract", async () => {
  const calls = [];
  const getPool = () => ({ query: async (sql, values) => {
    calls.push({ sql, values });
    assert.deepEqual(values, [participantId]);
    return { rows: [notification] };
  } });
  const result = await listParticipantNotifications(getPool, participantId);
  assert.deepEqual(result, { notifications: [notification] });
  assert.match(calls[0].sql, /r\.participant_id = \$1/);
  assert.match(calls[0].sql, /h\.new_workflow_status = 'follow_up_requested'/);
  assert.doesNotMatch(JSON.stringify(result), /reviewer_user_id|coordinator|participantCode|token/i);
});

test("notification database errors are sanitized", async () => {
  await assert.rejects(listParticipantNotifications(
    () => ({ query: async () => { throw new Error("private database connection details"); } }),
    participantId,
  ), { code: "NOTIFICATIONS_UNAVAILABLE" });
});

test("participant identity comes from authentication and unauthorized requests do not query", async () => {
  let queried = false;
  const handler = createParticipantNotificationsHandler({
    authenticate: async () => participantId,
    list: async (id) => {
      assert.equal(id, participantId);
      return { notifications: [notification] };
    },
  });
  const response = await handler(new Request("http://localhost/api/participant/notifications"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { notifications: [notification] });

  const unauthorized = createParticipantNotificationsHandler({
    authenticate: async () => { throw new ReportError(401, "UNAUTHORIZED", "Unauthorized."); },
    list: async () => { queried = true; return { notifications: [] }; },
  });
  assert.equal((await unauthorized(new Request("http://localhost/api/participant/notifications"))).status, 401);
  assert.equal(queried, false);
});
