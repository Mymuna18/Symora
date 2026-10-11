// @ts-check

export const DEMO_STORAGE_KEY = "symora-public-demo-v1";
const statuses = new Set(["submitted", "reviewed", "follow_up_requested"]);
const responses = new Set(["appointment_scheduled", "will_schedule_later"]);
/** @type {[string, string[]][]} */
const symptomKeywords = [
  ["Headache", ["headache", "head pain"]],
  ["Nausea", ["nausea", "nauseous"]],
  ["Fatigue", ["fatigue", "tired"]],
  ["Dizziness", ["dizziness", "dizzy"]],
  ["Cough", ["cough"]],
  ["Pain", ["pain", "ache"]],
  ["Sleep difficulty", ["can't sleep", "cannot sleep", "trouble sleeping"]],
];

/**
 * @typedef {{
 *  id: string, description: string, createdAt: string,
 *  workflowStatus: "submitted" | "reviewed" | "follow_up_requested",
 *  statusUpdatedAt: string | null,
 *  reviewNote: string | null,
 *  participantResponse: "appointment_scheduled" | "will_schedule_later" | null,
 *  analysis: {label: string, summary: string, symptoms: string[]}
 * }} DemoReport
 */

/**
 * Create a local-only report from a fictional description.
 * @param {{id: string, description: string, createdAt: string}} input
 * @returns {DemoReport}
 */
export function createDemoReport({ id, description, createdAt }) {
  const text = description.trim();
  if (!id || !text || text.length > 1000 || !Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError("A fictional report description is required.");
  }
  const normalized = text.toLocaleLowerCase("en");
  const symptoms = symptomKeywords
    .filter(([, keywords]) => keywords.some((keyword) =>
      new RegExp(`(?:^|[^a-z])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`, "i").test(normalized)))
    .map(([name]) => name);
  return {
    id,
    description: text,
    createdAt,
    workflowStatus: "submitted",
    statusUpdatedAt: null,
    reviewNote: null,
    participantResponse: null,
    analysis: {
      label: "Simulated AI analysis — no Gemini API call was made.",
      summary: symptoms.length
        ? `Fictional participant description mentions: ${symptoms.join(", ")}.`
        : "No demo symptom keywords matched. The fictional description is retained for coordinator review.",
      symptoms,
    },
  };
}

/** @param {unknown} value */
export function parseDemoState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = /** @type {Record<string, unknown>} */ (value).report;
  if (report === null) return { report: null };
  if (!isDemoReport(report)) return null;
  return { report };
}

/** @param {unknown} value @returns {value is DemoReport} */
function isDemoReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = /** @type {Record<string, unknown>} */ (value);
  const analysis = report.analysis;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return false;
  const parsedAnalysis = /** @type {Record<string, unknown>} */ (analysis);
  return typeof report.id === "string" && report.id.length > 0
    && typeof report.description === "string" && report.description.length > 0 && report.description.length <= 1000
    && typeof report.createdAt === "string" && Number.isFinite(Date.parse(report.createdAt))
    && statuses.has(/** @type {string} */ (report.workflowStatus))
    && (report.statusUpdatedAt === null
      || (typeof report.statusUpdatedAt === "string" && Number.isFinite(Date.parse(report.statusUpdatedAt))))
    && (report.reviewNote === null || (typeof report.reviewNote === "string" && report.reviewNote.length <= 1000))
    && (report.participantResponse === null || (typeof report.participantResponse === "string" && responses.has(report.participantResponse)))
    && typeof parsedAnalysis.label === "string" && typeof parsedAnalysis.summary === "string"
    && Array.isArray(parsedAnalysis.symptoms)
    && parsedAnalysis.symptoms.every((symptom) => typeof symptom === "string");
}

/** @param {string | null} serialized */
export function readDemoState(serialized) {
  if (serialized === null) return { state: { report: null }, error: null };
  try {
    const state = parseDemoState(JSON.parse(serialized));
    return state
      ? { state, error: null }
      : { state: { report: null }, error: "Saved demo data is invalid. Reset the demo to continue." };
  } catch {
    return { state: { report: null }, error: "Saved demo data could not be read. Reset the demo to continue." };
  }
}

/** @param {{report: DemoReport | null}} state @param {"reviewed" | "follow_up_requested"} target @param {string} updatedAt */
export function updateDemoStatus(state, target, updatedAt) {
  const report = state.report;
  if (!report) throw new Error("Submit a demo report first.");
  const allowed = report.workflowStatus === "submitted"
    || (report.workflowStatus === "reviewed" && target === "follow_up_requested");
  if (!allowed) throw new Error("This demo report cannot make that status change.");
  return {
    report: {
      ...report,
      workflowStatus: target,
      statusUpdatedAt: updatedAt,
      reviewNote: target === "follow_up_requested"
        ? "Please provide any additional details about this report for the study team."
        : null,
    },
  };
}

/** @param {{report: DemoReport | null}} state @param {"appointment_scheduled" | "will_schedule_later"} response */
export function updateDemoResponse(state, response) {
  const report = state.report;
  if (!report || report.workflowStatus !== "follow_up_requested") {
    throw new Error("There is no demo follow-up request to answer.");
  }
  if (!responses.has(response)) throw new Error("Choose a valid demo response.");
  if (report.participantResponse === "appointment_scheduled" && response !== "appointment_scheduled") {
    throw new Error("The demo response is already marked scheduled.");
  }
  return { report: { ...report, participantResponse: response } };
}

/** @param {Storage} storage @param {{report: DemoReport | null}} state */
export function writeDemoState(storage, state) {
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}
