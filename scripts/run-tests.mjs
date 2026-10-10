import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

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
        if (mock.error) throw mock.error;
        return { text: mock.text };
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
process.env.GEMINI_API_KEY = "route-test-only-key";
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
} finally {
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
