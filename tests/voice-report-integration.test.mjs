import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("recorder sends authenticated audio to the existing transcription route", async () => {
  const [hook, route] = await Promise.all([
    readSource("../hooks/useRecorder.ts"),
    readSource("../app/api/transcribe/route.ts"),
  ]);

  assert.match(hook, /getUserMedia\(\{\s*audio:\s*true/s);
  assert.match(hook, /fetch\("\/api\/transcribe"/);
  assert.match(hook, /"X-Symora-CSRF":\s*"1"/);
  assert.match(hook, /credentials:\s*"same-origin"/);
  assert.match(hook, /form\.append\("audio"/);
  assert.match(hook, /form\.append\("language",\s*language\)/);
  assert.match(route, /authenticateParticipantRequest\(req\)/);
  assert.match(route, /es:\s*"es"/);
  assert.match(route, /vi:\s*"vi"/);
  assert.match(route, /return NextResponse\.json\(\{\s*transcript,\s*languageCode:\s*language/s);
});

test("participant must edit or explicitly confirm the real transcript before analysis", async () => {
  const page = await readSource("../app/report/page.tsx");
  const hook = await readSource("../hooks/useRecorder.ts");

  assert.match(page, /useRecorder\(lang\)/);
  assert.match(page, /value=\{recorder\.transcript\}/);
  assert.match(page, /onChange=\{\(event\) => recorder\.setTranscript\(event\.target\.value\)\}/);
  assert.match(page, /onClick=\{\(\) => void prepareParticipantReport\(recorder\.transcript,\s*"voice"\)\}/);
  assert.match(page, /prepareParticipantReport\(story,\s*"portal"\)/);
  assert.match(page, /transcribing:\s*"[^"]*"/);
  assert.match(hook, /La grabación fue demasiado corta/);
  assert.match(hook, /Bản ghi quá ngắn/);
  assert.match(hook, /setTranscript\(data\.transcript\)/);
});
