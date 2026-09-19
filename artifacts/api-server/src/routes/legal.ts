import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  abuseReportsTable,
  authDeletionJobsTable,
  db,
  journeyClaimsTable,
  journeyContributionsTable,
  journeyRatingsTable,
  journeyReportsTable,
  journeysTable,
  proposedAssociationsTable,
  searchEventsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import {
  clearSession,
  getSessionId,
} from "../lib/auth";
import { finishIdentityDeletion } from "../lib/identityDeletion";
import { CURRENT_TERMS_VERSION } from "../lib/terms";

const router: IRouter = Router();
const CSRF_COOKIE = "mabhazi_delete_csrf";
const CSRF_TTL_MS = 10 * 60 * 1000;
const DELETION_CONFIRMATION = "DELETE MY ACCOUNT";
type DeletionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const deletionRequestSchema = z.object({
  confirmation: z.string().optional(),
  csrfToken: z.string().optional(),
});

const termsAcceptanceSchema = z.object({
  version: z.string().trim().min(1).max(64),
});

const pageStyles = `
  :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; background: #f0f4f8; color: #0f1629; line-height: 1.6; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { background: #1e3a5f; color: #fff; padding: 28px 20px; }
  header > div { max-width: 760px; margin: 0 auto; }
  h1 { margin: 0; font-size: 28px; line-height: 1.2; }
  h2 { color: #1e3a5f; font-size: 20px; margin: 28px 0 8px; }
  h3 { color: #1e3a5f; font-size: 16px; margin: 20px 0 4px; }
  p, li { font-size: 15px; }
  a { color: #1e3a5f; font-weight: 600; }
  nav { max-width: 760px; margin: 0 auto; padding: 14px 20px 0; }
  nav a { margin-right: 14px; font-size: 14px; }
  .card { background: #fff; border: 1px solid #d1d9e6; border-radius: 14px; padding: 20px; margin-top: 20px; }
  .warning { border-color: #fca5a5; background: #fff7f7; }
  .success { border-color: #86efac; background: #f0fdf4; }
  .muted { color: #64748b; font-size: 13px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  input[type=text] { box-sizing: border-box; width: 100%; border: 1px solid #aebdce; border-radius: 8px; padding: 12px; font: inherit; }
  button { border: 0; border-radius: 8px; padding: 12px 18px; background: #ef4444; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  footer { color: #64748b; font-size: 13px; margin-top: 36px; }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Mabhazi</title>
    <style>${pageStyles}</style>
  </head>
  <body>
    <header><div><strong>Mabhazi</strong><h1>${escapeHtml(title)}</h1></div></header>
    <nav aria-label="Mabhazi legal navigation">
      <a href="/api/privacy">Privacy</a>
      <a href="/api/terms">Terms</a>
      <a href="/api/support">Support</a>
      <a href="/api/delete-account">Delete account</a>
    </nav>
    <main>${body}<footer>Mabhazi is operated by Tawonga Tsokodayi. Contact <a href="mailto:tawongatsokodayi@gmail.com">tawongatsokodayi@gmail.com</a>.</footer></main>
  </body>
</html>`;
}

function sendHtml(res: Response, title: string, body: string): void {
  res.type("html").send(htmlPage(title, body));
}

