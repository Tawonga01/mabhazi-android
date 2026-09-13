import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  journeysTable,
  journeyRatingsTable,
  searchEventsTable,
  journeyReportsTable,
  journeyClaimsTable,
  journeyContributionsTable,
  citiesTable,
  journeyStopsTable,
  proposedAssociationsTable,
  abuseReportsTable,
  usersTable,
} from "@workspace/db";
import { SubmitJourneyClaimBody } from "@workspace/api-zod";
import { and, ilike, or, eq, avg, count, sql, desc, gte, inArray, ne } from "drizzle-orm";
import { requireCurrentTerms } from "../middlewares/termsMiddleware";

const router: IRouter = Router();

const createJourneyStopSchema = z.object({
  city: z.string().min(1),
  arrivalTime: z.string().optional(),
  departureTime: z.string().optional(),
});

const createJourneySchema = z.object({
  fromCity: z.string().min(1),
  toCity: z.string().min(1),
  departureTime: z.string().min(1),
  arrivalTime: z.string().min(1),
  scheduledDays: z.string().min(1),
  busCompany: z.string().min(1),
  pickupPoint: z.string().min(1),
  dropoffPoint: z.string().min(1),
  price: z.number().min(0),
  stops: z.array(createJourneyStopSchema).optional(),
});

const rateJourneySchema = z.object({
  score: z.number().int().min(1).max(5),
});

const reportJourneySchema = z.object({
  type: z.enum(["comment", "bad_treatment", "breakdown", "departure_delay", "price"]),
  content: z.string().min(1).max(500).optional(),
  minutesLate: z.number().int().min(0).max(999).optional(),
  reportedPrice: z.number().min(0).optional(),
});

const abuseReportSchema = z.object({
  targetType: z.enum(["journey", "comment", "user"]),
  targetId: z.union([z.string(), z.number()]).transform(String),
  reason: z.enum([
    "sexual_content",
    "violent_content",
    "harassment",
    "hate_speech",
    "spam",
    "personal_information",
    "misleading",
    "other",
  ]),
  details: z.string().trim().max(1000).optional(),
});

type StopRow = {
  id: number;
  city: string;
  arrivalTime: string | null;
  departureTime: string | null;
  sequence: number;
  sourceAssociationId: number | null;
};

type JourneyRow = {
  id: number;
  fromCity: string;
  toCity: string;
  departureTime: string;
  arrivalTime: string;
  scheduledDays: string;
  busCompany: string;
  pickupPoint: string;
  dropoffPoint: string;
  price: string;
  contributorId: string | null;
  contributorName: string;
  dataStatus: "active" | "uncertain" | "inactive";
  confidenceScore: number;
  confirmationCount: number;
  lastConfirmedAt: Date | null;
  createdAt: Date;
  averageRating: string | null;
  ratingCount: number;
  userRating: number | null;
  stops: StopRow[];
};

