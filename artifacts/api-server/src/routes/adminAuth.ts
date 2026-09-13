import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Admin sessions are intentionally stateless.  The token contains only an
 * expiry and a nonce, and both are authenticated with the server-held admin
 * secret. Tokens expire on their own and changing the configured secret
 * invalidates existing tokens; no secret is sent to the browser.
 */
export const ADMIN_SESSION_COOKIE = "mabhazi_admin_session";
export const ADMIN_SESSION_TTL_MS = 15 * 60 * 1000;

const SESSION_TOKEN_MAX_LENGTH = 512;

/**
 * Compare arbitrary input without an early return based on its length.
 *
 * Hashing both values first gives timingSafeEqual fixed-size inputs while
 * still making a missing or malformed credential fail closed.
 */
export function adminSecretsMatch(
  provided: unknown,
  expected: unknown,
): boolean {
  const providedValue = typeof provided === "string" ? provided : "";
  const expectedValue = typeof expected === "string" ? expected : "";
  const providedDigest = createHash("sha256").update(providedValue).digest();
  const expectedDigest = createHash("sha256").update(expectedValue).digest();
  return timingSafeEqual(providedDigest, expectedDigest) &&
    providedValue.length > 0 &&
    expectedValue.length > 0;
}

function sign(value: string, serverSecret: string): string {
  return createHmac("sha256", serverSecret).update(value).digest("base64url");
}

export function createSignedAdminSession(
  serverSecret: string,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now) + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(
    `${expiresAt}.${randomBytes(32).toString("base64url")}`,
  ).toString("base64url");
  return `${payload}.${sign(payload, serverSecret)}`;
}

export function verifySignedAdminSession(
  token: unknown,
  serverSecret: string,
  now = Date.now(),
): boolean {
  if (
    typeof token !== "string" ||
    token.length > SESSION_TOKEN_MAX_LENGTH ||
    !serverSecret
  ) {
    return false;
  }

  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) return false;

  const payload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  if (!payload || !providedSignature) return false;

  const expectedSignature = sign(payload, serverSecret);
  const providedBuffer = Buffer.from(providedSignature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return false;
  }

  let decodedPayload: string;
  try {
    decodedPayload = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expirySeparator = decodedPayload.indexOf(".");
  if (expirySeparator <= 0) return false;
  const expiresAt = Number(decodedPayload.slice(0, expirySeparator));
  if (!Number.isSafeInteger(expiresAt)) return false;
  return expiresAt > now;
}