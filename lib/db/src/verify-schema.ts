import pg from "pg";
import { getTableColumns, getTableName } from "drizzle-orm";
import { intakeTables } from "./schema/contributionIntake";
import { transportTables } from "./schema/transportStructure";
import { reviewTables } from "./schema/reviewDecisions";

/**
 * Read-only presence check for legacy and v2 intake columns.
 * Apply versioned SQL with the owner-only migration runner, never schema push
 * at startup. Presence does not replace the constraint/RLS/erasure test suite.
 */
const requiredColumns: Record<string, readonly string[]> = {
  ...Object.fromEntries([...intakeTables, ...transportTables, ...reviewTables].map(table => [getTableName(table), Object.values(getTableColumns(table)).map(column => column.name)])),
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
    throw new Error("DATABASE_URL is required");
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

    process.stdout.write("Legacy moderation/terms and v2 intake columns are present.\n");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "schema verification failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
