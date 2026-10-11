import { getPool } from "../../../../lib/db.mjs";
import { authenticateCoordinator } from "../../../../lib/coordinator-auth.mjs";
import { createCoordinatorReportsHandler, listCoordinatorReports } from "../../../../lib/coordinator-reports.mjs";

export const GET = createCoordinatorReportsHandler({
  authenticate: authenticateCoordinator,
  list: (pagination) => listCoordinatorReports(getPool, pagination),
});
