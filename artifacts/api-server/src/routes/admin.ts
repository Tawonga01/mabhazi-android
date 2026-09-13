import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  db,
  searchEventsTable,
  journeysTable,
  journeyRatingsTable,
  journeyReportsTable,
  abuseReportsTable,
  usersTable,
  busCompaniesTable,
} from "@workspace/db";
import { count, desc, eq, and, gte, isNotNull, avg, sql, asc } from "drizzle-orm";
import { getOrigin, isAllowedOrigin } from "../lib/auth";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  adminSecretsMatch,
  createSignedAdminSession,
  verifySignedAdminSession,
} from "./adminAuth";

const router: IRouter = Router();

type AdminAuthMethod = "session" | "header";
type AdminRequest = Request & { adminAuthMethod?: AdminAuthMethod };

const REPORT_STATUSES = ["pending", "dismissed", "actioned"] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];
// Restoration is intentionally unavailable: the schema does not retain
// provenance for independently moderated content.
const MODERATION_ACTIONS = [
  "dismiss",
  "remove_content",
  "remove_route",
  "hide_user",
] as const;
type ModerationAction = (typeof MODERATION_ACTIONS)[number];

function getConfiguredAdminSecret(): string | undefined {
  const secret = process.env.ADMIN_SECRET;
  return secret || undefined;
}

function getHeaderAdminSecret(req: Request): string | undefined {
  const value = req.headers["x-admin-secret"];
  return typeof value === "string" ? value : undefined;
}

function setAdminSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/admin",
    maxAge: ADMIN_SESSION_TTL_MS,
  });
}

function authenticateAdmin(req: AdminRequest): AdminAuthMethod | null {
  const serverSecret = getConfiguredAdminSecret();
  if (!serverSecret) return null;

  const session = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (verifySignedAdminSession(session, serverSecret)) {
    req.adminAuthMethod = "session";
    return "session";
  }

  // Keep the explicit header form for trusted automation. Query-string
  // credentials are intentionally not supported.
  if (adminSecretsMatch(getHeaderAdminSecret(req), serverSecret)) {
    req.adminAuthMethod = "header";
    return "header";
  }
  return null;
}

