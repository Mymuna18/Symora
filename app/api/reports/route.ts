import { getPool } from "../../../lib/db.mjs";
import { authenticateDemoParticipant } from "../../../lib/demo-auth.mjs";
import { createReportHandler } from "../../../lib/report-http.mjs";
import { saveReport } from "../../../lib/report-store.mjs";


export const POST = createReportHandler({
  authenticate: authenticateDemoParticipant,
  save: (participantId, input) => saveReport(getPool, participantId, input),
});
