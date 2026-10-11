import type { AnalyzeResponse, PreparedReportDraft, PreparedSymptom } from "@/types/reports";
import Link from "next/link";

export type EditablePreparedSymptom = PreparedSymptom & {
  symptomCode: string;
  reportedIntensity: number | null;
  onsetDate: string;
  ongoing: boolean | null;
  participantDescription: string;
};

type Labels = {
  title: string;
  originalTranscript: string;
  translatedReport: string;
  summary: string;
  extractedSymptoms: string;
  symptom: string;
  selectSymptom: string;
  participantDescription: string;
  descriptionError: string;
  reportedIntensity: string;
  intensityHint: string;
  intensityError: string;
  onsetDate: string;
  onsetText: string;
  ongoing: string;
  ongoingCandidate: string;
  unknown: string;
  ongoingYes: string;
  ongoingNo: string;
  noSymptoms: string;
  verified: string;
  unverified: string;
  manualReview: string;
  analysisClarification: string;
  reviewConfirmation: string;
  submit: string;
  submitting: string;
  cancel: string;
  authLink: string;
};

type Props = {
  transcript: string;
  analysis: AnalyzeResponse;
  draft: PreparedReportDraft;
  symptomCatalog: { symptomCode: string; displayName: string }[];
  symptoms: EditablePreparedSymptom[];
  onSymptomsChange: (symptoms: EditablePreparedSymptom[]) => void;
  englishSummary: string;
  onEnglishSummaryChange: (summary: string) => void;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  labels: Labels;
  isSubmitting: boolean;
  error: string | null;
  authenticationBlocked: boolean;
  submissionUncertain: boolean;
};