function formatJourney(j: JourneyRow) {
  return {
    id: j.id,
    fromCity: j.fromCity,
    toCity: j.toCity,
    departureTime: j.departureTime,
    arrivalTime: j.arrivalTime,
    scheduledDays: j.scheduledDays,
    busCompany: j.busCompany,
    pickupPoint: j.pickupPoint,
    dropoffPoint: j.dropoffPoint,
    price: parseFloat(j.price),
    contributorId: j.contributorId,
    contributorName: j.contributorName,
    dataStatus: j.dataStatus,
    confidenceScore: Number(j.confidenceScore),
    confirmationCount: Number(j.confirmationCount),
    lastConfirmedAt: j.lastConfirmedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    averageRating: j.averageRating != null ? parseFloat(j.averageRating) : null,
    ratingCount: Number(j.ratingCount),
    userRating: j.userRating ?? null,
    stops: j.stops.map(s => ({
      id: s.id,
      city: s.city,
      arrivalTime: s.arrivalTime ?? null,
      departureTime: s.departureTime ?? null,
      sequence: s.sequence,
      sourceAssociationId: s.sourceAssociationId ?? null,
    })),
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function resortStops(journeyId: number) {
  const stops = await db
    .select()
    .from(journeyStopsTable)
    .where(eq(journeyStopsTable.journeyId, journeyId))
    .orderBy(sql`COALESCE(arrival_time, departure_time) NULLS LAST`);

  for (let i = 0; i < stops.length; i++) {
    await db
      .update(journeyStopsTable)
      .set({ sequence: i + 1 })
      .where(eq(journeyStopsTable.id, stops[i].id));
  }
}

async function proposeRelatedRoutes(journey: {
  id: number;
  fromCity: string;
  toCity: string;
  departureTime: string;
  arrivalTime: string;
  busCompany: string;
}) {
  try {
    // ── 1. Same-departure: same company + fromCity + departureTime ──────────────
    const sameDeparture = await db
      .select()
      .from(journeysTable)
      .where(
        and(
          ilike(journeysTable.busCompany, journey.busCompany),
          ilike(journeysTable.fromCity, journey.fromCity),
          eq(journeysTable.departureTime, journey.departureTime),
          ne(journeysTable.id, journey.id),
        ),
      );

    for (const related of sameDeparture) {
      const newMins = timeToMinutes(journey.arrivalTime);
      const relMins = timeToMinutes(related.arrivalTime);

      if (newMins < relMins) {
        // New is shorter — propose new.toCity as a stop on the longer existing route
        const alreadyProposed = await db
          .select({ id: proposedAssociationsTable.id })
          .from(proposedAssociationsTable)
          .where(
            and(
              eq(proposedAssociationsTable.parentJourneyId, related.id),
              eq(proposedAssociationsTable.candidateJourneyId, journey.id),
            ),
          );
        if (!alreadyProposed.length) {
          await db.insert(proposedAssociationsTable).values({
            candidateJourneyId: journey.id,
            parentJourneyId: related.id,
            proposedStopCity: journey.toCity,
            proposedStopTime: journey.arrivalTime,
            relationType: "contains_stop",
            confidenceScore: 80,
            evidence: {
              match: "same_operator_origin_departure",
              operator: journey.busCompany,
              origin: journey.fromCity,
              departureTime: journey.departureTime,
            },
          });
        }
      } else if (newMins > relMins) {
        // New is longer — propose related.toCity as a stop on the new route
        const alreadyProposed = await db
          .select({ id: proposedAssociationsTable.id })
          .from(proposedAssociationsTable)
          .where(
            and(
              eq(proposedAssociationsTable.parentJourneyId, journey.id),
              eq(proposedAssociationsTable.candidateJourneyId, related.id),
            ),
          );
        if (!alreadyProposed.length) {
          await db.insert(proposedAssociationsTable).values({
            candidateJourneyId: related.id,
            parentJourneyId: journey.id,
            proposedStopCity: related.toCity,
            proposedStopTime: related.arrivalTime,
            relationType: "contains_stop",
            confidenceScore: 80,
            evidence: {
              match: "same_operator_origin_departure",
              operator: journey.busCompany,
              origin: journey.fromCity,
              departureTime: journey.departureTime,
            },
          });
        }
      }
    }

    // ── 2. Same-arrival: same company + toCity + arrivalTime ─────────────────────
    const sameArrival = await db
      .select()
      .from(journeysTable)
      .where(
        and(
          ilike(journeysTable.busCompany, journey.busCompany),
          ilike(journeysTable.toCity, journey.toCity),
          eq(journeysTable.arrivalTime, journey.arrivalTime),
          ne(journeysTable.id, journey.id),
        ),
      );

    for (const related of sameArrival) {
      const newMins = timeToMinutes(journey.departureTime);
      const relMins = timeToMinutes(related.departureTime);

      if (newMins > relMins) {
        // New departs later — propose new.fromCity as a stop on the longer existing route
        const alreadyProposed = await db
          .select({ id: proposedAssociationsTable.id })
          .from(proposedAssociationsTable)
          .where(
            and(
              eq(proposedAssociationsTable.parentJourneyId, related.id),
              eq(proposedAssociationsTable.candidateJourneyId, journey.id),
            ),
          );
        if (!alreadyProposed.length) {
          await db.insert(proposedAssociationsTable).values({
            candidateJourneyId: journey.id,
            parentJourneyId: related.id,
            proposedStopCity: journey.fromCity,
            proposedStopTime: journey.departureTime,
            relationType: "contains_stop",
            confidenceScore: 80,
            evidence: {
              match: "same_operator_destination_arrival",
              operator: journey.busCompany,
              destination: journey.toCity,
              arrivalTime: journey.arrivalTime,
            },
          });
        }
      } else if (newMins < relMins) {
        // New departs earlier — propose related.fromCity as a stop on the new (longer) route
        const alreadyProposed = await db
          .select({ id: proposedAssociationsTable.id })
          .from(proposedAssociationsTable)
          .where(
            and(
              eq(proposedAssociationsTable.parentJourneyId, journey.id),
              eq(proposedAssociationsTable.candidateJourneyId, related.id),
            ),
          );
        if (!alreadyProposed.length) {
          await db.insert(proposedAssociationsTable).values({
            candidateJourneyId: related.id,
            parentJourneyId: journey.id,
            proposedStopCity: related.fromCity,
            proposedStopTime: related.departureTime,
            relationType: "contains_stop",
            confidenceScore: 80,
            evidence: {
              match: "same_operator_destination_arrival",
              operator: journey.busCompany,
              destination: journey.toCity,
              arrivalTime: journey.arrivalTime,
            },
          });
        }
      }
    }
  } catch {
    // Proposal generation is best-effort; don't fail the main request
  }
}

router.get("/journeys", async (req: Request, res: Response) => {
  const { fromCity, toCity, day } = req.query as Record<string, string | undefined>;
  const userId = req.isAuthenticated() ? req.user.id : "";

  const conditions = [];

  const from = fromCity?.trim();
  const to = toCity?.trim();

  if (from && to) {
    // Both cities provided — stop-aware: match any journey where from comes before to in the route
    conditions.push(
      or(
        // Direct: fromCity → toCity
        and(ilike(journeysTable.fromCity, `%${from}%`), ilike(journeysTable.toCity, `%${to}%`)),
        // fromCity is origin, toCity is a stop
        and(
          ilike(journeysTable.fromCity, `%${from}%`),
          sql`EXISTS (SELECT 1 FROM journey_stops s WHERE s.journey_id = ${journeysTable.id} AND s.city ILIKE ${`%${to}%`})`,
        ),
        // fromCity is a stop, toCity is destination
        and(
          sql`EXISTS (SELECT 1 FROM journey_stops s WHERE s.journey_id = ${journeysTable.id} AND s.city ILIKE ${`%${from}%`})`,
          ilike(journeysTable.toCity, `%${to}%`),
        ),
        // Both are intermediate stops, from comes before to
        sql`EXISTS (
          SELECT 1 FROM journey_stops s1
          JOIN journey_stops s2 ON s1.journey_id = s2.journey_id
          WHERE s1.journey_id = ${journeysTable.id}
          AND s1.city ILIKE ${`%${from}%`}
          AND s2.city ILIKE ${`%${to}%`}
          AND s1.sequence < s2.sequence
        )`,
      ),
    );
  } else {
    if (from) {
      conditions.push(
        or(
          ilike(journeysTable.fromCity, `%${from}%`),
          sql`EXISTS (SELECT 1 FROM journey_stops s WHERE s.journey_id = ${journeysTable.id} AND s.city ILIKE ${`%${from}%`})`,
        ),
      );
    }
    if (to) {
      conditions.push(
        or(
          ilike(journeysTable.toCity, `%${to}%`),
          sql`EXISTS (SELECT 1 FROM journey_stops s WHERE s.journey_id = ${journeysTable.id} AND s.city ILIKE ${`%${to}%`})`,
        ),
      );
    }
  }

  if (day && day.trim()) conditions.push(ilike(journeysTable.scheduledDays, `%${day.trim()}%`));

  // Moderated routes stay in the database for auditability, but never return
  // to the public search feed.
  conditions.push(
    and(
      ne(journeysTable.moderationStatus, "removed"),
      ne(journeysTable.moderationStatus, "hidden"),
    ),
  );

  const rows = await db
    .select({
      id: journeysTable.id,
      fromCity: journeysTable.fromCity,
      toCity: journeysTable.toCity,
      departureTime: journeysTable.departureTime,
      arrivalTime: journeysTable.arrivalTime,
      scheduledDays: journeysTable.scheduledDays,
      busCompany: journeysTable.busCompany,
      pickupPoint: journeysTable.pickupPoint,
      dropoffPoint: journeysTable.dropoffPoint,
      price: journeysTable.price,
      contributorId: journeysTable.contributedBy,
      contributorName: journeysTable.contributorName,
       dataStatus: journeysTable.dataStatus,
       confidenceScore: journeysTable.confidenceScore,
       confirmationCount: journeysTable.confirmationCount,
       lastConfirmedAt: journeysTable.lastConfirmedAt,
      createdAt: journeysTable.createdAt,
      averageRating: avg(journeyRatingsTable.score),
      ratingCount: count(journeyRatingsTable.id),
      userRating: sql<number | null>`MAX(CASE WHEN ${journeyRatingsTable.userId} = ${userId} THEN ${journeyRatingsTable.score} END)`,
    })
    .from(journeysTable)
    .leftJoin(journeyRatingsTable, eq(journeyRatingsTable.journeyId, journeysTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(journeysTable.id)
    .orderBy(journeysTable.departureTime);

  // Batch-load stops for all returned journeys
  const journeyIds = rows.map((r) => r.id);
  const allStops =
    journeyIds.length > 0
      ? await db
          .select()
          .from(journeyStopsTable)
          .where(inArray(journeyStopsTable.journeyId, journeyIds))
          .orderBy(journeyStopsTable.sequence)
      : [];

  const stopsByJourneyId = allStops.reduce<Record<number, StopRow[]>>((acc, s) => {
    if (!acc[s.journeyId]) acc[s.journeyId] = [];
    acc[s.journeyId].push({
      id: s.id,
      city: s.city,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      sequence: s.sequence,
      sourceAssociationId: s.sourceAssociationId,
    });
    return acc;
  }, {});

  res.json({ journeys: rows.map((j) => formatJourney({ ...j, stops: stopsByJourneyId[j.id] ?? [] })) });

  const logUserId = req.isAuthenticated() ? req.user.id : null;
  db.insert(searchEventsTable)
    .values({
      fromCity: fromCity?.trim() || null,
      toCity: toCity?.trim() || null,
      day: day?.trim() || null,
      resultsCount: rows.length,
      userId: logUserId,
    })
    .catch(() => {});
});

router.post("/journeys", requireCurrentTerms, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createJourneySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const user = req.user;
  const displayName =
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "Anonymous";

  const [journey] = await db
    .insert(journeysTable)
    .values({
      ...parsed.data,
      price: parsed.data.price.toString(),
      contributedBy: user.id,
      contributorName: displayName,
    })
    .returning();

  await db.insert(journeyContributionsTable).values({
    journeyId: journey.id,
    contributorId: user.id,
    payload: parsed.data,
  });

  // Insert explicitly-submitted intermediate stops
  const submittedStops = parsed.data.stops ?? [];
  if (submittedStops.length > 0) {
    await db.insert(journeyStopsTable).values(
      submittedStops.map((s, i) => ({
        journeyId: journey.id,
        city: s.city,
        arrivalTime: s.arrivalTime ?? null,
        departureTime: s.departureTime ?? null,
        sequence: i + 1,
      })),
    );
    await resortStops(journey.id);
  }

  // Propose associations: best-effort, fire-and-forget
  proposeRelatedRoutes({
    id: journey.id,
    fromCity: journey.fromCity,
    toCity: journey.toCity,
    departureTime: journey.departureTime,
    arrivalTime: journey.arrivalTime,
    busCompany: journey.busCompany,
  }).catch(() => {});

  // Fetch stops for response (auto-association may have added some)
  const stops = await db
    .select()
    .from(journeyStopsTable)
    .where(eq(journeyStopsTable.journeyId, journey.id))
    .orderBy(journeyStopsTable.sequence);

  res.status(201).json(
    formatJourney({
      ...journey,
      averageRating: null,
      ratingCount: 0,
      userRating: null,
      contributorId: journey.contributedBy,
        dataStatus: journey.dataStatus,
        confidenceScore: journey.confidenceScore,
        confirmationCount: journey.confirmationCount,
        lastConfirmedAt: journey.lastConfirmedAt,
      stops: stops.map((s) => ({
        id: s.id,
        city: s.city,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
        sequence: s.sequence,
          sourceAssociationId: s.sourceAssociationId,
      })),
    }),
  );
});

router.post("/journeys/:id/confirm", requireCurrentTerms, async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const [journey] = await db
    .select({ id: journeysTable.id })
    .from(journeysTable)
    .where(eq(journeysTable.id, journeyId));

  if (!journey) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }

  await db
    .insert(journeyClaimsTable)
    .values({
      journeyId,
      userId: req.user.id,
      type: "route_active",
      value: { confirmed: true },
    })
    .onConflictDoUpdate({
      target: [journeyClaimsTable.journeyId, journeyClaimsTable.userId, journeyClaimsTable.type],
      set: {
        value: { confirmed: true },
        status: "active",
        observedAt: new Date(),
      },
    });

  const [claimStats] = await db
    .select({
      confirmations: sql<number>`COUNT(DISTINCT ${journeyClaimsTable.userId})`,
    })
    .from(journeyClaimsTable)
    .where(
      and(
        eq(journeyClaimsTable.journeyId, journeyId),
        eq(journeyClaimsTable.type, "route_active"),
        eq(journeyClaimsTable.status, "active"),
      ),
    );

  const confirmationCount = Number(claimStats?.confirmations ?? 0);
  const confidenceScore = Math.min(100, 30 + confirmationCount * 20);

  await db
    .update(journeysTable)
    .set({
      dataStatus: "active",
      confidenceScore,
      confirmationCount,
      lastConfirmedAt: new Date(),
    })
    .where(eq(journeysTable.id, journeyId));

  res.status(201).json({
    success: true,
    confidenceScore,
    confirmationCount,
    lastConfirmedAt: new Date().toISOString(),
  });
});

router.post("/journeys/:id/claims", requireCurrentTerms, async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const parsed = SubmitJourneyClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid claim body" });
    return;
  }

  const [journey] = await db
    .select({
      id: journeysTable.id,
      confidenceScore: journeysTable.confidenceScore,
    })
    .from(journeysTable)
    .where(eq(journeysTable.id, journeyId));

  if (!journey) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }

  const [claim] = await db
    .insert(journeyClaimsTable)
    .values({
      journeyId,
      userId: req.user.id,
      type: parsed.data.type,
      value: parsed.data.value,
    })
    .onConflictDoUpdate({
      target: [journeyClaimsTable.journeyId, journeyClaimsTable.userId, journeyClaimsTable.type],
      set: {
        value: parsed.data.value,
        status: "active",
        observedAt: new Date(),
      },
    })
    .returning({
      id: journeyClaimsTable.id,
      type: journeyClaimsTable.type,
      status: journeyClaimsTable.status,
      createdAt: journeyClaimsTable.createdAt,
    });

  // A new correction is visible evidence, but it should make the route
  // temporarily more cautious until other riders confirm or dispute it.
  await db
    .update(journeysTable)
    .set({
      dataStatus: "uncertain",
      confidenceScore: Math.max(0, journey.confidenceScore - 10),
    })
    .where(eq(journeysTable.id, journeyId));

  res.status(201).json({
    success: true,
    claimId: claim.id,
    type: claim.type,
    status: claim.status,
    createdAt: claim.createdAt.toISOString(),
  });
});

