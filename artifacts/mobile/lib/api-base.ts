const PRODUCTION_API_BASE_URL = "https://api.mabhazi.com";

/**
 * Resolve the API origin used by both the generated API client and auth.
 *
 * Release builds must never silently turn an absent or malformed API
 * configuration into a relative URL (which would make auth depend on the
 * current page origin). The production origin is an explicit HTTPS fallback.
 */
export function resolveApiBaseUrl(
  configuredValue = (
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_DOMAIN?.trim()
  ),
): string {
  const candidate = configuredValue
    ? /^https?:\/\//i.test(configuredValue)
      ? configuredValue
      : `https://${configuredValue}`
    : PRODUCTION_API_BASE_URL;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") {
      throw new Error("the API URL must use HTTPS");
    }
    return url.origin;
  } catch (error) {
    const isDevelopment =
      typeof __DEV__ !== "undefined" && Boolean(__DEV__);
    if (isDevelopment) {
      console.warn(
        `[Mabhazi] Invalid API URL "${configuredValue}". Falling back to ${PRODUCTION_API_BASE_URL}.`,
        error,
      );
      return PRODUCTION_API_BASE_URL;
    }
    throw new Error(
      "[Mabhazi] Invalid release API URL. Set EXPO_PUBLIC_API_BASE_URL to an HTTPS URL.",
    );
  }
}

export { PRODUCTION_API_BASE_URL };