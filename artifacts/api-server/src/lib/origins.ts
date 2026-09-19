type Environment = Record<string, string | undefined>;

/** An origin, never a URL with a path, credentials, query, or fragment. */
export function normalizeOrigin(value: string, allowLocalHttp = false): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error("Invalid origin configuration."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !(allowLocalHttp && local && parsed.protocol === "http:")) ||
    parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
  ) throw new Error("Invalid origin configuration.");
  return parsed.origin;
}

export function getPublicOrigin(env: Environment = process.env): string {
  const value = env.PUBLIC_ORIGIN?.trim();
  if (!value) {
    if (env.NODE_ENV === "production") throw new Error("PUBLIC_ORIGIN is required.");
    return "http://localhost:5000";
  }
  return normalizeOrigin(value, env.NODE_ENV !== "production");
}

export function getAllowedOrigins(env: Environment = process.env): Set<string> {
  const allowLocal = env.NODE_ENV !== "production";
  const origins = new Set([getPublicOrigin(env)]);
  for (const value of env.ALLOWED_ORIGINS?.split(",") ?? []) {
    if (value.trim()) origins.add(normalizeOrigin(value, allowLocal));
  }
  if (allowLocal) {
    for (const host of ["localhost", "127.0.0.1"]) {
      for (const port of [3000, 4173, 5000, 5173, 8081, 19006]) {
        origins.add(`http://${host}:${port}`);
      }
    }
  }
  return origins;
}

export function isAllowedOrigin(value: string, env: Environment = process.env): boolean {
  let origin: string;
  try { origin = normalizeOrigin(value, env.NODE_ENV !== "production"); }
  catch { return false; }
  return getAllowedOrigins(env).has(origin);
}