router.get("/journeys/:id/details", async (req: Request, res: Response) => {
  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const [publicJourney] = await db
    .select({ id: journeysTable.id })
    .from(journeysTable)
    .where(
      and(
        eq(journeysTable.id, journeyId),
        ne(journeysTable.moderationStatus, "removed"),
        ne(journeysTable.moderationStatus, "hidden"),
      ),
    );
  if (!publicJourney) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

  const [comments, priceReports, [{ cnt: badCount }], [{ cnt: breakdownCount }], [delayStats]] =
    await Promise.all([
      db
        .select()
        .from(journeyReportsTable)
        .leftJoin(usersTable, eq(usersTable.id, journeyReportsTable.userId))
        .where(
          and(
            eq(journeyReportsTable.journeyId, journeyId),
            eq(journeyReportsTable.type, "comment"),
            ne(journeyReportsTable.moderationStatus, "removed"),
          ),
        )
        .orderBy(desc(journeyReportsTable.createdAt))
        .limit(10),
      db
        .select()
        .from(journeyReportsTable)
        .where(
          and(
            eq(journeyReportsTable.journeyId, journeyId),
            eq(journeyReportsTable.type, "price"),
            ne(journeyReportsTable.moderationStatus, "removed"),
          ),
        )
        .orderBy(desc(journeyReportsTable.createdAt))
        .limit(5),
      db
        .select({ cnt: count() })
        .from(journeyReportsTable)
        .where(
          and(
            eq(journeyReportsTable.journeyId, journeyId),
            eq(journeyReportsTable.type, "bad_treatment"),
            ne(journeyReportsTable.moderationStatus, "removed"),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(journeyReportsTable)
        .where(
          and(
            eq(journeyReportsTable.journeyId, journeyId),
            eq(journeyReportsTable.type, "breakdown"),
            ne(journeyReportsTable.moderationStatus, "removed"),
            gte(journeyReportsTable.createdAt, threeMonthsAgo),
          ),
        ),
      db
        .select({
          cnt: count(),
          avgMins: avg(journeyReportsTable.minutesLate),
        })
        .from(journeyReportsTable)
        .where(
          and(
            eq(journeyReportsTable.journeyId, journeyId),
            eq(journeyReportsTable.type, "departure_delay"),
            ne(journeyReportsTable.moderationStatus, "removed"),
            gte(journeyReportsTable.createdAt, monthAgo),
          ),
        ),
    ]);

  const todayPrices = priceReports.filter((r) => r.createdAt >= todayStart);
  const yesterdayPrices = priceReports.filter((r) => r.createdAt >= yesterdayStart && r.createdAt < todayStart);
  const priceToday = todayPrices.length > 0 ? parseFloat(todayPrices[0].reportedPrice!) : null;
  const priceYesterday = yesterdayPrices.length > 0 ? parseFloat(yesterdayPrices[0].reportedPrice!) : null;

  res.json({
    comments: comments.map(({ journey_reports: c, users: author }) => ({
      id: c.id,
      userId: c.userId,
      authorName:
        author?.displayName ||
        [author?.firstName, author?.lastName].filter(Boolean).join(" ") ||
        null,
      content: c.content ?? "",
      createdAt: c.createdAt.toISOString(),
    })),
    priceToday,
    priceYesterday,
    badTreatmentCount: Number(badCount),
    breakdownCount: Number(breakdownCount),
    delays: {
      count: Number(delayStats.cnt),
      avgMinutes: delayStats.avgMins != null ? parseFloat(delayStats.avgMins) : null,
    },
  });
});

router.post("/journeys/:id/reports", requireCurrentTerms, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const parsed = reportJourneySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report body" });
    return;
  }

  const { type, content, minutesLate, reportedPrice } = parsed.data;

  await db.insert(journeyReportsTable).values({
    journeyId,
    userId: req.user.id,
    type,
    content: content ?? null,
    minutesLate: minutesLate ?? null,
    reportedPrice: reportedPrice != null ? String(reportedPrice) : null,
  });

  res.status(201).json({ success: true });
});

