/** Confirmed participant statements only; intensity is never clinical severity. */
export interface ReportSymptomInput {
  symptomCode: string;
  reportedIntensity?: number | null;
  onsetDate?: string | null;
  ongoing?: boolean | null;
  participantDescription?: string | null;
}

export interface SubmitReportRequest {
  workflowStatus: "submitted";
  confirmed: true;
  source: "portal" | "voice";
  originalLanguage: string;
  originalTranscript: string;
  englishSummary?: string | null;
  symptoms: ReportSymptomInput[];
}

export interface CreatedReport {
  id: string;
  workflowStatus: "submitted";
  submittedAt: string;
  symptomCount: number;
}

export interface SubmitReportResponse {
  report: CreatedReport;
}

export interface ReportErrorResponse {
  error: { code: string; message: string; field?: string };
}
