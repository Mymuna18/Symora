import { getPool } from "../../../../lib/db.mjs";
import { authenticateParticipantRequest, withPrivateResponse } from "../../../../lib/request-auth.mjs";
import {
  createParticipantFollowUpResponseHandler,
  saveParticipantFollowUpResponse,
} from "../../../../lib/participant-notifications.mjs";

export const POST = withPrivateResponse(createParticipantFollowUpResponseHandler({
  authenticate: authenticateParticipantRequest,
  save: (participantId, reportId, response) =>
    saveParticipantFollowUpResponse(getPool, participantId, reportId, response),
}));
