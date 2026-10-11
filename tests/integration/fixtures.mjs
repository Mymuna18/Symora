export const ids = Object.freeze({
  active: "11111111-1111-4111-8111-111111111111",
  withdrawn: "22222222-2222-4222-8222-222222222222",
  headache: "33333333-3333-4333-8333-333333333333",
  nausea: "44444444-4444-4444-8444-444444444444",
  inactive: "55555555-5555-4555-8555-555555555555",
  absent: "99999999-9999-4999-8999-999999999999",
});

export const transcript = "  Tengo dolor de cabeza, cuatro de diez.\n昨天也有头痛。 😟  ";
export const evidence = "  dolor de cabeza, cuatro de diez\n";

export function submission(symptoms = [{ symptomCode: "headache", reportedIntensity: 4, participantDescription: evidence }]) {
  return {
    workflowStatus: "submitted", confirmed: true, source: "voice",
    originalLanguage: "es", originalTranscript: transcript,
    englishSummary: "The participant reports a headache with intensity four out of ten.",
    symptoms,
  };
}

export async function seedFixtures(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO participants (id, participant_code, trial_id, status)
       VALUES ($1, 'SYNTHETIC-ACTIVE', 'LOCAL-TEST-ONLY', 'active'),
              ($2, 'SYNTHETIC-WITHDRAWN', 'LOCAL-TEST-ONLY', 'withdrawn')`,
      [ids.active, ids.withdrawn],
    );
    await client.query(
      `INSERT INTO symptoms (id, code, display_name, is_active)
       VALUES ($1, 'headache', 'Synthetic headache', TRUE),
              ($2, 'nausea', 'Synthetic nausea', TRUE),
              ($3, 'inactive_test', 'Inactive synthetic symptom', FALSE)`,
      [ids.headache, ids.nausea, ids.inactive],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