const privacyBody = `
  <p>This notice explains how Mabhazi uses information in its app and API. Mabhazi is separate from the Replit account that you may use to sign in.</p>
  <h2>Operator and contact</h2>
  <p>Mabhazi is operated by <strong>Tawonga Tsokodayi</strong>. For privacy, account, or safety questions, email <a href="mailto:tawongatsokodayi@gmail.com">tawongatsokodayi@gmail.com</a>.</p>
  <h2>Identity, hosting, and sign-in</h2>
  <p>Mabhazi is hosted on Replit and uses Replit Auth through OpenID Connect (OIDC) for sign-in. Replit supplies sign-in claims such as an account identifier, email address, name, and profile-image URL when available. Mabhazi creates and maintains a separate Mabhazi account record from those claims; deleting a Mabhazi account does not delete the separate Replit account.</p>
  <h2>Information Mabhazi uses</h2>
  <ul>
    <li><strong>Account and profile data:</strong> the Mabhazi account identifier, email, first and last name, profile-image URL supplied by sign-in, chosen display-name changes, and account timestamps. An account is needed for sign-in, contributions, ratings, and reports; searching can be used without signing in.</li>
    <li><strong>Session and authentication data:</strong> generated session identifiers, sign-in state, OAuth access or refresh tokens, and token or session expiry. These are credentials used to authenticate requests and are not public community content.</li>
    <li><strong>Community submissions:</strong> routes, route stops, ratings, confirmations, corrections or claims, trip observations, comments, prices, delays, and other information you submit. The route and community features use this information to show and improve route information.</li>
    <li><strong>Search events:</strong> a search may record its departure city, destination city, day filter, result count, and timestamp. When you are signed in, the event can be linked to your Mabhazi user ID; anonymous searches have no user ID.</li>
    <li><strong>Abuse reports:</strong> a report records the signed-in reporter, target type (route, comment, or user), target identifier, one of the available reasons (sexual content, violent content, harassment, hate speech, spam, personal information, misleading content, or other), optional details, and moderation status. Moderators may add notes, reviewer information, and review timestamps so that reports can be acted on.</li>
    <li><strong>Operational information:</strong> the API may record a request identifier, HTTP method, path without the query string, response status, and error information needed to operate and secure the service. Do not put passwords, tokens, or unnecessary personal information in a route, comment, report, or support email.</li>
    <li><strong>On-device block settings:</strong> when you block a contributor, the mobile app stores that contributor's identifier, displayed name, and the time of the block in local app storage. The block list is a device preference; it is not uploaded to the Mabhazi API.</li>
  </ul>
  <h2>What is public and what is shared</h2>
  <p>Route details, stops, ratings and route observations, comments, and the contributor display name can be shown to other Mabhazi users. A public comment is shown with its author display name (or the available sign-in name); do not treat a comment as private. The route API can also expose a contributor identifier to support route attribution, reporting, and blocking; it is not an email address or credential. Your email address, profile-image URL, session credentials, signed-in search link, and abuse-report details are not intended to be public community content. Abuse reports are shared with the operator and moderators who need them to review safety issues, and may be retained as moderation records.</p>
  <p>Replit processes information as the Mabhazi hosting and authentication provider, and the PostgreSQL application database is part of the deployed service. The current Mabhazi application has no advertising SDK or third-party analytics integration. Mabhazi does not sell personal information. Mabhazi does not share private account information for advertising. Public community submissions are shared because that is the purpose of the community route service.</p>
  <h2>Security</h2>
  <p>API traffic is sent over HTTPS/TLS. Browser sessions use Secure, HttpOnly, SameSite cookies, and native mobile session tokens are stored with the operating system-backed <code>expo-secure-store</code>; the web version uses browser local storage because that native store is unavailable on web. Server-side sessions and OAuth token material are kept in the application's session store. These measures reduce risk but no online service or storage system can guarantee absolute security.</p>
  <h2>Retention</h2>
  <p>We retain active account and community records while they are needed to provide the service and its safety features. Mabhazi sessions are configured to expire after seven days and expired sessions are removed when encountered. There is no fixed public deletion interval currently configured for search events, moderation records, or operational logs; they may be retained as needed for operation, security, abuse review, and legal obligations. If the hosting environment creates operational backups, limited copies may persist until that provider's ordinary backup lifecycle expires. We do not promise a fixed backup or log-retention period.</p>
  <h2>Account deletion</h2>
  <p>Use <a href="/api/delete-account">Delete account</a> while signed in, or email <a href="mailto:tawongatsokodayi@gmail.com">tawongatsokodayi@gmail.com</a> if you cannot sign in. The deletion transaction removes your Mabhazi user record, all Mabhazi sessions, signed-in search events, ratings, route reports and comments, claims or corrections, contributions, and abuse reports that you filed. A shared route may remain when it is useful to the community, but its contributor link and contributor name are removed and shown as Anonymous. Moderation references to a deleted account can remain only in de-identified audit form. Deletion does not delete the separate Replit account, the on-device block list, or copies that may already exist in operational logs or backups.</p>
  <h2>Your choices and privacy requests</h2>
  <p>Depending on where you live, you may have rights to request access to, correction of, deletion of, restriction of, or a copy of your personal information, or to object to a use. Email <a href="mailto:tawongatsokodayi@gmail.com">tawongatsokodayi@gmail.com</a> with the request and enough information for us to verify the Mabhazi account, without sending a password or session token. You can edit your display name where the app provides that control, delete your account at any time through the deletion page, and unblock a contributor from the app's blocked-contributor settings.</p>
  <h2>Community safety</h2>
  <p>Mabhazi provides in-app reporting for routes, comments, and users and a device-level block control. Reports are reviewed through the moderation tools available to the service and content may be removed or hidden. We continue to review reports and improve moderation, but review can take time and cannot guarantee that every inaccurate or objectionable submission is identified. Do not submit sensitive personal information in public content or an abuse report unless it is necessary to explain the safety issue.</p>
`;

