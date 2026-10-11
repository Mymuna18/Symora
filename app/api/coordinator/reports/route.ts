import { getPool } from "../../../../lib/db.mjs";
import { authenticateCoordinatorRequest, withPrivateResponse } from "../../../../lib/request-auth.mjs";
import { createCoordinatorReportsHandler, listCoordinatorReports } from "../../../../lib/coordinator-reports.mjs";

export const GET = withPrivateResponse(createCoordinatorReportsHandler({
  authenticate: authenticateCoordinatorRequest,
  list: (pagination) => listCoordinatorReports(getPool, pagination),
}));
