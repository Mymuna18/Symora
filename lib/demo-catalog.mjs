// Deliberately agreed demo vocabulary, not diagnoses or AI-generated codes.
export const DEMO_CATALOG = Object.freeze([
  { code: "headache", displayName: "Headache" },
  { code: "dizziness", displayName: "Dizziness" },
  { code: "stomach_pain", displayName: "Stomach pain" },
  { code: "nausea", displayName: "Nausea" },
  { code: "fatigue", displayName: "Fatigue" },
].map(Object.freeze));

const normalize = (name) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
export const CATALOG_SELECT = `SELECT code, display_name, is_active FROM public.symptoms
  WHERE code = ANY($1::text[])
     OR lower(btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g'))) = ANY($2::text[])
  ORDER BY code`;
export const CATALOG_INSERT = `INSERT INTO public.symptoms (code, display_name, is_active)
  SELECT code, display_name, TRUE FROM unnest($1::text[], $2::text[]) AS seed(code, display_name)
  ON CONFLICT (code) DO NOTHING RETURNING code`;

export async function inspectDemoCatalog(client) {
  const rows = (await client.query(CATALOG_SELECT, [
    DEMO_CATALOG.map(({ code }) => code), DEMO_CATALOG.map(({ displayName }) => normalize(displayName)),
  ])).rows;
  const existing = new Set();
  for (const row of rows) {
    const expected = DEMO_CATALOG.find(({ code }) => code === row.code);
    // Stop on aliases, duplicate labels, changed meanings, or inactive records.
    // Never overwrite, relabel, reactivate, or silently skip such a conflict.
    if (!expected || typeof row.display_name !== "string" || row.is_active !== true
      || normalize(row.display_name) !== normalize(expected.displayName) || existing.has(row.code)) {
      throw new Error("Demo catalog conflicts with existing data; review before seeding.");
    }
    existing.add(row.code);
  }
  return {
    existing: DEMO_CATALOG.filter(({ code }) => existing.has(code)),
    missing: DEMO_CATALOG.filter(({ code }) => !existing.has(code)),
  };
}

// Caller must hold the approved transaction and table lock. Writes only missing
// catalog rows; participants, reports and permissions are never touched.
export async function insertMissingDemoCatalog(client, missing) {
  if (missing.length === 0) return 0;
  const result = await client.query(CATALOG_INSERT, [
    missing.map(({ code }) => code), missing.map(({ displayName }) => displayName),
  ]);
  return result.rows.length;
}
