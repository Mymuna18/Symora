export type Symptom = {
  name: string;
  intensity: number | null;
  onsetText: string | null;
  ongoing: boolean | null;
  sourceQuote: string;
};

export type Analysis = {
  englishTranslation: string;
  englishSummary: string;
  symptoms: Symptom[];
  missingFields: string[];
  suggestedFollowUpQuestion: string | null;
};

export type ReviewStatus = "new" | "reviewed" | "follow_up_requested";
export type Language = "en" | "es" | "zh" | "vi";

export type Report = {
  id: string;
  participantCode: string;
  language: Language;
  createdAt: string;
  transcript: string;
  analysis: Analysis;
  status: ReviewStatus;
};