const termsBody = `
  <p><strong>Version ${CURRENT_TERMS_VERSION}</strong></p>
  <p>These terms apply to your use of Mabhazi, a community bus-route information service.</p>
  <h2>Use of the service</h2>
  <p>Use Mabhazi lawfully, honestly, and respectfully. Do not interfere with the service, evade safety controls, impersonate another person, or use another person's account. Route information is community supplied and may be out of date or incorrect; verify important travel details with the operator.</p>
  <h2>Community contributions</h2>
  <p>Before submitting a route, rating, report, correction, confirmation, or comment, agree to these terms and provide information you reasonably believe is accurate. Contributions can be visible to the public, including the contributor display name and a comment author name. Do not include passwords, session tokens, or unnecessary personal information.</p>
  <h2>Prohibited content and conduct</h2>
  <p>You must not submit, request, promote, or use Mabhazi for <strong>harassment or bullying, hate speech, threats or violence, sexual exploitation or child sexual abuse, illegal content or activity, spam or repetitive abuse, fraud or deception, impersonation, or another person's personal data</strong>. Do not use public content or reports to dox, intimidate, exploit, or target someone. Content that is misleading, sexually explicit, dangerous, or otherwise objectionable may also be removed.</p>
  <h2>Reporting, blocking, and ongoing moderation</h2>
  <p>Use <strong>Report content</strong> for a route or comment, <strong>Report user</strong> for an account, and <strong>Block user</strong> to hide a contributor's community activity on your device where those controls are available. Abuse and safety reports remain available to authenticated users even if they have not accepted the current community-contribution terms, so a safety concern is never blocked by this acceptance gate. Mabhazi maintains ongoing moderation: reports are reviewed with the tools available to the operator, and content may be removed or hidden and accounts may lose access. Reports do not guarantee a particular outcome or response, and no moderation system is instant or perfect.</p>
  <h2>Availability and route accuracy</h2>
  <p>Mabhazi is a community information tool. Service availability, route accuracy, and the completeness of moderation cannot be guaranteed. Nothing in these terms changes your rights under applicable law.</p>
  <h2>Account deletion</h2>
  <p>You can delete your Mabhazi account through the public <a href="/api/delete-account">Delete account</a> page or ask support for help. Account deletion removes account-linked Mabhazi records as described in the <a href="/api/privacy">Privacy notice</a>; shared routes may remain only without your account attribution. Deleting Mabhazi does not delete your separate Replit account.</p>
`;

