import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, journeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
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

function isSafeMobileRedirectUri(value: string): boolean {
  try {
    const redirectUri = new URL(value);
    if (
      redirectUri.username ||
      redirectUri.password ||
      redirectUri.hash ||
      redirectUri.search
    ) {
      return false;
    }

    if (redirectUri.protocol === "https:") {
      return isAllowedOrigin(redirectUri.origin);
    }
    if (redirectUri.protocol === "http:") {
      return ["localhost", "127.0.0.1", "[::1]"].includes(
        redirectUri.hostname,
      );
    }

    // Expo Go and standalone builds use these registered native schemes.
    return ["exp:", "exps:", "mabhazicom:"].includes(redirectUri.protocol);
  } catch {
    return false;
  }
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      // Never overwrite displayName or lastNameChange — user controls those
      set: {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
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
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !nonce || !expectedState) {
    clearOidcCookies(res);
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(callbackUrl);
  currentUrl.search = new URL(req.originalUrl || req.url, callbackUrl).search;

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    clearOidcCookies(res);
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  clearOidcCookies(res);

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      displayName: dbUser.displayName ?? null,
      lastNameChange: dbUser.lastNameChange ?? null,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
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

  const config = await getOidcConfig();
  const origin = getOrigin(req);
  const returnTo = getSafeReturnTo(req.query.returnTo);

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: new URL(returnTo, origin).href,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.nonce) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    if (!isSafeMobileRedirectUri(redirect_uri)) {
      res.status(400).json({ error: "Invalid redirect URI" });
      return;
    }

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          displayName: dbUser.displayName ?? null,
          lastNameChange: dbUser.lastNameChange ?? null,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch {
      // Do not log OIDC errors: providers may include authorization codes,
      // redirect URIs, or token material in their error details.
      req.log.error("Mobile token exchange failed");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

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
 * After the standard web OIDC flow sets a session cookie, the Expo web app
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
