import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { authConfig, token } from "../tests/report-fixtures.mjs";

const mockSdk = `
export const Type = {
  OBJECT: "OBJECT",
  STRING: "STRING",
  ARRAY: "ARRAY",
  BOOLEAN: "BOOLEAN",
};

export class GoogleGenAI {
  constructor() {
    this.models = {
      generateContent: async (params) => {
        const mock = globalThis.__geminiMock;
        mock.calls.push(params);
        const error = typeof mock.error === "function"
          ? mock.error(params)
          : mock.error;
        if (error) throw error;
        return {
          text: typeof mock.text === "function" ? mock.text(params) : mock.text,
        };
      },
    };
  }
}
`;
const mockSdkUrl = `data:text/javascript,${encodeURIComponent(mockSdk)}`;
const mockNextServer = `
export const NextResponse = {
  json: (body, init) => Response.json(body, init),
};
`;
const mockNextServerUrl = `data:text/javascript,${encodeURIComponent(mockNextServer)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@google/genai") {
      return { url: mockSdkUrl, shortCircuit: true };
    }
    if (specifier === "next/server") {
      return { url: mockNextServerUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const originalApiKey = process.env.GEMINI_API_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const originalGeminiModel = process.env.GEMINI_MODEL;
const originalFallbackModel = process.env.GEMINI_FALLBACK_MODEL;
const originalDemoAuthEnabled = process.env.SYMORA_DEMO_AUTH_ENABLED;
const originalDemoParticipants = process.env.SYMORA_DEMO_PARTICIPANTS;
const testAuthParticipants = JSON.parse(authConfig().participants);
testAuthParticipants[0].expiresAt = "2099-10-10T13:00:00.000Z";
process.env.GEMINI_API_KEY = "route-test-only-key";
process.env.NODE_ENV = "test";
process.env.SYMORA_DEMO_AUTH_ENABLED = "true";
process.env.SYMORA_DEMO_PARTICIPANTS = JSON.stringify(testAuthParticipants);
globalThis.__geminiMock = { text: "", error: null, calls: [] };

const { POST } = await import("../app/api/analyze/route.ts");
const fixture = JSON.parse(
  await readFile(new URL("../tests/analyze-cases.json", import.meta.url), "utf8")
);
let passed = 0;
let failed = 0;
let requestNumber = 0;

async function test(name, run) {
  try {
    await run();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

function setGeminiResponse(value) {
  globalThis.__geminiMock = {
    text: typeof value === "string" ? value : JSON.stringify(value),
    error: null,
    calls: [],
  };
}

function setGeminiMock({ text = "", error = null }) {
  globalThis.__geminiMock = { text, error, calls: [] };
}

function validGeminiOutput() {
  return {
    language: "es",
    english_translation: "My stomach hurts and I have felt dizzy since Tuesday.",
    summary: "Stomach pain and dizziness began Tuesday.",
    symptoms: [
      {
        name: "stomach pain",
        onset_text: "Tuesday",
        intensity: null,
        ongoing: null,
        source_excerpt: "me duele el estómago",
      },
    ],
    medications_mentioned: [],
    clarification: {
      english: "How severe is the pain?",
      participant_language: "¿Qué tan intenso es el dolor?",
    },
  };
}

function createRequest(body, headers = {}) {
  const requestBody = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: {
      "x-forwarded-for": `test-client-${++requestNumber}`,
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: requestBody,
  });
}

async function post(body, headers) {
  return POST(createRequest(body, headers));
}

async function assertErrorResponse(response, expectedStatus, messageFragment) {
  assert.equal(response.status, expectedStatus);
  const payload = await response.json();
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.includes(messageFragment));
  return payload;
}

try {
  await test("valid transcript returns asserted analysis and evidence flags", async () => {
    setGeminiResponse(fixture.modelResponse);
    const response = await post(fixture.request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), fixture.expectedResponse);
    assert.equal(globalThis.__geminiMock.calls.length, 1);
    const { config } = globalThis.__geminiMock.calls[0];
    assert.equal(config.httpOptions.timeout, 10000);
    assert.ok(config.abortSignal instanceof AbortSignal);
    assert.equal(config.abortSignal.aborted, false);
  });

  await test("English, Vietnamese, and Mandarin responses validate", async () => {
    const cases = [
      {
        language: "en",
        transcript: "I have a headache and feel dizzy since Tuesday",
        excerpt: "a headache",
        name: "headache",
        secondExcerpt: "feel dizzy",
        secondName: "dizziness",
        translation: "I have a headache and feel dizzy since Tuesday.",
        onset: "Tuesday",
        participantQuestion: "What makes the headache better?",
      },
      {
        language: "vi",
        transcript: "Tôi bị đau bụng và chóng mặt từ thứ Ba",
        excerpt: "đau bụng",
        name: "stomach pain",
        secondExcerpt: "chóng mặt",
        secondName: "dizziness",
        translation: "I have stomach pain and dizziness since Tuesday.",
        onset: "Tuesday",
        participantQuestion: "Điều gì làm cơn đau bụng đỡ hơn?",
      },
      {
        language: "zh",
        transcript: "我从星期二开始肚子疼，还觉得头晕",
        excerpt: "肚子疼",
        name: "stomach pain",
        secondExcerpt: "头晕",
        secondName: "dizziness",
        translation: "I have had stomach pain since Tuesday and also feel dizzy.",
        onset: "Tuesday",
        participantQuestion: "什么能缓解头痛？",
      },
    ];

    for (const item of cases) {
      const modelOutput = {
        language: item.language,
        english_translation: item.translation,
        summary: item.translation,
        symptoms: [item.name, item.secondName].map((name, index) => ({
          name,
          onset_text: item.onset,
          intensity: null,
          ongoing: null,
          source_excerpt: index === 0 ? item.excerpt : item.secondExcerpt,
        })),
        medications_mentioned: [],
        clarification: {
          english: "What makes the symptom better?",
          participant_language: item.participantQuestion,
        },
      };
      setGeminiResponse(modelOutput);
      const response = await post({
        language: item.language,
        transcript: item.transcript,
      });
      const payload = await response.json();
      assert.equal(response.status, 200, item.language);
      assert.equal(payload.language, item.language);
      assert.equal(payload.english_translation, item.translation);
      assert.equal(payload.symptoms.length, 2);
      assert.equal(payload.symptoms[0].name, item.name);
      assert.equal(payload.symptoms[0].onset_text, item.onset);
      assert.equal(payload.symptoms[1].name, item.secondName);
      assert.equal(payload.symptoms.every((symptom) => symptom.verified_excerpt), true);
      assert.equal(payload.clarification.participant_language, item.participantQuestion);
      assert.deepEqual(payload.medications_mentioned, []);
    }
  });

  await test("unverified reported symptoms remain in the response", async () => {
    setGeminiResponse({
      ...validGeminiOutput(),
      symptoms: [
        {
          name: "dizziness",
          onset_text: null,
          intensity: "mild",
          ongoing: true,
          source_excerpt: "unquoted symptom",
        },
      ],
    });
    const response = await post({ language: "es", transcript: "me siento mareado" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.symptoms.length, 1);
    assert.equal(payload.symptoms[0].name, "dizziness");
    assert.equal(payload.symptoms[0].onset_text, null);
    assert.equal(payload.symptoms[0].intensity, "mild");
    assert.equal(payload.symptoms[0].ongoing, true);
    assert.equal(payload.symptoms[0].verified_excerpt, false);
    assert.equal(payload.requires_manual_review, true);
  });

  await test("invalid JSON is rejected before Gemini is called", async () => {
    setGeminiResponse(validGeminiOutput());
    await assertErrorResponse(await post("{"), 400, "Invalid JSON");
    assert.equal(globalThis.__geminiMock.calls.length, 0);
  });

  await test("unsupported languages are rejected before Gemini is called", async () => {
    setGeminiResponse(validGeminiOutput());
    await assertErrorResponse(
      await post({ language: "fr", transcript: "Bonjour" }),
      400,
      "Unsupported language"
    );
    assert.equal(globalThis.__geminiMock.calls.length, 0);
  });

  await test("missing transcripts are rejected before Gemini is called", async () => {
    setGeminiResponse(validGeminiOutput());
    await assertErrorResponse(await post({ language: "es" }), 400, "Transcript");
    assert.equal(globalThis.__geminiMock.calls.length, 0);
  });

  await test("oversized streamed bodies are rejected without Content-Length", async () => {
    setGeminiResponse(validGeminiOutput());
    const request = createRequest("x".repeat(50 * 1024 + 1));
    assert.equal(request.headers.has("content-length"), false);
    await assertErrorResponse(
      await POST(request),
      413,
      "50KB"
    );
    assert.equal(globalThis.__geminiMock.calls.length, 0);
  });

  await test("malformed model JSON returns a gateway error", async () => {
    setGeminiResponse("{not-json");
    await assertErrorResponse(
      await post({ language: "es", transcript: "me duele el estómago" }),
      502,
      "Malformed model response"
    );
  });

  await test("malformed model field types are rejected", async () => {
    const invalidOutputs = [
      ["symptom name", { ...validGeminiOutput(), symptoms: [{ ...validGeminiOutput().symptoms[0], name: 3 }] }],
      ["symptom onset", { ...validGeminiOutput(), symptoms: [{ ...validGeminiOutput().symptoms[0], onset_text: 3 }] }],
      ["symptom intensity", { ...validGeminiOutput(), symptoms: [{ ...validGeminiOutput().symptoms[0], intensity: false }] }],
      ["symptom ongoing", { ...validGeminiOutput(), symptoms: [{ ...validGeminiOutput().symptoms[0], ongoing: "yes" }] }],
      ["symptom evidence", { ...validGeminiOutput(), symptoms: [{ ...validGeminiOutput().symptoms[0], source_excerpt: 3 }] }],
      ["medication item", { ...validGeminiOutput(), medications_mentioned: [3] }],
      ["clarification English", { ...validGeminiOutput(), clarification: { english: 3, participant_language: "¿Qué?" } }],
      ["clarification translation", { ...validGeminiOutput(), clarification: { english: "What?", participant_language: 3 } }],
      ["missing nullable symptom field", { ...validGeminiOutput(), symptoms: [{ name: "pain", source_excerpt: "dolor", intensity: null, ongoing: null }] }],
      ["missing clarification", Object.fromEntries(Object.entries(validGeminiOutput()).filter(([key]) => key !== "clarification"))],
    ];

    for (const [field, output] of invalidOutputs) {
      setGeminiResponse(output);
      await assertErrorResponse(
        await post({ language: "es", transcript: "me duele el estómago" }),
        502,
        "strict schema"
      );
      assert.equal(globalThis.__geminiMock.calls.length, 1, `${field} should reach model validation`);
    }
  });

  await test("Gemini failures return a generic response without leaking provider errors", async () => {
    globalThis.__geminiMock = {
      text: "",
      error: new Error("private provider response and key details"),
      calls: [],
    };
    const response = await post({ language: "es", transcript: "me duele el estómago" });
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.error, "Analysis processing failed");
    assert.equal(JSON.stringify(payload).includes("private provider"), false);
  });

  await test("production requests with a verified participant token reach Gemini", async () => {
    process.env.NODE_ENV = "production";
    setGeminiResponse(validGeminiOutput());
    const response = await post({
      language: "es",
      transcript: "me duele el estómago",
    });
    assert.equal(response.status, 200);
    assert.equal(globalThis.__geminiMock.calls.length, 1);
    process.env.NODE_ENV = "test";
  });

  await test("unauthorized production requests are rejected before Gemini", async () => {
    process.env.NODE_ENV = "production";
    setGeminiResponse(validGeminiOutput());
    const response = await post(
      {
        language: "es",
        transcript: "me duele el estómago",
        participantCode: "made-up-participant",
        role: "coordinator",
      },
      {
        authorization: "Bearer made-up-token",
        "x-session-token": "made-up-session",
        "x-participant-code": "made-up-participant",
      }
    );
    await assertErrorResponse(response, 401, "Authentication required");
    assert.equal(globalThis.__geminiMock.calls.length, 0);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    process.env.NODE_ENV = "test";
  });

  await test("retryable primary-model failures proceed to the configured fallback", async () => {
    process.env.GEMINI_MODEL = "test-primary";
    process.env.GEMINI_FALLBACK_MODEL = "test-fallback";
    const output = {
      language: "en",
      english_translation: "I have a headache.",
      summary: "Headache.",
      symptoms: [{
        name: "headache",
        onset_text: null,
        intensity: null,
        ongoing: null,
        source_excerpt: "a headache",
      }],
      medications_mentioned: [],
      clarification: null,
    };
    setGeminiMock({
      error: (params) => {
        if (params.model === "test-primary") {
          return Object.assign(new Error("temporary failure"), { status: 503 });
        }
        return null;
      },
      text: (params) => params.model === "test-fallback" ? JSON.stringify(output) : "",
    });
    const response = await post({
      language: "en",
      transcript: "I have a headache",
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.symptoms[0].name, "headache");
    assert.deepEqual(
      globalThis.__geminiMock.calls.map((call) => call.model),
      ["test-primary", "test-primary", "test-primary", "test-fallback"]
    );
  });

  await test("untrusted forwarded-for values cannot bypass the shared limiter", async () => {
    process.env.GEMINI_MODEL = "";
    process.env.GEMINI_FALLBACK_MODEL = "";
    setGeminiResponse(validGeminiOutput());
    const { POST: isolatedPost } = await import("../app/api/analyze/route.ts?rate-limit-test");
    let lastResponse;
    for (let index = 0; index < 120; index++) {
      lastResponse = await isolatedPost(createRequest(
        { language: "es", transcript: "me duele el estómago" },
        { "x-forwarded-for": `spoofed-${index}` }
      ));
      assert.equal(lastResponse.status, 200);
    }
    const blocked = await isolatedPost(createRequest(
      { language: "es", transcript: "me duele el estómago" },
      { "x-forwarded-for": "another-spoofed-address" }
    ));
    await assertErrorResponse(blocked, 429, "Rate limit");
  });
} finally {
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
  for (const [key, value] of [
    ["NODE_ENV", originalNodeEnv],
    ["GEMINI_MODEL", originalGeminiModel],
    ["GEMINI_FALLBACK_MODEL", originalFallbackModel],
    ["SYMORA_DEMO_AUTH_ENABLED", originalDemoAuthEnabled],
    ["SYMORA_DEMO_PARTICIPANTS", originalDemoParticipants],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