const supportBody = `
  <p>Need help with Mabhazi? Email <a href="mailto:tawongatsokodayi@gmail.com">tawongatsokodayi@gmail.com</a>.</p>
  <h2>Safety and community reports</h2>
  <p>Use <strong>Report content</strong> for a comment, route detail, or other submission; use <strong>Report user</strong> for an account; and use <strong>Block user</strong> to stop seeing a person's community activity on your device where that control is available. Reports can identify a route, comment, or user and include a reason such as harassment, hate speech, violence, sexual content, spam, personal information, misleading content, or other. Include the route or profile link and a short explanation. Do not include passwords, session tokens, or unnecessary personal information.</p>
  <h2>Account deletion support</h2>
  <p>You can delete your Mabhazi account at <a href="/api/delete-account">/api/delete-account</a> after signing in. This removes Mabhazi sessions, searches linked to your account, ratings, route reports and comments, corrections, contributions, and abuse reports that you filed. Shared route records may remain only anonymized. Your separate Replit account and your device's local block list are unaffected. Contact support without sending a password or session token if you cannot sign in.</p>
  <h2>Moderation</h2>
  <p>Mabhazi reviews safety reports through its available moderation tools and may remove or hide objectionable routes, comments, or contributor activity. Reports are not guaranteed to receive an individual response, and no moderation system catches every inaccurate or objectionable submission immediately.</p>
`;

function hasJsonResponse(req: Request): boolean {
  return req.accepts(["json", "html"]) === "json";
}

router.get("/privacy", (req: Request, res: Response) => {
  if (hasJsonResponse(req)) {
    res.json({
      title: "Mabhazi Privacy Notice",
      operator: "Tawonga Tsokodayi",
      contactEmail: "tawongatsokodayi@gmail.com",
      country: null,
       content: "Mabhazi collects account, session, community contribution, abuse-report, and search analytics data as described on the public privacy page. Account deletion removes reports submitted by the account; a minimal moderation record may remain when the account was the report target.",
    });
    return;
  }
  sendHtml(res, "Privacy notice", privacyBody);
});

router.get("/terms", (req: Request, res: Response) => {
  if (hasJsonResponse(req)) {
    res.json({
      title: "Mabhazi Terms",
      version: CURRENT_TERMS_VERSION,
      operator: "Tawonga Tsokodayi",
      contactEmail: "tawongatsokodayi@gmail.com",
      content: "Mabhazi is a community bus-route information service. Contributions may be public and may be moderated, but moderation and route accuracy are not guaranteed.",
    });
    return;
  }
  sendHtml(res, "Terms of use", termsBody);
});

router.get("/terms/status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.json({
      currentVersion: CURRENT_TERMS_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      requiresAcceptance: true,
    });
    return;
  }

  const [user] = await db
    .select({
      termsAcceptedVersion: usersTable.termsAcceptedVersion,
      termsAcceptedAt: usersTable.termsAcceptedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));

  const accepted = user?.termsAcceptedVersion === CURRENT_TERMS_VERSION;
  res.json({
    currentVersion: CURRENT_TERMS_VERSION,
    acceptedVersion: user?.termsAcceptedVersion ?? null,
    acceptedAt: user?.termsAcceptedAt?.toISOString() ?? null,
    requiresAcceptance: !accepted,
  });
});

router.post("/terms/accept", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = termsAcceptanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A terms version is required" });
    return;
  }

  if (parsed.data.version !== CURRENT_TERMS_VERSION) {
    res.status(409).json({
      error: "That terms version is no longer current. Review and accept the current Terms.",
      code: "TERMS_VERSION_OUTDATED",
      currentVersion: CURRENT_TERMS_VERSION,
    });
    return;
  }

  const acceptedAt = new Date();
  const [updated] = await db
    .update(usersTable)
    .set({
      termsAcceptedVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: acceptedAt,
      updatedAt: acceptedAt,
    })
    .where(eq(usersTable.id, req.user.id))
    .returning({
      termsAcceptedVersion: usersTable.termsAcceptedVersion,
      termsAcceptedAt: usersTable.termsAcceptedAt,
    });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    currentVersion: CURRENT_TERMS_VERSION,
    acceptedVersion: updated.termsAcceptedVersion,
    acceptedAt: updated.termsAcceptedAt?.toISOString() ?? null,
    requiresAcceptance: false,
  });
});

