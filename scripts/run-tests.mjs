import fs from "node:fs";

const URL = process.env.ANALYZE_URL ?? "http://localhost:3000/api/analyze";
const cases = JSON.parse(fs.readFileSync("tests/analyze-cases.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(c, out) {
  const fails = [];
  const syms = out.symptoms ?? [];
  const names = syms.map((s) => s.name ?? "");

  if (out.language !== c.language) fails.push(`language should be "${c.language}", got "${out.language}"`);
  if (c.minSymptoms != null && syms.length < c.minSymptoms)
    fails.push(`expected at least ${c.minSymptoms} symptoms, got ${syms.length}`);
  for (const re of c.nameMatch ?? [])
    if (!names.some((n) => new RegExp(re, "i").test(n))) fails.push(`no symptom name matches /${re}/`);
  if (c.nameForbid && names.some((n) => new RegExp(c.nameForbid, "i").test(n)))
    fails.push(`a symptom name matches forbidden /${c.nameForbid}/`);
  if (c.allIntensityNull && syms.some((s) => s.intensity != null)) fails.push("intensity should be null (invented severity?)");
  if (c.intensityOk)
    for (const s of syms)
      if (s.intensity != null && !new RegExp(c.intensityOk, "i").test(s.intensity))
        fails.push(`intensity "${s.intensity}" looks invented`);
  if (c.allOnsetNull && syms.some((s) => s.onset_text != null)) fails.push("onset_text should be null (invented date?)");
  if (c.onsetAllMatch)
    for (const s of syms)
      if (!new RegExp(c.onsetAllMatch, "i").test(s.onset_text ?? ""))
        fails.push(`onset for "${s.name}" is "${s.onset_text}", expected /${c.onsetAllMatch}/`);
  if (c.medsEmpty && (out.medications_mentioned ?? []).length > 0) fails.push("medications should be empty");
  if (c.medsMatch && !(out.medications_mentioned ?? []).some((m) => new RegExp(c.medsMatch, "i").test(m)))
    fails.push(`no medication matches /${c.medsMatch}/`);
  if (c.ongoingAll && syms.some((s) => s.ongoing !== true)) fails.push("ongoing should be true for all symptoms");
  if (c.needClarification === true && !out.clarification) fails.push("expected a clarification question");
  return fails;
}

let passed = 0;
for (const c of cases) {
  let out;
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ transcript: c.transcript, language: c.language }),
    });
    out = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(out)}`);
  } catch (e) {
    console.log(`FAIL  ${c.name}\n      request error: ${e.message}\n`);
    await sleep(1500);
    continue;
  }
  const fails = check(c, out);
  if (fails.length === 0) {
    passed++;
    console.log(`PASS  ${c.name}`);
  } else {
    console.log(`FAIL  ${c.name}`);
    fails.forEach((f) => console.log(`      - ${f}`));
    console.log("      output:", JSON.stringify(out));
  }
  await sleep(1500); // be gentle with rate limits
}
console.log(`\n${passed}/${cases.length} passed`);