function sendAdminLogin(res: Response, status = 401): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mabhazi Admin Login</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F0F4F8}
.box{background:#fff;border-radius:16px;padding:48px;text-align:center;max-width:360px;width:calc(100% - 40px);box-shadow:0 12px 36px rgba(30,58,95,.12)}
h1{color:#1E3A5F;font-size:22px;margin:0 0 8px}p{color:#64748B;margin:0 0 24px}
input{width:100%;padding:12px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:15px;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:13px;background:#F97316;color:#fff;border:0;border-radius:10px;font-size:15px;cursor:pointer;font-weight:600}</style></head>
<body><main class="box"><h1>🚌 Mabhazi Admin</h1><p>Sign in to continue.</p>
<form method="post" action="/api/admin/login"><input name="secret" type="password" autocomplete="current-password" placeholder="Admin secret" required autofocus/>
<button type="submit">Access Dashboard</button></form></main></body></html>`);
}

function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  if (
    req.method === "GET" &&
    req.path === "/admin" &&
    Object.prototype.hasOwnProperty.call(req.query, "secret")
  ) {
    // Do not leave a legacy credential in the browser address bar. It is
    // never read for authentication and is not reflected into the response.
    res.redirect(303, "/api/admin");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(req.query, "secret")) {
    res
      .status(400)
      .json({ error: "Admin credentials must not be sent in the URL." });
    return;
  }
  if (authenticateAdmin(req)) {
    next();
    return;
  }

  if (req.method === "GET" && req.path === "/admin") {
    sendAdminLogin(res, getConfiguredAdminSecret() ? 401 : 503);
    return;
  }

  if (!getConfiguredAdminSecret()) {
    res.status(503).json({ error: "Admin access is not configured." });
    return;
  }
  res.status(401).json({ error: "Admin authentication required." });
}

function isTrustedAdminOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    return isAllowedOrigin(origin) && origin === getOrigin(req);
  }

  const referer = req.headers.referer;
  if (typeof referer === "string" && referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      return isAllowedOrigin(refererOrigin) && refererOrigin === getOrigin(req);
    } catch {
      return false;
    }
  }
  return false;
}

function requireAdminMutationOrigin(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): void {
  // An explicit custom header cannot be sent by a browser cross-site without
  // a preflight, and the API CORS policy does not allow that header. Cookie
  // sessions still require a same-origin Origin/Referer on every mutation.
  if (
    req.adminAuthMethod === "header" ||
    (req.adminAuthMethod === "session" && isTrustedAdminOrigin(req))
  ) {
    next();
    return;
  }
  res.status(403).json({ error: "Trusted admin origin required." });
}

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

function isModerationAction(value: unknown): value is ModerationAction {
  return (
    typeof value === "string" &&
    (MODERATION_ACTIONS as readonly string[]).includes(value)
  );
}

router.post("/admin/login", (req: Request, res: Response) => {
  const serverSecret = getConfiguredAdminSecret();
  const providedSecret = (req.body as { secret?: unknown } | undefined)?.secret;
  if (!serverSecret) {
    res.status(503).json({ error: "Admin access is not configured." });
    return;
  }
  if (!adminSecretsMatch(providedSecret, serverSecret)) {
    res.status(401).json({ error: "Invalid admin credentials." });
    return;
  }

  setAdminSessionCookie(res, createSignedAdminSession(serverSecret));
  if (req.accepts("html")) {
    res.redirect(303, "/api/admin");
    return;
  }
  res.json({ authenticated: true });
});

router.get("/admin", requireAdmin, (req: AdminRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html");
  res.send(buildDashboardHtml());
});

router.get(
  "/admin/stats",
  requireAdmin,
  async (_req: Request, res: Response) => {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      [{ total: totalSearches }],
      [{ total: todaySearches }],
      [{ total: zeroResultSearches }],
      volumeByDay,
      topRoutes,
      topDays,
      recentSearches,
      opportunities,
      journeyStats,
      citySummaries,
      cityDestinations,
      cityDayBreakdowns,
    ] = await Promise.all([
      db.select({ total: count() }).from(searchEventsTable),
      db
        .select({ total: count() })
        .from(searchEventsTable)
        .where(gte(searchEventsTable.createdAt, todayStart)),
      db
        .select({ total: count() })
        .from(searchEventsTable)
        .where(eq(searchEventsTable.resultsCount, 0)),
      db
        .select({
          date: sql<string>`TO_CHAR(${searchEventsTable.createdAt}::date, 'YYYY-MM-DD')`,
          total: count(),
        })
        .from(searchEventsTable)
        .where(gte(searchEventsTable.createdAt, thirtyDaysAgo))
        .groupBy(sql`${searchEventsTable.createdAt}::date`)
        .orderBy(sql`${searchEventsTable.createdAt}::date`),
      db
        .select({
          fromCity: searchEventsTable.fromCity,
          toCity: searchEventsTable.toCity,
          total: count(),
        })
        .from(searchEventsTable)
        .where(
          and(
            isNotNull(searchEventsTable.fromCity),
            isNotNull(searchEventsTable.toCity),
          ),
        )
        .groupBy(searchEventsTable.fromCity, searchEventsTable.toCity)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({
          day: searchEventsTable.day,
          total: count(),
        })
        .from(searchEventsTable)
        .where(isNotNull(searchEventsTable.day))
        .groupBy(searchEventsTable.day)
        .orderBy(desc(count()))
        .limit(7),
      db
        .select()
        .from(searchEventsTable)
        .orderBy(desc(searchEventsTable.createdAt))
        .limit(50),
      db
        .select({
          fromCity: searchEventsTable.fromCity,
          toCity: searchEventsTable.toCity,
          total: count(),
        })
        .from(searchEventsTable)
        .where(
          and(
            eq(searchEventsTable.resultsCount, 0),
            isNotNull(searchEventsTable.fromCity),
            isNotNull(searchEventsTable.toCity),
          ),
        )
        .groupBy(searchEventsTable.fromCity, searchEventsTable.toCity)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({
          totalJourneys: count(journeysTable.id),
          avgRating: avg(journeyRatingsTable.score),
          totalRatings: count(journeyRatingsTable.id),
        })
        .from(journeysTable)
        .leftJoin(
          journeyRatingsTable,
          eq(journeyRatingsTable.journeyId, journeysTable.id),
        ),
      // City summaries
      db
        .select({
          fromCity: searchEventsTable.fromCity,
          totalSearches: count(),
          zeroResults: sql<string>`SUM(CASE WHEN ${searchEventsTable.resultsCount} = 0 THEN 1 ELSE 0 END)`,
          uniqueUsers: sql<string>`COUNT(DISTINCT ${searchEventsTable.userId})`,
          lastSeen: sql<string>`MAX(${searchEventsTable.createdAt})`,
        })
        .from(searchEventsTable)
        .where(isNotNull(searchEventsTable.fromCity))
        .groupBy(searchEventsTable.fromCity)
        .orderBy(desc(count())),
      // Destinations per origin city
      db
        .select({
          fromCity: searchEventsTable.fromCity,
          toCity: searchEventsTable.toCity,
          total: count(),
        })
        .from(searchEventsTable)
        .where(
          and(
            isNotNull(searchEventsTable.fromCity),
            isNotNull(searchEventsTable.toCity),
          ),
        )
        .groupBy(searchEventsTable.fromCity, searchEventsTable.toCity)
        .orderBy(searchEventsTable.fromCity, desc(count())),
      // Day breakdown per origin city
      db
        .select({
          fromCity: searchEventsTable.fromCity,
          day: searchEventsTable.day,
          total: count(),
        })
        .from(searchEventsTable)
        .where(
          and(
            isNotNull(searchEventsTable.fromCity),
            isNotNull(searchEventsTable.day),
          ),
        )
        .groupBy(searchEventsTable.fromCity, searchEventsTable.day)
        .orderBy(searchEventsTable.fromCity, desc(count())),
    ]);

    // Build city profiles
    type CityProfile = {
      city: string;
      totalSearches: number;
      zeroResultSearches: number;
      uniqueUsers: number;
      lastSeen: string;
      topDestinations: { toCity: string; count: number }[];
      topDays: { day: string; count: number }[];
    };

    const cityMap: Record<string, CityProfile> = {};
    for (const r of citySummaries) {
      cityMap[r.fromCity!] = {
        city: r.fromCity!,
        totalSearches: Number(r.totalSearches),
        zeroResultSearches: Number(r.zeroResults),
        uniqueUsers: Number(r.uniqueUsers),
        lastSeen: r.lastSeen,
        topDestinations: [],
        topDays: [],
      };
    }
    for (const r of cityDestinations) {
      const p = cityMap[r.fromCity!];
      if (p)
        p.topDestinations.push({ toCity: r.toCity!, count: Number(r.total) });
    }
    for (const r of cityDayBreakdowns) {
      const p = cityMap[r.fromCity!];
      if (p) p.topDays.push({ day: r.day!, count: Number(r.total) });
    }

    res.json({
      overview: {
        totalSearches: Number(totalSearches),
        todaySearches: Number(todaySearches),
        zeroResultSearches: Number(zeroResultSearches),
        totalJourneys: Number(journeyStats[0].totalJourneys),
        totalRatings: Number(journeyStats[0].totalRatings),
        avgRating: journeyStats[0].avgRating
          ? parseFloat(journeyStats[0].avgRating)
          : null,
      },
      volumeByDay: volumeByDay.map((r) => ({
        date: r.date,
        count: Number(r.total),
      })),
      topRoutes: topRoutes.map((r) => ({
        fromCity: r.fromCity,
        toCity: r.toCity,
        count: Number(r.total),
      })),
      topDays: topDays.map((r) => ({ day: r.day, count: Number(r.total) })),
      recentSearches: recentSearches.map((r) => ({
        id: r.id,
        fromCity: r.fromCity,
        toCity: r.toCity,
        day: r.day,
        resultsCount: r.resultsCount,
        userId: r.userId,
        createdAt: r.createdAt.toISOString(),
      })),
      opportunities: opportunities.map((r) => ({
        fromCity: r.fromCity,
        toCity: r.toCity,
        count: Number(r.total),
      })),
      cityProfiles: Object.values(cityMap),
    });
  },
);

// GET /api/admin/journeys — list all journeys with rating counts
router.get(
  "/admin/journeys",
  requireAdmin,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        id: journeysTable.id,
        fromCity: journeysTable.fromCity,
        toCity: journeysTable.toCity,
        departureTime: journeysTable.departureTime,
        arrivalTime: journeysTable.arrivalTime,
        scheduledDays: journeysTable.scheduledDays,
        busCompany: journeysTable.busCompany,
        price: journeysTable.price,
        contributorName: journeysTable.contributorName,
        createdAt: journeysTable.createdAt,
        ratingCount: count(journeyRatingsTable.id),
        avgRating: avg(journeyRatingsTable.score),
      })
      .from(journeysTable)
      .leftJoin(journeyRatingsTable, eq(journeyRatingsTable.journeyId, journeysTable.id))
      .groupBy(journeysTable.id)
      .orderBy(desc(journeysTable.createdAt));

    res.json({
      journeys: rows.map((j) => ({
        id: j.id,
        fromCity: j.fromCity,
        toCity: j.toCity,
        departureTime: j.departureTime,
        arrivalTime: j.arrivalTime,
        scheduledDays: j.scheduledDays,
        busCompany: j.busCompany,
        price: parseFloat(j.price),
        contributorName: j.contributorName,
        createdAt: j.createdAt.toISOString(),
        ratingCount: Number(j.ratingCount),
        avgRating: j.avgRating ? parseFloat(j.avgRating) : null,
      })),
    });
  },
);

// DELETE /api/admin/journeys/:id — hard delete (cascade removes ratings)
router.delete(
  "/admin/journeys/:id",
  requireAdmin,
  requireAdminMutationOrigin,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid journey ID" });
      return;
    }
    const deleted = await db
      .delete(journeysTable)
      .where(eq(journeysTable.id, id))
      .returning({ id: journeysTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Journey not found" });
      return;
    }
    res.json({ deleted: deleted[0].id });
  },
);

// ─── UGC moderation ─────────────────────────────────────────────────────────
// Reports remain durable even after the reported route/comment is moderated.
router.get("/admin/abuse-reports", requireAdmin, async (req: Request, res: Response) => {
  const rawStatus = req.query.status;
  if (rawStatus !== undefined && typeof rawStatus !== "string") {
    res.status(400).json({ error: "Invalid report status" });
    return;
  }
  const status = rawStatus;
  if (status && !isReportStatus(status)) {
    res.status(400).json({ error: "Invalid report status" });
    return;
  }
  const reports = await db
    .select({
      id: abuseReportsTable.id,
      reporterId: abuseReportsTable.reporterId,
      targetType: abuseReportsTable.targetType,
      targetId: abuseReportsTable.targetId,
      journeyId: abuseReportsTable.journeyId,
      reason: abuseReportsTable.reason,
      details: abuseReportsTable.details,
      status: abuseReportsTable.status,
      moderatorNotes: abuseReportsTable.moderatorNotes,
      reviewedBy: abuseReportsTable.reviewedBy,
      reviewedAt: abuseReportsTable.reviewedAt,
      createdAt: abuseReportsTable.createdAt,
      reporterName: usersTable.displayName,
    })
    .from(abuseReportsTable)
    .leftJoin(usersTable, eq(usersTable.id, abuseReportsTable.reporterId))
    .where(status ? eq(abuseReportsTable.status, status) : undefined)
    .orderBy(desc(abuseReportsTable.createdAt))
    .limit(200);

  const enrichedReports = await Promise.all(
    reports.map(async (report) => {
      let targetPreview: string | null = null;
      if (report.targetType === "journey") {
        const targetId = Number(report.targetId);
        if (!Number.isSafeInteger(targetId) || targetId <= 0) {
          targetPreview = "Invalid route target";
        } else {
          const [journey] = await db
            .select({
              fromCity: journeysTable.fromCity,
              toCity: journeysTable.toCity,
              busCompany: journeysTable.busCompany,
            })
            .from(journeysTable)
            .where(eq(journeysTable.id, targetId));
          targetPreview = journey
            ? `${journey.fromCity} → ${journey.toCity} · ${journey.busCompany}`
            : "Route no longer exists";
        }
      } else if (report.targetType === "comment") {
        const targetId = Number(report.targetId);
        if (!Number.isSafeInteger(targetId) || targetId <= 0) {
          targetPreview = "Invalid comment target";
        } else {
          const [comment] = await db
            .select({ content: journeyReportsTable.content })
            .from(journeyReportsTable)
            .where(eq(journeyReportsTable.id, targetId));
          targetPreview = comment?.content ?? "Comment no longer exists";
        }
      } else if (report.targetType === "user") {
        const [user] = await db
          .select({ displayName: usersTable.displayName, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, report.targetId));
        targetPreview = user?.displayName || user?.email || "Contributor no longer exists";
      } else {
        targetPreview = "Unsupported report target";
      }

      return {
        ...report,
        targetPreview,
        createdAt: report.createdAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
      };
    }),
  );

  res.json({ reports: enrichedReports });
});

router.patch(
  "/admin/abuse-reports/:id",
  requireAdmin,
  requireAdminMutationOrigin,
  async (req: AdminRequest, res: Response) => {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const body = (req.body ?? {}) as { action?: unknown; notes?: unknown };
    if (!isModerationAction(body.action)) {
      res.status(400).json({ error: "Invalid moderation action" });
      return;
    }
    const action = body.action;

    const result = await db.transaction(async (tx) => {
      const [report] = await tx
        .select()
        .from(abuseReportsTable)
        .where(eq(abuseReportsTable.id, id));
      if (!report) return { kind: "not-found" as const };
      if (!isReportStatus(report.status)) {
        return { kind: "invalid-status" as const };
      }
      if (report.status !== "pending") return { kind: "already-reviewed" as const };

      const targetType = report.targetType;
      if (!["comment", "journey", "user"].includes(targetType)) {
        return { kind: "invalid-target" as const };
      }
      const actionMatchesTarget =
        action === "dismiss" ||
        (targetType === "comment" && action === "remove_content") ||
        (targetType === "journey" && action === "remove_route") ||
        (targetType === "user" && action === "hide_user");
      if (!actionMatchesTarget) return { kind: "incompatible-action" as const };

      if (action !== "dismiss" && targetType !== "user") {
        const targetId = Number(report.targetId);
        if (!Number.isSafeInteger(targetId) || targetId <= 0) {
          return { kind: "invalid-target" as const };
        }
        if (targetType === "comment") {
          await tx
            .update(journeyReportsTable)
            .set({ moderationStatus: "removed" })
            .where(eq(journeyReportsTable.id, targetId));
        } else {
          await tx
            .update(journeysTable)
            .set({ moderationStatus: "removed" })
            .where(eq(journeysTable.id, targetId));
        }
      } else if (action === "hide_user") {
        await tx
          .update(journeysTable)
          .set({ moderationStatus: "hidden" })
          .where(eq(journeysTable.contributedBy, report.targetId));
        await tx
          .update(journeyReportsTable)
          .set({ moderationStatus: "removed" })
          .where(eq(journeyReportsTable.userId, report.targetId));
      }

      const [updated] = await tx
        .update(abuseReportsTable)
        .set({
          status: action === "dismiss" ? "dismissed" : "actioned",
          moderatorNotes:
            typeof body.notes === "string"
              ? body.notes.trim().slice(0, 1000) || null
              : null,
          // Admin dashboard auth is a shared secret, not a users-table identity.
          reviewedBy: null,
          reviewedAt: new Date(),
        })
        .where(eq(abuseReportsTable.id, id))
        .returning({ id: abuseReportsTable.id, status: abuseReportsTable.status });

      return { kind: "updated" as const, report: updated };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Abuse report not found" });
      return;
    }
    if (result.kind === "already-reviewed") {
      res.status(409).json({ error: "Abuse report already reviewed" });
      return;
    }
    if (result.kind === "invalid-status") {
      res.status(409).json({ error: "Abuse report has an invalid status" });
      return;
    }
    if (result.kind === "incompatible-action") {
      res.status(400).json({ error: "Moderation action does not match report target" });
      return;
    }
    if (result.kind === "invalid-target") {
      res.status(400).json({ error: "Invalid report target" });
      return;
    }
    res.json({ report: result.report });
  },
);

// ─── Bus Companies CRUD ────────────────────────────────────────────────────

router.get("/admin/bus-companies", requireAdmin, async (_req: Request, res: Response) => {
  const companies = await db
    .select({ id: busCompaniesTable.id, name: busCompaniesTable.name, active: busCompaniesTable.active })
    .from(busCompaniesTable)
    .orderBy(asc(busCompaniesTable.name));
  res.json({ companies });
});

router.post(
  "/admin/bus-companies",
  requireAdmin,
  requireAdminMutationOrigin,
  async (req: Request, res: Response) => {
  const name = (req.body as { name?: string }).name?.trim();
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const [created] = await db.insert(busCompaniesTable).values({ name }).returning();
    res.json({ id: created.id, name: created.name, active: created.active });
  } catch {
    res.status(409).json({ error: "A company with this name already exists" });
  }
});

router.patch(
  "/admin/bus-companies/:id",
  requireAdmin,
  requireAdminMutationOrigin,
  async (req: Request, res: Response) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = req.body as { name?: string; active?: boolean };
  const updates: { name?: string; active?: boolean } = {};
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.active === "boolean") updates.active = body.active;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [updated] = await db.update(busCompaniesTable).set(updates).where(eq(busCompaniesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: updated.id, name: updated.name, active: updated.active });
});

router.delete(
  "/admin/bus-companies/:id",
  requireAdmin,
  requireAdminMutationOrigin,
  async (req: Request, res: Response) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const deleted = await db.delete(busCompaniesTable).where(eq(busCompaniesTable.id, id)).returning({ id: busCompaniesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ deleted: deleted[0].id });
});

function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mabhazi Admin Analytics</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#F0F4F8;color:#1E293B;min-height:100vh}
.topbar{background:#1E3A5F;padding:16px 32px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.topbar h1{color:#fff;font-size:20px;font-weight:700}
.badge{background:#F97316;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px}
.content{padding:28px 32px;max-width:1400px;margin:0 auto}
.section-title{font-size:13px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.8px;margin-bottom:16px;margin-top:32px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:8px}
.card{background:#fff;border-radius:16px;padding:20px;border:1px solid #E2E8F0}
.card .num{font-size:32px;font-weight:700;color:#1E3A5F}
.card .lbl{font-size:13px;color:#64748B;margin-top:4px}
.card.accent .num{color:#F97316}
.card.green .num{color:#22C55E}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:4px}
.chart-box{background:#fff;border-radius:16px;padding:20px;border:1px solid #E2E8F0}
.chart-box.full{grid-column:1/-1}
.chart-box h3{font-size:14px;font-weight:600;color:#1E293B;margin-bottom:16px}
canvas{max-height:260px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0}
th{background:#F8FAFC;font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.5px;padding:12px 16px;text-align:left;border-bottom:1px solid #E2E8F0}
td{font-size:13px;color:#1E293B;padding:11px 16px;border-bottom:1px solid #F1F5F9}
tr:last-child td{border-bottom:none}
tr:hover td{background:#F8FAFC}
.pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600}
.pill.ok{background:#DCFCE7;color:#16A34A}
.pill.zero{background:#FEE2E2;color:#DC2626}
.pill.partial{background:#FEF9C3;color:#CA8A04}
.pill.day{background:#EFF6FF;color:#1D4ED8}
.loading{color:#94A3B8;font-style:italic;font-size:14px;padding:48px;text-align:center}
.ts{color:#94A3B8;font-size:12px}

/* City profiles */
.city-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.city-card{background:#fff;border-radius:16px;border:1px solid #E2E8F0;overflow:hidden;transition:box-shadow .15s}
.city-card:hover{box-shadow:0 4px 20px rgba(30,58,95,.10)}
.city-card-header{background:#1E3A5F;padding:16px 20px;display:flex;align-items:center;justify-content:space-between}
.city-card-name{color:#fff;font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}
.city-card-total{color:rgba(255,255,255,.7);font-size:13px}
.city-card-body{padding:16px 20px;display:flex;flex-direction:column;gap:14px}
.result-bar-wrap{display:flex;flex-direction:column;gap:4px}
.result-bar-label{display:flex;justify-content:space-between;font-size:12px;color:#64748B}
.result-bar{height:7px;background:#F1F5F9;border-radius:4px;overflow:hidden}
.result-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#22C55E,#16A34A);transition:width .4s}
.city-section-label{font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
.dest-rows{display:flex;flex-direction:column;gap:4px}
.dest-row{display:flex;align-items:center;gap:8px;font-size:13px}
.dest-bar-wrap{flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}
.dest-bar-fill{height:100%;border-radius:3px;background:#F97316CC}
.dest-city{width:110px;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dest-count{color:#94A3B8;font-size:12px;min-width:28px;text-align:right}
.days-pills{display:flex;flex-wrap:wrap;gap:6px}
.city-stats-row{display:flex;gap:16px}
.city-stat{display:flex;flex-direction:column;align-items:center;background:#F8FAFC;border-radius:10px;padding:10px 16px;flex:1}
.city-stat-num{font-size:20px;font-weight:700;color:#1E3A5F}
.city-stat-lbl{font-size:11px;color:#94A3B8;margin-top:2px}
.city-stat-num.accent{color:#F97316}
.city-stat-num.green{color:#22C55E}
.no-cities{color:#94A3B8;font-style:italic;text-align:center;padding:40px}

@media(max-width:768px){.charts{grid-template-columns:1fr}.content{padding:16px}.cards{grid-template-columns:1fr 1fr}.city-grid{grid-template-columns:1fr}}

/* Tab navigation */
.tab-nav{display:flex;gap:4px;margin-left:20px}
.tab-btn{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.75);border:none;border-radius:10px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,color .15s;font-family:'Inter',sans-serif}
.tab-btn:hover{background:rgba(255,255,255,0.2);color:#fff}
.tab-btn.active{background:#F97316;color:#fff}

/* Routes table delete button */
.del-btn{padding:5px 14px;background:#FEF2F2;color:#DC2626;border:1.5px solid #FECACA;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:background .12s}
.del-btn:hover{background:#DC2626;color:#fff;border-color:#DC2626}
.del-btn:disabled{opacity:0.4;cursor:not-allowed}
.route-tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:#EFF6FF;color:#1D4ED8}
</style>
</head>
<body>
<div class="topbar">
  <h1>🚌 Mabhazi Admin</h1>
  <nav class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('analytics')">Analytics</button>
    <button class="tab-btn" onclick="switchTab('routes')">Manage Routes</button>
    <button class="tab-btn" onclick="switchTab('moderation')">UGC Reports</button>
    <button class="tab-btn" onclick="switchTab('companies')">Bus Companies</button>
  </nav>
  <span style="margin-left:auto;color:rgba(255,255,255,0.5);font-size:12px" id="last-updated"></span>
</div>

<!-- Delete confirmation modal -->
<div id="modal-backdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:20px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2)">
    <div style="font-size:32px;text-align:center;margin-bottom:12px">🗑️</div>
    <h2 style="font-size:20px;font-weight:700;color:#1E3A5F;text-align:center;margin-bottom:8px">Delete this route?</h2>
    <p style="font-size:14px;color:#64748B;text-align:center;line-height:1.6;margin-bottom:8px" id="modal-route-desc"></p>
    <p style="font-size:13px;color:#DC2626;text-align:center;margin-bottom:24px">This permanently removes the route and all its ratings. It cannot be undone.</p>
    <div style="display:flex;gap:12px">
      <button onclick="closeModal()" style="flex:1;padding:13px;background:#F1F5F9;border:none;border-radius:12px;font-size:15px;font-weight:600;color:#475569;cursor:pointer">Cancel</button>
      <button id="modal-confirm-btn" style="flex:1;padding:13px;background:#DC2626;border:none;border-radius:12px;font-size:15px;font-weight:600;color:#fff;cursor:pointer">Delete</button>
    </div>
  </div>
</div>

<div id="tab-analytics" class="content">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <div class="section-title" style="margin:0">Overview</div>
    <button onclick="load()" style="padding:8px 18px;background:#1E3A5F;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">↻ Refresh</button>
  </div>
  <div class="cards" id="cards"><div class="loading">Loading…</div></div>

  <div class="section-title">Search Volume — Last 30 Days</div>
  <div class="chart-box full"><h3>Search Volume (Last 14 Days)</h3><div id="volumeChart" class="css-chart bar-chart-v"></div></div>

  <div class="section-title">Top Searched Routes &amp; Day Breakdown</div>
  <div class="charts">
    <div class="chart-box"><h3>Top 10 Routes Searched</h3><div id="routesChart" class="css-chart bar-chart-h"></div></div>
    <div class="chart-box"><h3>Searches by Day of Week</h3><div id="daysChart" class="css-chart bar-chart-v"></div></div>
  </div>

  <div class="section-title">City Origin Profiles <span style="font-size:11px;color:#94A3B8;font-weight:400;letter-spacing:0;text-transform:none;margin-left:8px">— search intent &amp; demand by departure city</span></div>
  <div class="city-grid" id="cityGrid"><div class="loading">Loading…</div></div>

  <div class="section-title">Opportunity Routes <span style="font-size:11px;color:#F97316;font-style:normal;margin-left:8px">(zero-result searches — routes the community needs)</span></div>
  <table id="oppTable"><tr><td class="loading">Loading…</td></tr></table>

  <div class="section-title">Recent Searches</div>
  <table id="recentTable"><tr><td class="loading">Loading…</td></tr></table>
</div>

<div id="tab-routes" class="content" style="display:none">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <div class="section-title" style="margin:0">All Routes in Database</div>
    <button onclick="loadRoutes()" style="padding:8px 18px;background:#1E3A5F;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">↻ Refresh</button>
  </div>
  <p style="font-size:13px;color:#94A3B8;margin-bottom:20px">Click <strong>Delete</strong> on any row to permanently erase that route and all associated ratings.</p>
  <table id="routesTable"><tr><td class="loading">Loading…</td></tr></table>
</div>

<div id="tab-companies" class="content" style="display:none">
  <div class="section-title">Bus Companies</div>
  <p style="font-size:13px;color:#94A3B8;margin-bottom:20px">Active companies appear as autocomplete suggestions in the Contribute form. Deactivate to hide without deleting.</p>
  <div style="background:#fff;border-radius:16px;border:1px solid #E2E8F0;padding:20px;margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Add Company</div>
    <div style="display:flex;gap:10px">
      <input id="co-input" type="text" placeholder="e.g. Inter Africa"
        style="flex:1;padding:11px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;font-family:inherit;outline:none"
        onkeydown="if(event.key==='Enter')addCompany()" />
      <button onclick="addCompany()"
        style="padding:11px 22px;background:#F97316;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Add</button>
    </div>
    <div id="co-error" style="color:#DC2626;font-size:13px;margin-top:8px;display:none"></div>
  </div>
  <table id="companiesTable"><tr><td class="loading">Loading…</td></tr></table>
</div>

<div id="tab-moderation" class="content" style="display:none">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <div class="section-title" style="margin:0">UGC safety reports</div>
    <button onclick="loadReports()" style="padding:8px 18px;background:#1E3A5F;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">↻ Refresh</button>
  </div>
  <p style="font-size:13px;color:#94A3B8;margin-bottom:20px">
    Review in-app reports and remove objectionable routes/comments or hide a contributor&apos;s public content. Actions are retained with the report for auditability.
  </p>
  <table id="reportsTable"><tr><td class="loading">Loading reports…</td></tr></table>
</div>

<script>
function cssBarV(container, labels, values, color) {
  const max = Math.max(...values, 1);
  container.innerHTML = \`<div style="display:flex;align-items:flex-end;gap:4px;height:180px;padding-top:8px">\${
    labels.map((lbl, i) => {
      const pct = Math.round((values[i] / max) * 100);
      return \`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <span style="font-size:10px;color:#64748B;font-weight:600">\${values[i] > 0 ? values[i] : ''}</span>
        <div style="width:100%;height:\${pct}%;min-height:2px;background:\${color};border-radius:4px 4px 0 0;transition:height .3s"></div>
        <span style="font-size:9px;color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center">\${lbl}</span>
      </div>\`;
    }).join('')
  }</div>\`;
}

function cssBarH(container, labels, values, color) {
  const max = Math.max(...values, 1);
  container.innerHTML = labels.map((lbl, i) => {
    const pct = Math.round((values[i] / max) * 100);
    return \`<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:12px;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:78%">\${lbl}</span>
        <span style="font-size:12px;font-weight:600;color:#64748B">\${values[i]}</span>
      </div>
      <div style="background:#F1F5F9;border-radius:4px;height:8px">
        <div style="width:\${pct}%;height:100%;background:\${color};border-radius:4px;transition:width .3s"></div>
      </div>
    </div>\`;
  }).join('');
}

function fmt(dt) {
  return new Date(dt).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtDate(dt) {
  return new Date(dt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
function pill(n) {
  if (n === 0) return '<span class="pill zero">0 results</span>';
  if (n < 3) return '<span class="pill partial">' + n + ' results</span>';
  return '<span class="pill ok">' + n + ' results</span>';
}

function renderCityProfiles(profiles) {
  const grid = document.getElementById('cityGrid');
  if (!profiles || !profiles.length) {
    grid.innerHTML = '<div class="no-cities">No city data yet — searches will appear here once users start searching from specific cities.</div>';
    return;
  }

  grid.innerHTML = profiles.map(p => {
    const successRate = p.totalSearches > 0
      ? Math.round(((p.totalSearches - p.zeroResultSearches) / p.totalSearches) * 100)
      : 0;
    const maxDest = p.topDestinations.length ? p.topDestinations[0].count : 1;

    const destRows = p.topDestinations.slice(0, 5).map(d => {
      const pct = Math.round((d.count / maxDest) * 100);
      return \`<div class="dest-row">
        <span class="dest-city">\${d.toCity}</span>
        <div class="dest-bar-wrap"><div class="dest-bar-fill" style="width:\${pct}%"></div></div>
        <span class="dest-count">\${d.count}</span>
      </div>\`;
    }).join('');

    const dayPills = p.topDays.slice(0, 5).map(d =>
      \`<span class="pill day">\${d.day} · \${d.count}</span>\`
    ).join('');

    const zeroColor = p.zeroResultSearches === 0 ? 'green' : (p.zeroResultSearches / p.totalSearches > 0.5 ? 'accent' : '');

    return \`<div class="city-card">
      <div class="city-card-header">
        <span class="city-card-name">📍 \${p.city}</span>
        <span class="city-card-total">\${p.totalSearches} searches</span>
      </div>
      <div class="city-card-body">
        <div class="city-stats-row">
          <div class="city-stat">
            <span class="city-stat-num">\${p.totalSearches}</span>
            <span class="city-stat-lbl">Total Searches</span>
          </div>
          <div class="city-stat">
            <span class="city-stat-num \${zeroColor}">\${p.zeroResultSearches}</span>
            <span class="city-stat-lbl">No Results</span>
          </div>
          <div class="city-stat">
            <span class="city-stat-num">\${p.uniqueUsers > 0 ? p.uniqueUsers : '—'}</span>
            <span class="city-stat-lbl">Logged-in Users</span>
          </div>
        </div>

        <div class="result-bar-wrap">
          <div class="result-bar-label">
            <span>Route availability</span>
            <span>\${successRate}% found results</span>
          </div>
          <div class="result-bar"><div class="result-bar-fill" style="width:\${successRate}%"></div></div>
        </div>

        \${destRows ? \`<div>
          <div class="city-section-label">Top Destinations</div>
          <div class="dest-rows">\${destRows}</div>
        </div>\` : ''}

        \${dayPills ? \`<div>
          <div class="city-section-label">Active Days</div>
          <div class="days-pills">\${dayPills}</div>
        </div>\` : ''}

        <div style="font-size:11px;color:#CBD5E1">Last search: \${fmtDate(p.lastSeen)}</div>
      </div>
    </div>\`;
  }).join('');
}

async function load() {
  let d;
  try {
    const r = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (!r.ok) {
      document.getElementById('cards').innerHTML = '<div class="loading">Failed to load — <a href="#" onclick="load();return false" style="color:#F97316">Retry</a></div>';
      return;
    }
    d = await r.json();
  } catch (e) {
    document.getElementById('cards').innerHTML = '<div class="loading">Network error — <a href="#" onclick="load();return false" style="color:#F97316">Retry</a></div>';
    return;
  }

  document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

  // Cards
  const { overview } = d;
  document.getElementById('cards').innerHTML = \`
    <div class="card"><div class="num">\${overview.totalSearches.toLocaleString()}</div><div class="lbl">Total Searches</div></div>
    <div class="card accent"><div class="num">\${overview.todaySearches.toLocaleString()}</div><div class="lbl">Searches Today</div></div>
    <div class="card"><div class="num">\${overview.zeroResultSearches.toLocaleString()}</div><div class="lbl">Zero-Result Searches</div></div>
    <div class="card green"><div class="num">\${overview.totalJourneys.toLocaleString()}</div><div class="lbl">Routes in DB</div></div>
    <div class="card"><div class="num">\${overview.totalRatings.toLocaleString()}</div><div class="lbl">Ratings Submitted</div></div>
    <div class="card accent"><div class="num">\${overview.avgRating ? overview.avgRating.toFixed(2) + ' ★' : '—'}</div><div class="lbl">Avg Route Rating</div></div>
  \`;

  // Volume chart
  const vol = d.volumeByDay;
  cssBarV(document.getElementById('volumeChart'), vol.map(v => v.date.slice(5)), vol.map(v => v.count), '#1E3A5FCC');

  // Routes chart
  const routes = d.topRoutes;
  cssBarH(document.getElementById('routesChart'), routes.map(r => (r.fromCity || '?') + ' → ' + (r.toCity || '?')), routes.map(r => r.count), '#F97316CC');

  // Days chart
  const dayOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayMap = Object.fromEntries(d.topDays.map(r => [r.day, r.count]));
  cssBarV(document.getElementById('daysChart'), dayOrder, dayOrder.map(day => dayMap[day] || 0), '#22C55ECC');

  // City origin profiles
  renderCityProfiles(d.cityProfiles);

  // Opportunities table
  const opp = d.opportunities;
  document.getElementById('oppTable').innerHTML = opp.length === 0
    ? '<tr><td colspan="3" class="loading">No zero-result searches yet 🎉</td></tr>'
    : '<tr><th>From</th><th>To</th><th>Searches</th></tr>' +
      opp.map(r => \`<tr><td>\${r.fromCity || '—'}</td><td>\${r.toCity || '—'}</td><td><strong>\${r.count}</strong></td></tr>\`).join('');

  // Recent searches table
  const recent = d.recentSearches;
  document.getElementById('recentTable').innerHTML = recent.length === 0
    ? '<tr><td colspan="6" class="loading">No searches recorded yet</td></tr>'
    : '<tr><th>Time</th><th>From</th><th>To</th><th>Day Filter</th><th>Results</th><th>User</th></tr>' +
      recent.map(r => \`<tr>
        <td class="ts">\${fmt(r.createdAt)}</td>
        <td>\${r.fromCity || '<span style="color:#94A3B8">—</span>'}</td>
        <td>\${r.toCity || '<span style="color:#94A3B8">—</span>'}</td>
        <td>\${r.day || '<span style="color:#94A3B8">—</span>'}</td>
        <td>\${pill(r.resultsCount)}</td>
        <td class="ts">\${r.userId ? r.userId.slice(0,12)+'…' : 'anon'}</td>
      </tr>\`).join('');
}

setTimeout(load, 300);
setInterval(load, 60000);

// ── Manage Routes tab ─────────────────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('tab-analytics').style.display = tab === 'analytics' ? '' : 'none';
  document.getElementById('tab-routes').style.display = tab === 'routes' ? '' : 'none';
  document.getElementById('tab-companies').style.display = tab === 'companies' ? '' : 'none';
  document.getElementById('tab-moderation').style.display = tab === 'moderation' ? '' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active',
      (i === 0 && tab === 'analytics') ||
      (i === 1 && tab === 'routes') ||
      (i === 2 && tab === 'moderation') ||
      (i === 3 && tab === 'companies')
    );
  });
  if (tab === 'routes') loadRoutes();
  if (tab === 'companies') loadCompanies();
  if (tab === 'moderation') loadReports();
}

function fmtTime(t) {
  if (!t) return '—';
  const m = t.match(/^(\\d{1,2}):(\\d{2})$/);
  if (!m) return t;
  const h = parseInt(m[1], 10), min = m[2];
  return (h === 0 ? 12 : h > 12 ? h - 12 : h) + ':' + min + ' ' + (h < 12 ? 'AM' : 'PM');
}

async function loadRoutes() {
  const tbl = document.getElementById('routesTable');
  tbl.innerHTML = '<tr><td colspan="8" class="loading">Loading routes…</td></tr>';
  const r = await fetch('/api/admin/journeys', { credentials: 'same-origin' });
  if (!r.ok) { tbl.innerHTML = '<tr><td colspan="8" class="loading">Failed to load routes</td></tr>'; return; }
  const { journeys } = await r.json();
  if (!journeys.length) {
    tbl.innerHTML = '<tr><td colspan="8" class="loading">No routes in the database yet.</td></tr>';
    return;
  }
  tbl.innerHTML =
    '<tr><th>#</th><th>Route</th><th>Departure</th><th>Bus Company</th><th>Price</th><th>Days</th><th>Contributor</th><th>Ratings</th><th></th></tr>' +
    journeys.map(j => \`<tr id="row-\${j.id}">
      <td class="ts">\${j.id}</td>
      <td><strong>\${j.fromCity}</strong> → <strong>\${j.toCity}</strong></td>
      <td>\${fmtTime(j.departureTime)} – \${fmtTime(j.arrivalTime)}</td>
      <td>\${j.busCompany}</td>
      <td>$\${j.price.toFixed(2)}</td>
      <td><span class="route-tag">\${j.scheduledDays || '—'}</span></td>
      <td class="ts">\${j.contributorName}</td>
      <td>\${j.ratingCount > 0 ? j.ratingCount + (j.avgRating ? ' · ★' + j.avgRating.toFixed(1) : '') : '<span style="color:#94A3B8">—</span>'}</td>
      <td><button class="del-btn" id="del-\${j.id}" onclick="confirmDelete(\${j.id}, '\${(j.fromCity + ' → ' + j.toCity).replace(/'/g, '\\\\\\'')}', '\${j.busCompany.replace(/'/g, '\\\\\\'')}')">Delete</button></td>
    </tr>\`).join('');
}

let pendingDeleteId = null;

function confirmDelete(id, route, company) {
  pendingDeleteId = id;
  document.getElementById('modal-route-desc').textContent = route + ' · ' + company;
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.style.display = 'flex';
  const btn = document.getElementById('modal-confirm-btn');
  btn.textContent = 'Delete';
  btn.disabled = false;
  btn.onclick = () => executeDelete(id);
}

function closeModal() {
  document.getElementById('modal-backdrop').style.display = 'none';
  pendingDeleteId = null;
}

async function executeDelete(id) {
  const btn = document.getElementById('modal-confirm-btn');
  btn.textContent = 'Deleting…';
  btn.disabled = true;
  const r = await fetch('/api/admin/journeys/' + id, { method: 'DELETE', credentials: 'same-origin' });
  closeModal();
  if (r.ok) {
    const row = document.getElementById('row-' + id);
    if (row) {
      row.style.transition = 'opacity .3s';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 320);
    }
  } else {
    alert('Delete failed. The route may already have been removed.');
    loadRoutes();
  }
}

// Close modal on backdrop click
document.getElementById('modal-backdrop').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── UGC moderation tab ───────────────────────────────────────────────────────
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadReports() {
  const tbl = document.getElementById('reportsTable');
  tbl.innerHTML = '<tr><td colspan="8" class="loading">Loading reports…</td></tr>';
  try {
    const r = await fetch('/api/admin/abuse-reports?status=pending', { credentials: 'same-origin' });
    if (!r.ok) {
      tbl.innerHTML = '<tr><td colspan="8" class="loading">Failed to load reports</td></tr>';
      return;
    }
    const data = await r.json();
    const reports = data.reports || [];
    if (!reports.length) {
      tbl.innerHTML = '<tr><td colspan="8" class="loading">No pending reports — the community is clear 🎉</td></tr>';
      return;
    }
    tbl.innerHTML =
      '<tr><th>Received</th><th>Target</th><th>Reason</th><th>Details</th><th>Reporter</th><th>Status</th><th>Actions</th></tr>' +
      reports.map(function(report) {
        const target =
          report.targetType === 'user' ? 'Contributor ' + report.targetId :
          report.targetType === 'comment' ? 'Comment #' + report.targetId :
          'Route #' + report.targetId;
        const primaryAction = report.targetType === 'user'
          ? 'hide_user'
          : report.targetType === 'journey' ? 'remove_route' : 'remove_content';
        const primaryLabel = report.targetType === 'user'
          ? 'Hide user content'
          : report.targetType === 'journey' ? 'Remove route' : 'Remove content';
        return '<tr id="report-' + report.id + '">' +
          '<td class="ts">' + esc(fmt(report.createdAt)) + '</td>' +
          '<td><strong>' + esc(target) + '</strong><br><span class="ts">' + esc(report.targetType) + '</span><br><span style="display:block;max-width:260px;white-space:normal;margin-top:4px">' + esc(report.targetPreview || '—') + '</span></td>' +
          '<td>' + esc(String(report.reason).replace(/_/g, ' ')) + '</td>' +
          '<td style="max-width:280px;white-space:normal">' + esc(report.details || '—') + '</td>' +
          '<td class="ts">' + esc(report.reporterName || report.reporterId || 'anonymous') + '</td>' +
          '<td><span class="pill partial">Pending</span></td>' +
          '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="del-btn" onclick="moderateReport(' + report.id + ',\\'' + primaryAction + '\\')">' + primaryLabel + '</button>' +
            '<button class="del-btn" style="background:#F8FAFC;color:#475569;border-color:#CBD5E1" onclick="moderateReport(' + report.id + ',\\'dismiss\\')">Dismiss</button>' +
          '</td></tr>';
      }).join('');
  } catch (e) {
    tbl.innerHTML = '<tr><td colspan="8" class="loading">Network error — retry to load reports</td></tr>';
  }
}

async function moderateReport(id, action) {
  const labels = {
    remove_content: 'Remove this content',
    remove_route: 'Remove this route',
    hide_user: 'Hide this contributor\\'s public content',
    dismiss: 'Dismiss this report'
  };
  if (!confirm((labels[action] || 'Apply this action') + '?')) return;
  const notes = prompt('Optional moderator note (kept with the report):', '') || '';
  const r = await fetch('/api/admin/abuse-reports/' + id, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, notes: notes })
  });
  if (!r.ok) {
    alert('Could not update this report. Please try again.');
    return;
  }
  loadReports();
}

// ── Bus Companies tab ─────────────────────────────────────────────────────────

async function loadCompanies() {
  const tbl = document.getElementById('companiesTable');
  tbl.innerHTML = '<tr><td colspan="3" class="loading">Loading…</td></tr>';
  const r = await fetch('/api/admin/bus-companies', { credentials: 'same-origin' });
  if (!r.ok) { tbl.innerHTML = '<tr><td colspan="3" class="loading">Failed to load</td></tr>'; return; }
  const { companies } = await r.json();
  if (!companies.length) {
    tbl.innerHTML = '<tr><td colspan="3" class="loading">No companies yet — add one above</td></tr>';
    return;
  }
  tbl.innerHTML = '<tr><th>Company</th><th>Status</th><th>Actions</th></tr>' +
    companies.map(c => \`<tr id="co-\${c.id}">
      <td><strong>\${c.name}</strong></td>
      <td><span class="pill \${c.active ? 'ok' : 'zero'}">\${c.active ? 'Active' : 'Inactive'}</span></td>
      <td style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="toggleCompany(\${c.id},\${!c.active})" class="del-btn"
          style="background:\${c.active ? '#FEF9C3' : '#DCFCE7'};color:\${c.active ? '#CA8A04' : '#16A34A'};border-color:\${c.active ? '#FDE68A' : '#BBF7D0'}">
          \${c.active ? 'Deactivate' : 'Activate'}
        </button>
        <button onclick="deleteCompany(\${c.id},decodeURIComponent('\${encodeURIComponent(c.name)}'))" class="del-btn">Delete</button>
      </td>
    </tr>\`).join('');
}

async function addCompany() {
  const input = document.getElementById('co-input');
  const errEl = document.getElementById('co-error');
  const name = input.value.trim();
  if (!name) { errEl.textContent = 'Name cannot be empty'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  const r = await fetch('/api/admin/bus-companies', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (r.ok) { input.value = ''; loadCompanies(); }
  else { const d = await r.json(); errEl.textContent = d.error || 'Failed to add'; errEl.style.display = ''; }
}

async function toggleCompany(id, active) {
  await fetch('/api/admin/bus-companies/' + id, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  loadCompanies();
}

async function deleteCompany(id, name) {
  if (!confirm('Delete "' + name + '"? This removes it from the suggestion list but does not affect existing routes.')) return;
  const r = await fetch('/api/admin/bus-companies/' + id, { method: 'DELETE', credentials: 'same-origin' });
  if (r.ok) {
    const row = document.getElementById('co-' + id);
    if (row) { row.style.transition = 'opacity .3s'; row.style.opacity = '0'; setTimeout(() => row.remove(), 320); }
  } else { alert('Delete failed.'); loadCompanies(); }
}
</script>
</body>
</html>`;
}

export default router;