router.get("/support", (req: Request, res: Response) => {
  if (hasJsonResponse(req)) {
    res.json({
      title: "Mabhazi Support",
      operator: "Tawonga Tsokodayi",
      contactEmail: "tawongatsokodayi@gmail.com",
      reportContent: true,
      reportUsers: true,
      blockUsers: true,
    });
    return;
  }
  sendHtml(res, "Support", supportBody);
});

function issueCsrfToken(res: Response): string {
  const token = crypto.randomBytes(32).toString("base64url");
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/api/delete-account",
    maxAge: CSRF_TTL_MS,
  });
  return token;
}

function csrfMatches(req: Request, submittedToken: string | undefined): boolean {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  if (!cookieToken || !submittedToken) return false;
  const cookieBuffer = Buffer.from(cookieToken);
  const submittedBuffer = Buffer.from(submittedToken);
  return (
    cookieBuffer.length === submittedBuffer.length &&
    crypto.timingSafeEqual(cookieBuffer, submittedBuffer)
  );
}

function isBearerRequest(req: Request): boolean {
  return typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ");
}

/**
 * Delete account-linked records in one transaction.
 *
 * Shared route rows are intentionally retained as anonymized community data.
 * All user-owned records and all account/session references are removed before
 * the user row is deleted so the user foreign keys cannot leave leftovers.
 * A moderation record submitted by another person about this account is kept
 * only as a minimized audit record: its target identifier is replaced and
 * free-text fields are cleared so account-linked PII is not retained.
 */