export function ParticipantReportReview({
  transcript,
  analysis,
  draft,
  symptomCatalog,
  symptoms,
  onSymptomsChange,
  englishSummary,
  onEnglishSummaryChange,
  confirmed,
  onConfirmedChange,
  onSubmit,
  onCancel,
  labels,
  isSubmitting,
  error,
  authenticationBlocked,
  submissionUncertain,
}: Props) {
  const selectedCodes = symptoms.map((symptom) => symptom.symptomCode).filter(Boolean);
  const hasUnmapped = selectedCodes.length !== symptoms.length;
  const hasDuplicateCodes = new Set(selectedCodes).size !== selectedCodes.length;
  const hasInvalidIntensity = symptoms.some((symptom) =>
    symptom.reportedIntensity !== null &&
    (!Number.isInteger(symptom.reportedIntensity) || symptom.reportedIntensity < 0 || symptom.reportedIntensity > 10),
  );
  const hasLongDescription = symptoms.some((symptom) => symptom.participantDescription.length > 2_000);
  const canSubmit = confirmed && !hasUnmapped && !hasDuplicateCodes && !hasInvalidIntensity && !hasLongDescription && !isSubmitting && !submissionUncertain;

  function updateSymptom(index: number, patch: Partial<EditablePreparedSymptom>) {
    onConfirmedChange(false);
    onSymptomsChange(symptoms.map((symptom, itemIndex) =>
      itemIndex === index ? { ...symptom, ...patch } : symptom,
    ));
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="report-review-title">
      <h1 id="report-review-title" className="text-3xl font-bold text-forest-800">
        {labels.title}
      </h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-forest-800">{labels.originalTranscript}</h2>
        <blockquote className="rounded-2xl border border-forest-800/20 bg-white/80 p-4 text-lg">
          {transcript}
        </blockquote>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-forest-800">{labels.translatedReport}</h2>
        <textarea
          value={englishSummary}
          onChange={(event) => {
            onConfirmedChange(false);
            onEnglishSummaryChange(event.target.value);
          }}
          rows={3}
          maxLength={10_000}
          aria-label={labels.translatedReport}
          className="w-full rounded-2xl border border-forest-800/25 bg-white/90 p-4 text-base"
        />
        <p className="text-sm text-muted">{labels.summary}: {analysis.summary}</p>
      </section>

      {analysis.clarification && (
        <p role="note" className="rounded-2xl border border-amber-700/20 bg-amber-50/80 p-3 text-sm text-amber-950">
          <strong>{labels.analysisClarification}:</strong> {analysis.clarification.participant_language}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-forest-800">{labels.extractedSymptoms}</h2>
        {symptoms.length === 0 ? (
          <p className="rounded-2xl border border-forest-800/20 bg-white/80 p-4 text-muted">
            {labels.noSymptoms}
          </p>
        ) : (
          symptoms.map((symptom, index) => (
            <fieldset key={`${symptom.sourceExcerpt}-${index}`} className="flex flex-col gap-3 rounded-2xl border border-forest-800/20 bg-white/80 p-4">
              <legend className="px-1 font-semibold text-forest-800">{labels.symptom} {index + 1}</legend>
              <p className="text-sm text-muted">{labels.originalTranscript}: “{symptom.sourceExcerpt}”</p>
              <p className={`text-sm ${symptom.evidenceVerified ? "text-green-800" : "text-red-800"}`}>
                {symptom.evidenceVerified ? labels.verified : labels.unverified}
              </p>

              <label className="flex flex-col gap-1 text-sm font-medium text-forest-800">
                {labels.symptom}
                <select
                  value={symptom.symptomCode}
                  onChange={(event) => updateSymptom(index, { symptomCode: event.target.value })}
                  className="min-h-12 w-full rounded-xl border border-forest-800/25 bg-white px-3"
                >
                  <option value="">{labels.selectSymptom}</option>
                  {symptomCatalog.map((entry) => (
                    <option key={entry.symptomCode} value={entry.symptomCode}>
                      {entry.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-forest-800">
                {labels.participantDescription}
                <textarea
                  value={symptom.participantDescription}
                  onChange={(event) => updateSymptom(index, { participantDescription: event.target.value })}
                  maxLength={2_000}
                  rows={2}
                  className="w-full rounded-xl border border-forest-800/25 bg-white px-3 py-2"
                />
                {symptom.participantDescription.length > 2_000 && (
                  <span role="alert" className="text-sm font-normal text-red-800">
                    {labels.descriptionError}
                  </span>
                )}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-forest-800">
                  {labels.reportedIntensity}
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={symptom.reportedIntensity ?? ""}
                    onChange={(event) => updateSymptom(index, {
                      reportedIntensity: event.target.value === "" ? null : Number(event.target.value),
                    })}
                    className="min-h-12 w-full rounded-xl border border-forest-800/25 bg-white px-3"
                  />
                  <span className="font-normal text-muted">
                    {labels.intensityHint}{symptom.reportedIntensityText ? ` ${symptom.reportedIntensityText}` : ""}
                  </span>
                  {symptom.reportedIntensity !== null &&
                    (!Number.isInteger(symptom.reportedIntensity) || symptom.reportedIntensity < 0 || symptom.reportedIntensity > 10) && (
                      <span role="alert" className="text-sm font-normal text-red-800">
                        {labels.intensityError}
                      </span>
                    )}
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-forest-800">
                  {labels.onsetDate}
                  <input
                    type="date"
                    value={symptom.onsetDate}
                    onChange={(event) => updateSymptom(index, { onsetDate: event.target.value })}
                    className="min-h-12 w-full rounded-xl border border-forest-800/25 bg-white px-3"
                  />
                  <span className="font-normal text-muted">
                    {symptom.onsetText ? `${labels.onsetText}: ${symptom.onsetText}` : ""}
                  </span>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm font-medium text-forest-800">
                {labels.ongoing}
                <span className="font-normal text-muted">
                  {labels.ongoingCandidate}: {symptom.ongoingCandidate === null ? labels.unknown : symptom.ongoingCandidate ? labels.ongoingYes : labels.ongoingNo}
                </span>
                <select
                  value={symptom.ongoing === null ? "" : String(symptom.ongoing)}
                  onChange={(event) => updateSymptom(index, {
                    ongoing: event.target.value === "" ? null : event.target.value === "true",
                  })}
                  className="min-h-12 w-full rounded-xl border border-forest-800/25 bg-white px-3"
                >
                  <option value="">{labels.unknown}</option>
                  <option value="true">{labels.ongoingYes}</option>
                  <option value="false">{labels.ongoingNo}</option>
                </select>
              </label>
            </fieldset>
          ))
        )}
      </section>

      {(analysis.requires_manual_review || !draft.symptoms.every((symptom) => symptom.evidenceVerified)) && (
        <p className="rounded-2xl border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950" role="status">
          {labels.manualReview}
        </p>
      )}
      {hasUnmapped && <p role="alert" className="text-sm text-red-800">{labels.selectSymptom}</p>}
      {hasDuplicateCodes && <p role="alert" className="text-sm text-red-800">Each symptom must have a different catalog entry.</p>}
      {error && (
        <div role="alert" className="rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
          <p>{error}</p>
          {authenticationBlocked && (
            <Link href="/participant-login" className="mt-2 inline-block font-semibold underline">
              {labels.authLink}
            </Link>
          )}
        </div>
      )}
      {submissionUncertain && (
        <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">
          Submission status could not be confirmed. Do not submit again; contact the study team to verify.
        </p>
      )}

      <label className="flex items-start gap-3 rounded-xl border border-forest-800/20 bg-white/70 p-3 text-sm text-forest-800">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#1f6f6b]"
        />
        <span>{labels.reviewConfirmation}</span>
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="min-h-14 flex-1 rounded-full bg-forest-800 px-6 py-3 font-semibold text-white transition-colors hover:bg-leaf disabled:opacity-50"
        >
          {isSubmitting ? labels.submitting : labels.submit}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-14 flex-1 rounded-full border border-forest-800/30 bg-white/70 px-6 py-3 font-semibold text-forest-800 disabled:opacity-50"
        >
          {labels.cancel}
        </button>
      </div>
    </section>
  );
}
