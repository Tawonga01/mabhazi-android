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
  variant = process.env.EXPO_PUBLIC_APP_VARIANT || 'production',
): string {
  if (!['production','preview'].includes(variant)) throw new Error('[Mabhazi] Unknown app variant.');
  if (variant === 'preview' && !configuredValue) throw new Error('[Mabhazi] Preview API configuration is required.');
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
    if (variant === 'preview' && (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      ['api.mabhazi.com','mabhazi.com','www.mabhazi.com'].includes(url.hostname) ||
      /(^|\.)(replit\.com|replit\.dev|replit\.app|repl\.co)$/.test(url.hostname))) throw new Error('Preview requires an isolated API origin.');
    return url.origin;
  } catch (error) {
    if (variant === 'preview') throw new Error('[Mabhazi] Preview requires its own valid HTTPS API origin; production fallback is disabled.');
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

export function mobileAuthRedirectUri(variant = process.env.EXPO_PUBLIC_APP_VARIANT || 'production'): string {
  if (!['production','preview'].includes(variant)) throw new Error('[Mabhazi] Unknown app variant.');
  return variant === 'preview' ? 'mabhazipreview://auth/callback' : 'mabhazicom://auth/callback';
}
