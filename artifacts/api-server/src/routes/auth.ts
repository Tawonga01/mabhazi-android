import crypto from "node:crypto";
import { createSupabaseAuth, type SupabaseTokens } from "../lib/supabaseAuth";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, journeysTable, authDeletionJobsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  getOrigin,
  isAllowedOrigin,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  ) {
    return "/";
  }

  try {
    const parsed = new URL(value, "https://mabhazi.invalid");
    if (parsed.origin !== "https://mabhazi.invalid") return "/";
  } catch {
    return "/";
  }

  return value;
}

function clearOidcCookies(res: Response) {
  for (const name of ["code_verifier", "nonce", "state", "return_to"]) {
    res.clearCookie(name, { path: "/" });
  }
}

function isTrustedRequestOrigin(req: Request): boolean {
  const requestOrigin = req.headers.origin;
  if (requestOrigin) {
    return isAllowedOrigin(requestOrigin) && requestOrigin === getOrigin(req);
  }

  // Browsers generally send Referer for top-level GET navigations. Checking it
  // prevents cross-site logout while still allowing native requests, which do
  // not have either browser header.
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin === getOrigin(req);
    } catch {
      return false;
    }
  }

  return true;
}

function getPostMessageOrigin(req: Request): string {
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refererOrigin)) return refererOrigin;
    } catch {
      // Fall back to the trusted API origin below.
    }
  }
  return getOrigin(req);
}

