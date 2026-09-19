const PRODUCTION_API_ENV = "EXPO_PUBLIC_API_BASE_URL";
function resolveReleaseEnvironment(env = process.env) {
  const value = env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!value) throw new Error("EXPO_PUBLIC_API_BASE_URL is required.");
  return { EXPO_PUBLIC_API_BASE_URL: validateApiOrigin(value) };
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
  return resolveReleaseEnvironment(env);
}

if (require.main === module) {
  try {
    runReleasePreflight();
    process.stdout.write(
      "Mobile release preflight passed: production API configuration are present.\n",
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Mobile release preflight failed."}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { runReleasePreflight };