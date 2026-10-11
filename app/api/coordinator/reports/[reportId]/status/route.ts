import { getPool } from "../../../../../../lib/db.mjs";
import { authenticateCoordinatorRequest, withPrivateResponse } from "../../../../../../lib/request-auth.mjs";
import { createCoordinatorStatusHandler, updateCoordinatorReportStatus } from "../../../../../../lib/coordinator-review.mjs";

const patchStatus = createCoordinatorStatusHandler({
  authenticate: authenticateCoordinatorRequest,
  update: (reportId, reviewerUserId, input) =>
    updateCoordinatorReportStatus(getPool, reportId, reviewerUserId, input),
});

export const PATCH = async (
  request: Request,
  context: { params: Promise<{ reportId: string }> },
) => {
  const { reportId } = await context.params;
  return withPrivateResponse((req) => patchStatus(req, reportId))(request);
};
