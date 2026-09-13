const PRODUCTION_API_ENV = "EXPO_PUBLIC_API_BASE_URL";
const PUBLIC_RELEASE_ENV = "EXPO_PUBLIC_REPL_ID";
const SERVER_RELEASE_ENV = "REPL_ID";
const PRODUCTION_API_BASE_URL = "https://mabhaziv-2.replit.app";

function resolveReleaseEnvironment(env = process.env) {
  const replId =
    (typeof env[PUBLIC_RELEASE_ENV] === "string"
      ? env[PUBLIC_RELEASE_ENV].trim()
      : "") ||
    (typeof env[SERVER_RELEASE_ENV] === "string"
      ? env[SERVER_RELEASE_ENV].trim()
      : "");
  if (!replId) {
    throw new Error(
      `Release preflight failed. Missing required environment: ${PUBLIC_RELEASE_ENV} or ${SERVER_RELEASE_ENV}.`,
    );
  }

  const configuredApi =
    (typeof env[PRODUCTION_API_ENV] === "string"
      ? env[PRODUCTION_API_ENV].trim()
      : "") ||
    (typeof env.EXPO_PUBLIC_DOMAIN === "string"
      ? env.EXPO_PUBLIC_DOMAIN.trim()
      : "") ||
    PRODUCTION_API_BASE_URL;

  return {
    EXPO_PUBLIC_REPL_ID: replId,
    EXPO_PUBLIC_API_BASE_URL: validateApiOrigin(configuredApi),
  };
}

function validateApiOrigin(value) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${PRODUCTION_API_ENV} must be a valid HTTPS origin.`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${PRODUCTION_API_ENV} must be a valid HTTPS origin.`);
  }

  return parsed.origin;
}

function runReleasePreflight(env = process.env) {
  // These checks intentionally report names only. EXPO_PUBLIC_REPL_ID is a
  // public OAuth client identifier, but release logs should not copy config
  // values or accidentally train callers to expose environment values.
  return resolveReleaseEnvironment(env);
}

if (require.main === module) {
  try {
    runReleasePreflight();
    process.stdout.write(
      "Mobile release preflight passed: OAuth and production API configuration are present.\n",
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Mobile release preflight failed."}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { runReleasePreflight };