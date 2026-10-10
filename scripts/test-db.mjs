import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("ERROR: DATABASE_URL is missing.");
  process.exit(1);
}

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10000
});

try {
  await client.connect();

  const result = await client.query(
    "SELECT current_user, current_database()"
  );

  console.log("SUCCESS! Connected to TigerData!");
  console.log("Database user:", result.rows[0].current_user);
  console.log("Database:", result.rows[0].current_database);

} catch (error) {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

