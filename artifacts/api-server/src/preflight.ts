import pg from "pg";

const PRODUCTION_ORIGIN = "https://mabhaziv-2.replit.app";
const REQUIRED_ENVIRONMENT = ["DATABASE_URL", "REPL_ID", "ADMIN_SECRET"] as const;

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

function validateOrigin(value: string, name: string): void {
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
}

/**
 * Validate origin inputs without printing their values. The fixed production
 * origin remains the server fallback; any platform-provided origin is checked
 * so a malformed deployment cannot start with unusable OAuth redirects.
 */
export function validateProductionOrigins(
  env: NodeJS.ProcessEnv = process.env,
): void {
  validateOrigin(PRODUCTION_ORIGIN, "production origin");

  for (const name of [
    "PUBLIC_ORIGIN",
    "EXPO_PUBLIC_API_BASE_URL",
    "REPLIT_DEV_DOMAIN",
    "REPLIT_EXPO_DEV_DOMAIN",
  ] as const) {
    const value = env[name]?.trim();
    if (value) validateOrigin(value, name);
  }

  for (const value of env.REPLIT_DOMAINS?.split(",") ?? []) {
    if (value.trim()) validateOrigin(value.trim(), "REPLIT_DOMAINS");
  }
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