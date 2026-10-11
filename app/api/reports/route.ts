import { getPool } from "../../../lib/db.mjs";
import { authenticateParticipantRequest, withPrivateResponse } from "../../../lib/request-auth.mjs";
import { createReportHandler } from "../../../lib/report-http.mjs";
import { saveReport } from "../../../lib/report-store.mjs";


export const POST = withPrivateResponse(createReportHandler({
  authenticate: authenticateParticipantRequest,
  save: (participantId, input) => saveReport(getPool, participantId, input),
}));