async function saveProviderSession(tokens: SupabaseTokens): Promise<string> {
  const identity = tokens.user;
  const metadata = identity.user_metadata ?? {};
  const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
  const profile = {
    id: identity.id,
    email: identity.email,
    firstName: text(metadata.given_name) ?? text(metadata.full_name),
    lastName: text(metadata.family_name),
    profileImageUrl: text(metadata.avatar_url) ?? text(metadata.picture),
  };
  return db.transaction(async tx => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity.id}))`);
  const [deletion] = await tx.select().from(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, identity.id));
  if (deletion) throw new Error("Account deletion is pending.");
  // Recheck inside the lock: deletion may have completed after code exchange.
  const verified = await createSupabaseAuth().verifyUser(tokens.access_token);
  if (verified.id !== identity.id) throw new Error("Identity mismatch.");
  const [user] = await tx.insert(usersTable).values(profile).onConflictDoUpdate({
    target: usersTable.id,
    set: { ...profile, updatedAt: new Date() },
  }).returning();
  return createSession({
    user: {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      profileImageUrl: user.profileImageUrl, displayName: user.displayName ?? null,
      lastNameChange: user.lastNameChange ?? null,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
  }, tx);
  });
}

router.get("/auth/user", (req: Request, res: Response) => {
  const u = req.isAuthenticated() ? req.user : null;
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: u
        ? {
            ...u,
            displayName: u.displayName ?? null,
            lastNameChange: u.lastNameChange ?? null,
          }
        : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  setOidcCookie(res, "code_verifier", verifier);
  setOidcCookie(res, "return_to", getSafeReturnTo(req.query.returnTo));
  res.setHeader("Cache-Control", "no-store");
  res.redirect(createSupabaseAuth().authorizeUrl(`${getOrigin(req)}/api/callback`, challenge));
});

router.get("/callback", async (req: Request, res: Response) => {
  const verifier = req.cookies?.code_verifier;
  const code = req.query.code;
  const returnTo = getSafeReturnTo(req.cookies?.return_to);
  clearOidcCookies(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (typeof verifier !== "string" || typeof code !== "string" || req.query.error) {
    res.status(400).send("Sign-in was cancelled or expired. Please start again.");
    return;
  }
  try {
    const tokens = await createSupabaseAuth().exchangeCode(code, verifier);
    setSessionCookie(res, await saveProviderSession(tokens));
    res.redirect(returnTo);
  } catch {
    res.status(401).send("Unable to complete sign-in. Please start again.");
  }
});

router.get("/auth/done", (req: Request, res: Response) => {
  const sid = req.isAuthenticated() ? getSessionId(req) : null;
  const token = sid ?? null;
  const targetOrigin = getPostMessageOrigin(req);
  res.setHeader("Content-Type", "text/html");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'",
  );
  res.send(
    `<!DOCTYPE html><html><body><script>` +
    `if(window.opener){window.opener.postMessage({type:'auth',token:${JSON.stringify(token)}},${JSON.stringify(targetOrigin)});}` +
    `window.close();` +
    `</script></body></html>`,
  );
});

router.get("/logout", async (req: Request, res: Response) => {
  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await clearSession(res, getSessionId(req));
  res.redirect(getSafeReturnTo(req.query.returnTo));
});

router.post("/mobile-auth/start", (req: Request, res: Response) => {
  const challenge = req.body?.code_challenge;
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    res.status(400).json({ error: "Invalid sign-in request" });
    return;
  }
  // Only the registered application callback is accepted, never client input.
  res.setHeader("Cache-Control", "no-store");
  res.json({ url: createSupabaseAuth().authorizeUrl("mabhazicom://auth/callback", challenge) });
});

router.post("/mobile-auth/token-exchange", async (req: Request, res: Response) => {
  const code = req.body?.code;
  const verifier = req.body?.code_verifier;
  if (typeof code !== "string" || typeof verifier !== "string") {
    res.status(400).json({ error: "Invalid sign-in request" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const tokens = await createSupabaseAuth().exchangeCode(code, verifier);
    res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: await saveProviderSession(tokens) }));
  } catch {
    res.status(401).json({ error: "Sign-in failed or expired. Please try again." });
  }
});

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const updateDisplayNameSchema = { minLength: 2, maxLength: 30 };

router.patch("/users/display-name", async (req: Request, res: Response) => {
  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const newName: string = (req.body?.displayName ?? "").trim();
  if (newName.length < updateDisplayNameSchema.minLength || newName.length > updateDisplayNameSchema.maxLength) {
    res.status(400).json({ error: `Display name must be ${updateDisplayNameSchema.minLength}–${updateDisplayNameSchema.maxLength} characters` });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (dbUser.lastNameChange) {
    const elapsed = Date.now() - new Date(dbUser.lastNameChange).getTime();
    if (elapsed < THIRTY_DAYS_MS) {
      const nextChangeAvailable = new Date(new Date(dbUser.lastNameChange).getTime() + THIRTY_DAYS_MS).toISOString();
      res.status(429).json({ error: "You can only change your display name once every 30 days", nextChangeAvailable });
      return;
    }
  }

  const now = new Date();
  const [updated] = await db
    .update(usersTable)
    .set({ displayName: newName, lastNameChange: now, updatedAt: now })
    .where(eq(usersTable.id, req.user.id))
    .returning();

  // Propagate new name to all their journey contributions
  await db
    .update(journeysTable)
    .set({ contributorName: newName })
    .where(eq(journeysTable.contributedBy, req.user.id));

  // Update the live session so req.user reflects the change immediately
  const sid = getSessionId(req);
  if (sid) {
    const session = await getSession(sid);
    if (session) {
      session.user.displayName = newName;
      session.user.lastNameChange = now;
      await updateSession(sid, session);
    }
  }

  const nextChangeAvailable = new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();
  res.json({
    displayName: updated.displayName!,
    lastNameChange: now.toISOString(),
    nextChangeAvailable,
  });
});

/**
 * Web-to-mobile token bridge.
 * After the server-side Google login flow sets a session cookie, the Expo web app
 * calls this endpoint (same-origin, so the cookie is sent) to receive the
 * session ID as a Bearer token that can be stored in expo-secure-store.
 */
router.post("/mobile-auth/session-to-token", (req: Request, res: Response) => {
  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!req.isAuthenticated()) {
    res.json({ token: null });
    return;
  }
  const sid = getSessionId(req);
  res.json({ token: sid ?? null });
});

export default router;
