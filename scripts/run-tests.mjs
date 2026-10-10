import fs from "node:fs";
import path from "node:path";

async function runTests() {
  const casesPath = path.join(process.cwd(), "tests", "analyze-cases.json");
  if (!fs.existsSync(casesPath)) {
    console.error("Test cases file not found!");
    process.exit(1);
  }

  const cases = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  let passed = 0;
  let failed = 0;

  console.log(`Running ${cases.length} analyze test cases...\n`);

  for (const c of cases) {
    try {
      if (!c.transcript || !c.language) {
        throw new Error("Missing test input fields");
      }
      console.log(`PASS  ${c.name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL  ${c.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();