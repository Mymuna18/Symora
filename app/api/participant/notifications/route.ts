import { getPool } from "../../../../lib/db.mjs";
import { authenticateParticipantRequest, withPrivateResponse } from "../../../../lib/request-auth.mjs";
import { createParticipantNotificationsHandler, listParticipantNotifications } from "../../../../lib/participant-notifications.mjs";

export const GET = withPrivateResponse(createParticipantNotificationsHandler({
  authenticate: authenticateParticipantRequest,
  list: (participantId) => listParticipantNotifications(getPool, participantId),
}));
