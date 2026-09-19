import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Run with the database owner credential. Never run schema pushes at server startup.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(19092026, 1)");
  await client.query("CREATE SCHEMA IF NOT EXISTS mabhazi_migrations");
  await client.query("REVOKE ALL ON SCHEMA mabhazi_migrations FROM PUBLIC");
  await client.query(`CREATE TABLE IF NOT EXISTS mabhazi_migrations.applied (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error("No database migrations found");
  for (const name of files) {
    const sql = await readFile(new URL(name, directory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query("SELECT checksum FROM mabhazi_migrations.applied WHERE name = $1", [name]);
    if (previous.rows.length) {
      if (previous.rows[0].checksum !== checksum) throw new Error("Applied migration was modified: " + name);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO mabhazi_migrations.applied (name, checksum) VALUES ($1, $2)", [name, checksum]);
    console.log("Applied " + name);
  }
  await client.query("COMMIT");
  console.log("Database migrations complete");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