/**
 * Submit an abuse report from the in-app safety controls. Reports are kept
 * separately from trip observations so moderators can action them without
 * changing the community's aggregate safety metrics.
 *
 * Safety exception: reporting objectionable content must remain available even
 * when a reporter has not accepted the current community-contribution terms.
 * This route intentionally does not use requireCurrentTerms; it still requires
 * authentication and validates every report target and reason.
 */
router.post("/journeys/:id/abuse-reports", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const parsed = abuseReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid abuse report body" });
    return;
  }

  const { targetType, targetId, reason, details } = parsed.data;
  if (targetType === "journey" && targetId !== String(journeyId)) {
    res.status(400).json({ error: "Journey target does not match the route" });
    return;
  }

  const [journey] = await db
    .select({ id: journeysTable.id })
    .from(journeysTable)
    .where(eq(journeysTable.id, journeyId));
  if (!journey) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }

  if (targetType === "comment") {
    const [comment] = await db
      .select({ id: journeyReportsTable.id })
      .from(journeyReportsTable)
      .where(
        and(
          eq(journeyReportsTable.id, Number(targetId)),
          eq(journeyReportsTable.journeyId, journeyId),
          eq(journeyReportsTable.type, "comment"),
        ),
      );
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
  }

  if (targetType === "user") {
    const [targetUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, targetId));
    if (!targetUser) {
      res.status(404).json({ error: "Contributor not found" });
      return;
    }
  }

  const [report] = await db
    .insert(abuseReportsTable)
    .values({
      reporterId: req.user.id,
      targetType,
      targetId,
      journeyId,
      reason,
      details: details || null,
    })
    .returning({ id: abuseReportsTable.id });

  res.status(201).json({ success: true, reportId: report.id });
});

