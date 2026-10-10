import type { Report } from "./types";

export const mockReports: Report[] = [
  {
    id: "r1",
    participantCode: "DEMO-014",
    language: "es",
    createdAt: "2026-10-10T14:05:00Z",
    transcript: "Tengo dolor de cabeza desde ayer y me siento un poco mareada.",
    status: "new",
    analysis: {
      englishTranslation: "I've had a headache since yesterday and I feel a bit dizzy.",
      englishSummary: "Participant reports a headache starting yesterday and mild dizziness.",
      symptoms: [
        { name: "headache", intensity: null, onsetText: "since yesterday", ongoing: true, sourceQuote: "dolor de cabeza desde ayer" },
        { name: "dizziness", intensity: null, onsetText: null, ongoing: null, sourceQuote: "me siento un poco mareada" },
      ],
      missingFields: ["headache intensity", "dizziness onset"],
      suggestedFollowUpQuestion: "¿Qué tan fuerte es el dolor de cabeza, de 1 a 10?",
    },
  },
  {
    id: "r2",
    participantCode: "DEMO-022",
    language: "en",
    createdAt: "2026-10-09T18:40:00Z",
    transcript: "I felt nauseous after my morning dose, about a 4 out of 10, and it went away by lunch.",
    status: "reviewed",
    analysis: {
      englishTranslation: "I felt nauseous after my morning dose, about a 4 out of 10, and it went away by lunch.",
      englishSummary: "Participant reports nausea after the morning dose, intensity 4/10, resolved by lunch.",
      symptoms: [
        { name: "nausea", intensity: 4, onsetText: "after morning dose", ongoing: false, sourceQuote: "felt nauseous after my morning dose" },
      ],
      missingFields: [],
      suggestedFollowUpQuestion: null,
    },
  },
];