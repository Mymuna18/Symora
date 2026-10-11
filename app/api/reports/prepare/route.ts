import { authenticateParticipantRequest, withPrivateResponse } from "../../../../lib/request-auth.mjs";
import { getPool } from "../../../../lib/db.mjs";
import { createReportPreparationHandler } from "../../../../lib/report-analysis.mjs";


export const POST = withPrivateResponse(createReportPreparationHandler({
  authenticate: authenticateParticipantRequest,
  loadCatalog: async () => {
    const result = await getPool().query(
      "SELECT code, display_name FROM symptoms WHERE is_active = TRUE ORDER BY display_name, code",
    );
    return result.rows.map((row: { code: string; display_name: string }) => ({
      code: row.code,
      displayName: row.display_name,
    }));
  },
}));
