import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const PRODUCTION_ORIGIN = "https://mabhaziv-2.replit.app";

const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;

function normalizeOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const parsed = new URL(withScheme);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const isLocalHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) return null;

    return parsed.origin;
  } catch {
    return null;
  }
}

function addConfiguredOrigins(origins: Set<string>, value: string | undefined) {
  for (const candidate of value?.split(",") ?? []) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) origins.add(normalized);
  }
}

/**
 * Origins that are allowed to use the browser API with credentials.
 *
 * The deployment origin is intentionally fixed rather than reflected from the
 * request. Replit's development domains are included only when supplied by
 * the platform environment, and local origins are limited to common dev ports.
 */
export function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>([PRODUCTION_ORIGIN]);

  addConfiguredOrigins(origins, process.env.REPLIT_DEV_DOMAIN);
  addConfiguredOrigins(origins, process.env.REPLIT_DOMAINS);
  addConfiguredOrigins(origins, process.env.REPLIT_EXPO_DEV_DOMAIN);
  addConfiguredOrigins(origins, process.env.EXPO_PUBLIC_DOMAIN);

  for (const port of [3000, 4173, 5000, 5173, 8081, 19006]) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  origins.add("http://localhost");
  origins.add("http://127.0.0.1");

  return origins;
}

export function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  return normalized !== null && getAllowedOrigins().has(normalized);
}

function getForwardedHeader(
  value: string | string[] | undefined,
): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(",")[0]?.trim();
}

/**
 * Resolve the public origin used for OIDC redirects from trusted configuration
 * or a host that is already in the explicit allowlist. Never reflect an
 * arbitrary Host/X-Forwarded-Host value into an OIDC redirect.
 */
export function getOrigin(req: Request): string {
  const host = getForwardedHeader(req.headers["x-forwarded-host"]) ?? req.headers.host;
  const isLocalHost =
    typeof host === "string" &&
    ["localhost", "127.0.0.1", "[::1]"].some(
      (localHost) =>
        host === localHost || host.startsWith(`${localHost}:`),
    );
  const proto =
    getForwardedHeader(req.headers["x-forwarded-proto"]) ??
    (isLocalHost ? "http" : "https");
  const requestOrigin = host ? normalizeOrigin(`${proto}://${host}`) : null;

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    return requestOrigin;
  }
  return PRODUCTION_ORIGIN;
}

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return SESSION_ID_PATTERN.test(token) ? token : undefined;
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === "string" && SESSION_ID_PATTERN.test(cookie)
    ? cookie
    : undefined;
}
