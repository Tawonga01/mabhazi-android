import pg from "pg";

/**
 * Read-only verification for the additive UGC moderation and terms schema.
 *
 * Schema changes are applied by Drizzle's development push flow. This check
 * intentionally never executes DDL, so it is safe to run after a development
 * push and as a deployment preflight. Production schema changes still belong
 * to Replit Publish; do not point a schema push command at production.
 */
const requiredColumns: Record<string, readonly string[]> = {
  abuse_reports: [
    "id",
    "reporter_id",
    "target_type",
    "target_id",
    "journey_id",
    "reason",
    "details",
    "status",
    "moderator_notes",
    "reviewed_by",
    "reviewed_at",
    "created_at",
  ],
  journeys: ["moderation_status"],
  journey_reports: ["moderation_status"],
  users: ["terms_accepted_version", "terms_accepted_at"],
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to the development database");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query<{ table_name: string; column_name: string }>(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [Object.keys(requiredColumns)],
    );

    const actualColumns = new Set(
      result.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const missing = Object.entries(requiredColumns).flatMap(([table, columns]) =>
      columns
        .filter((column) => !actualColumns.has(`${table}.${column}`))
        .map((column) => `${table}.${column}`),
    );

    if (missing.length > 0) {
      throw new Error(`Missing additive schema columns: ${missing.join(", ")}`);
    }

    process.stdout.write("Additive UGC moderation and terms schema is present.\n");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "schema verification failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});