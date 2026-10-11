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
    language: "zh",
    createdAt: "2026-10-09T18:40:00Z",
    transcript: "早上吃药以后我觉得恶心，大概四分，中午就好了。",
    status: "reviewed",
    analysis: {
      englishTranslation: "I felt nauseous after taking my medicine in the morning, about a 4 out of 10, and it went away by lunch.",
      englishSummary: "Participant reports nausea after the morning dose, intensity 4/10, resolved by lunch.",
      symptoms: [
        { name: "nausea", intensity: 4, onsetText: "after morning dose", ongoing: false, sourceQuote: "早上吃药以后我觉得恶心" },
      ],
      missingFields: [],
      suggestedFollowUpQuestion: null,
    },
  },
  {
    id: "r3",
    participantCode: "DEMO-031",
    language: "es",
    createdAt: "2026-10-10T20:15:00Z",
    transcript: "Tengo náuseas desde hace dos horas, como un 6 de 10, y un poco de dolor de pecho, más o menos 8.",
    status: "new",
    analysis: {
      englishTranslation: "I've had nausea for two hours, about a 6 out of 10, and a bit of chest pain, around an 8.",
      englishSummary: "Participant reports nausea (6/10) and chest pain (8/10), both for about two hours.",
      symptoms: [
        { name: "chest pain", intensity: 8, onsetText: "2 hours ago", ongoing: true, sourceQuote: "un poco de dolor de pecho, más o menos 8" },
        { name: "nausea", intensity: 6, onsetText: "2 hours ago", ongoing: true, sourceQuote: "náuseas desde hace dos horas, como un 6 de 10" },
      ],
      missingFields: [],
      suggestedFollowUpQuestion: null,
    },
  },
  {
    id: "r4",
    participantCode: "DEMO-014",
    language: "vi",
    createdAt: "2026-10-08T15:30:00Z",
    transcript: "Tôi bị đau họng từ sáng nay, khoảng 2 trên 10. Tôi đang uống trà mật ong.",
    status: "follow_up_requested",
    analysis: {
      englishTranslation: "I've had a sore throat since this morning, about a 2 out of 10. I'm drinking honey tea.",
      englishSummary: "Participant reports a mild sore throat since the morning (2/10), taking honey tea.",
      symptoms: [
        { name: "sore throat", intensity: 2, onsetText: "since this morning", ongoing: true, sourceQuote: "đau họng từ sáng nay" },
      ],
      missingFields: [],
      suggestedFollowUpQuestion: null,
    },
  },
];