export async function deleteMabhaziAccountInTransaction(
  tx: DeletionTransaction,
  userId: string,
): Promise<void> {
  await tx
    .delete(journeyRatingsTable)
    .where(eq(journeyRatingsTable.userId, userId));
  await tx
    .delete(journeyReportsTable)
    .where(eq(journeyReportsTable.userId, userId));
  await tx
    .delete(journeyClaimsTable)
    .where(eq(journeyClaimsTable.userId, userId));
  await tx
    .delete(journeyContributionsTable)
    .where(eq(journeyContributionsTable.contributorId, userId));
  await tx
    .delete(searchEventsTable)
    .where(eq(searchEventsTable.userId, userId));
  await tx
    .delete(abuseReportsTable)
    .where(eq(abuseReportsTable.reporterId, userId));

  // A report about a shared route can outlive the route contributor. Keep its
  // moderation reason and references, but clear free text that could repeat
  // the deleted contributor's identity.
  await tx
    .update(abuseReportsTable)
    .set({ details: null, moderatorNotes: null })
    .where(
      sql`EXISTS (
        SELECT 1
        FROM ${journeysTable}
        WHERE ${journeysTable.id} = ${abuseReportsTable.journeyId}
          AND ${journeysTable.contributedBy} = ${userId}
      )`,
    );

  // Keep shared route information but remove its account attribution.
  await tx
    .update(journeysTable)
    .set({ contributedBy: null, contributorName: "Anonymous" })
    .where(eq(journeysTable.contributedBy, userId));
  await tx
    .update(proposedAssociationsTable)
    .set({ resolvedBy: null })
    .where(eq(proposedAssociationsTable.resolvedBy, userId));
  await tx
    .update(abuseReportsTable)
    .set({ reviewedBy: null })
    .where(eq(abuseReportsTable.reviewedBy, userId));
  await tx
    .update(abuseReportsTable)
    .set({
      targetId: "deleted-user",
      details: null,
      moderatorNotes: null,
    })
    .where(
      and(
        eq(abuseReportsTable.targetType, "user"),
        eq(abuseReportsTable.targetId, userId),
      ),
    );

  // Sessions store the authenticated user in sess.user.id. Delete every
  // session, not only the browser/mobile session making this request.
  await tx.delete(sessionsTable).where(
    sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`,
  );
  await tx.delete(usersTable).where(eq(usersTable.id, userId));
}

export async function deleteMabhaziAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.insert(authDeletionJobsTable).values({ userId }).onConflictDoNothing();
    await deleteMabhaziAccountInTransaction(tx, userId);
  });
}

function deleteAccountForm(csrfToken: string): string {
  return `
    <div class="card warning">
      <h2>Permanently delete your Mabhazi account</h2>
  <p>This action cannot be undone. It deletes your Mabhazi account, all Mabhazi sessions, signed-in search events, ratings, reports you submitted, corrections, and contributions.</p>
  <p>Shared route information can remain for other travelers only after your contributor link and name are removed. Reports submitted by you are deleted; a minimal moderation record may remain when your account was the report target. Your separate Replit account is not deleted.</p>
      <form method="post" action="/api/delete-account">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <label for="confirmation">Type <code>${DELETION_CONFIRMATION}</code> to confirm</label>
        <input id="confirmation" name="confirmation" type="text" autocomplete="off" required>
        <p class="muted">The confirmation token protects this action from cross-site form submissions.</p>
        <button type="submit">Delete my Mabhazi account</button>
      </form>
    </div>
  `;
}

router.get("/delete-account", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.isAuthenticated()) {
    sendHtml(
      res,
      "Delete account",
      `<div class="card"><h2>Sign in required</h2><p>Sign in to permanently delete your Mabhazi account and account-linked data.</p><p><a href="/api/login?returnTo=%2Fapi%2Fdelete-account">Sign in to continue</a></p></div>`,
    );
    return;
  }

  const csrfToken = issueCsrfToken(res);
  sendHtml(
    res,
    "Delete account",
    deleteAccountForm(csrfToken),
  );
});

router.post("/delete-account", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in is required to delete your Mabhazi account" });
    return;
  }

  const parsed = deletionRequestSchema.safeParse(req.body);
  const confirmation = parsed.success ? parsed.data.confirmation?.trim() : undefined;
  if (confirmation !== DELETION_CONFIRMATION) {
    res.status(400).json({
      error: `Type ${DELETION_CONFIRMATION} to confirm permanent deletion`,
    });
    return;
  }

  // Browser-cookie deletion requires a token generated by the same-origin GET
  // page. Bearer-authenticated mobile requests have no ambient cookie and are
  // protected by the explicit confirmation phrase instead.
  if (!isBearerRequest(req)) {
    const submittedCsrf = parsed.success
      ? parsed.data.csrfToken
      : undefined;
    if (!csrfMatches(req, submittedCsrf)) {
      res.status(403).json({ error: "Invalid or missing deletion confirmation token" });
      return;
    }
  }

  const sid = getSessionId(req);
  try {
    await deleteMabhaziAccount(req.user.id);
    // Local account and sessions are gone. A durable job retries provider deletion.
    await finishIdentityDeletion(req.user.id);
    await clearSession(res, sid);
    res.cookie(CSRF_COOKIE, "", {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/api/delete-account",
      maxAge: 0,
    });

    if (req.accepts(["json", "html"]) === "html") {
      sendHtml(
        res,
        "Account deleted",
         `<div class="card success"><h2>Your Mabhazi account was deleted</h2><p>Your Mabhazi account-linked data and sessions were permanently deleted. Shared route information may remain only in anonymized form. A minimal moderation record may remain when your account was the report target, with free-text details removed. Your separate Replit account is unaffected.</p></div>`,
      );
      return;
    }
    res.json({ success: true });
  } catch (error) {
    req.log.error("Mabhazi account deletion failed");
    res.status(500).json({ error: "We could not delete your account. Please try again or contact support." });
  }
});

export default router;