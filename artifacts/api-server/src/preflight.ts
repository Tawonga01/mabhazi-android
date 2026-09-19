import pg from "pg";

import { getAllowedOrigins } from "./lib/origins";
import { supabaseConfiguration } from "./lib/supabaseAuth";
const REQUIRED_ENVIRONMENT = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_SECRET", "PUBLIC_ORIGIN"] as const;

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
  journey_reports: ["id", "journey_id", "user_id", "content", "moderation_status"],
  journeys: ["id", "contributed_by", "moderation_status"],
  sessions: ["sid", "sess", "expire"],
  auth_deletion_jobs: ["user_id", "created_at"],
  users: ["id", "terms_accepted_version", "terms_accepted_at"],
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getMissingProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return REQUIRED_ENVIRONMENT.filter((name) => !hasValue(env[name]));
}

/** Validate the exact same origin configuration used by callbacks and CORS. */
export function validateProductionOrigins(env: NodeJS.ProcessEnv = process.env): void {
  getAllowedOrigins({ ...env, NODE_ENV: "production" });
}

async function verifyDatabaseSchema(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
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
      throw new Error("missing schema");
    }
  } catch {
    // Never include a driver error: it may contain the DATABASE_URL.
    throw new Error("Production database schema readiness check failed.");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function runProductionPreflight(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const missing = getMissingProductionEnvironment(env);
  if (missing.length > 0) {
    throw new Error(
      `Production preflight failed. Missing required environment: ${missing.join(", ")}.`,
    );
  }

  validateProductionOrigins(env);
  supabaseConfiguration(env);
  await verifyDatabaseSchema(env.DATABASE_URL as string);
}

if (process.argv[1]?.endsWith("preflight.ts")) {
  runProductionPreflight()
    .then(() => {
      process.stdout.write(
        "Production preflight passed: required configuration, origin, and database schema are ready.\n",
      );
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Production preflight failed.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}