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

export type ReportLanguage = "en" | "es" | "vi" | "zh";

export type BrowserSession =
  | { authenticated: false }
  | {
      authenticated: true;
      user: { role: "participant" | "coordinator"; username: string };
      expiresAt: string;
    };

export interface AnalyzeRequest {
  transcript: string;
  language: ReportLanguage;
}

export interface AnalyzedSymptom {
  name: string;
  onset_text: string | null;
  intensity: string | null;
  ongoing: boolean | null;
  source_excerpt: string;
  verified_excerpt: boolean;
}

export interface AnalyzeResponse {
  language: ReportLanguage;
  english_translation: string;
  summary: string;
  symptoms: AnalyzedSymptom[];
  medications_mentioned: string[];
  clarification: { english: string; participant_language: string } | null;
  requires_manual_review: boolean;
  demo_fallback: boolean;
}

export interface PrepareReportRequest {
  source: "portal" | "voice";
  transcript: string;
  analysis: AnalyzeResponse;
}

export interface PreparedSymptom {
  name: string;
  sourceExcerpt: string;
  evidenceVerified: boolean;
  suggestedSymptomCode: string | null;
  mappingStatus: "suggested" | "unresolved";
  unresolvedReason: string | null;
  reportedIntensityText: string | null;
  onsetText: string | null;
  ongoingCandidate: boolean | null;
}

export interface PreparedReportDraft {
  source: "portal" | "voice";
  originalLanguage: string;
  originalTranscript: string;
  englishSummary: string | null;
  symptoms: PreparedSymptom[];
}

export interface PrepareReportResponse {
  draft: PreparedReportDraft;
  symptomCatalog: { symptomCode: string; displayName: string }[];
  allSymptomsMapped: boolean;
  requiresParticipantConfirmation: true;
}

export type CoordinatorWorkflowStatus =
  | "submitted"
  | "reviewed"
  | "follow_up_requested"
  | "closed";

export interface CoordinatorReportSymptom {
  symptomCode: string;
  displayName: string;
  reportedIntensity: number | null;
  onsetDate: string | null;
  ongoing: boolean | null;
  participantDescription: string | null;
}

export interface CoordinatorReport {
  id: string;
  participantCode: string;
  source: "portal" | "voice";
  originalLanguage: string;
  originalTranscript: string;
  englishSummary: string | null;
  submittedAt: string;
  workflowStatus: CoordinatorWorkflowStatus;
  symptoms: CoordinatorReportSymptom[];
}

export interface CoordinatorReportsResponse {
  reports: CoordinatorReport[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}