router.post("/journeys/:id/rate", requireCurrentTerms, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const journeyId = parseInt(req.params.id as string, 10);
  if (isNaN(journeyId)) {
    res.status(400).json({ error: "Invalid journey ID" });
    return;
  }

  const parsed = rateJourneySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Score must be an integer between 1 and 5" });
    return;
  }

  const { score } = parsed.data;
  const userId = req.user.id;

  await db
    .insert(journeyRatingsTable)
    .values({ journeyId, userId, score })
    .onConflictDoUpdate({
      target: [journeyRatingsTable.userId, journeyRatingsTable.journeyId],
      set: { score },
    });

  const [stats] = await db
    .select({
      averageRating: avg(journeyRatingsTable.score),
      ratingCount: count(journeyRatingsTable.id),
    })
    .from(journeyRatingsTable)
    .where(eq(journeyRatingsTable.journeyId, journeyId));

  res.json({
    averageRating: stats.averageRating != null ? parseFloat(stats.averageRating) : null,
    ratingCount: Number(stats.ratingCount),
    userRating: score,
  });
});

router.get("/cities", async (req: Request, res: Response) => {
  const q = (req.query["q"] as string | undefined)?.trim() ?? "";

  let rows;
  if (q.length === 0) {
    rows = await db.select({ name: citiesTable.name }).from(citiesTable).limit(20);
  } else {
    rows = await db
      .select({ name: citiesTable.name })
      .from(citiesTable)
      .where(
        or(
          ilike(citiesTable.name, `${q}%`),
          ilike(citiesTable.name, `% ${q}%`),
        ),
      )
      .limit(10);
  }

  res.json({ cities: rows.map((r) => r.name) });
});

export default router;
