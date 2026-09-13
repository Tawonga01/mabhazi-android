import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  abuseReportsTable,
  db,
  journeyClaimsTable,
  journeyContributionsTable,
  journeyRatingsTable,
  journeyReportsTable,
  journeysTable,
  pool,
  proposedAssociationsTable,
  searchEventsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { deleteMabhaziAccountInTransaction } from "./legal";

const targetUserId = `legal-delete-target-${randomUUID()}`;
const survivorUserId = `legal-delete-survivor-${randomUUID()}`;
const targetSessionId = randomBytes(32).toString("hex");
const secondTargetSessionId = randomBytes(32).toString("hex");
const survivorSessionId = randomBytes(32).toString("hex");

let targetJourneyId: number;
let survivorJourneyId: number;
let server: Server | undefined;
let baseUrl = "";

function sessionData(userId: string) {
  return {
    user: {
      id: userId,
      email: `${userId}@example.invalid`,
      firstName: "Fixture",
      lastName: "User",
      profileImageUrl: null,
      displayName: "Fixture User",
      lastNameChange: null,
    },
    access_token: "fixture-token",
  };
}

async function cleanFixture(
  userIds: readonly string[],
  journeyIds: readonly number[],
  sessionIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(abuseReportsTable)
      .where(
        or(
          inArray(abuseReportsTable.reporterId, userIds),
          inArray(abuseReportsTable.targetId, userIds),
          inArray(abuseReportsTable.journeyId, journeyIds),
        ),
      );
    await tx
      .delete(journeyReportsTable)
      .where(
        or(
          inArray(journeyReportsTable.userId, userIds),
          inArray(journeyReportsTable.journeyId, journeyIds),
        ),
      );
    await tx
      .delete(journeyRatingsTable)
      .where(
        or(
          inArray(journeyRatingsTable.userId, userIds),
          inArray(journeyRatingsTable.journeyId, journeyIds),
        ),
      );
    await tx
      .delete(journeyClaimsTable)
      .where(
        or(
          inArray(journeyClaimsTable.userId, userIds),
          inArray(journeyClaimsTable.journeyId, journeyIds),
        ),
      );
    await tx
      .delete(journeyContributionsTable)
      .where(
        or(
          inArray(journeyContributionsTable.contributorId, userIds),
          inArray(journeyContributionsTable.journeyId, journeyIds),
        ),
      );
    await tx
      .delete(searchEventsTable)
      .where(inArray(searchEventsTable.userId, userIds));
    await tx
      .delete(proposedAssociationsTable)
      .where(
        or(
          inArray(proposedAssociationsTable.candidateJourneyId, journeyIds),
          inArray(proposedAssociationsTable.parentJourneyId, journeyIds),
          inArray(proposedAssociationsTable.resolvedBy, userIds),
        ),
      );
    await tx.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    await tx.delete(journeysTable).where(inArray(journeysTable.id, journeyIds));
    await tx.delete(usersTable).where(inArray(usersTable.id, userIds));
  });
}

async function setupEndpointFixture(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(usersTable).values([
      {
        id: targetUserId,
        email: `${targetUserId}@example.invalid`,
        firstName: "Target",
        lastName: "Fixture",
        displayName: "Target Fixture",
      },
      {
        id: survivorUserId,
        email: `${survivorUserId}@example.invalid`,
        firstName: "Survivor",
        lastName: "Fixture",
        displayName: "Survivor Fixture",
      },
    ]);

    const [targetJourney] = await tx
      .insert(journeysTable)
      .values({
        fromCity: "Fixture Origin",
        toCity: "Fixture Destination",
        departureTime: "08:00",
        arrivalTime: "10:00",
        scheduledDays: "Monday",
        busCompany: "Fixture Bus",
        pickupPoint: "Fixture Pickup",
        dropoffPoint: "Fixture Dropoff",
        price: "10.00",
        contributedBy: targetUserId,
        contributorName: "Target Fixture",
      })
      .returning({ id: journeysTable.id });
    const [survivorJourney] = await tx
      .insert(journeysTable)
      .values({
        fromCity: "Survivor Origin",
        toCity: "Survivor Destination",
        departureTime: "09:00",
        arrivalTime: "11:00",
        scheduledDays: "Tuesday",
        busCompany: "Fixture Bus",
        pickupPoint: "Survivor Pickup",
        dropoffPoint: "Survivor Dropoff",
        price: "12.00",
        contributedBy: survivorUserId,
        contributorName: "Survivor Fixture",
      })
      .returning({ id: journeysTable.id });

    targetJourneyId = targetJourney.id;
    survivorJourneyId = survivorJourney.id;

    await tx.insert(proposedAssociationsTable).values({
      candidateJourneyId: targetJourneyId,
      parentJourneyId: survivorJourneyId,
      proposedStopCity: "Fixture Stop",
      relationType: "contains_stop",
      resolvedBy: targetUserId,
    });

    await tx.insert(journeyReportsTable).values([
      {
        journeyId: survivorJourneyId,
        userId: targetUserId,
        type: "comment",
        content: "Target-owned comment is account data",
      },
      {
        journeyId: targetJourneyId,
        userId: survivorUserId,
        type: "comment",
        content: "Survivor comment remains on shared route",
      },
    ]);
    await tx.insert(journeyRatingsTable).values([
      { journeyId: survivorJourneyId, userId: targetUserId, score: 2 },
      { journeyId: targetJourneyId, userId: survivorUserId, score: 5 },
    ]);
    await tx.insert(journeyClaimsTable).values([
      {
        journeyId: survivorJourneyId,
        userId: targetUserId,
        type: "route_active",
        value: { fixture: "target" },
      },
      {
        journeyId: targetJourneyId,
        userId: survivorUserId,
        type: "route_active",
        value: { fixture: "survivor" },
      },
    ]);
    await tx.insert(journeyContributionsTable).values([
      {
        journeyId: targetJourneyId,
        contributorId: targetUserId,
        payload: { fixture: "target contribution" },
      },
      {
        journeyId: survivorJourneyId,
        contributorId: survivorUserId,
        payload: { fixture: "survivor contribution" },
      },
    ]);
    await tx.insert(searchEventsTable).values([
      {
        fromCity: "Fixture Origin",
        toCity: "Fixture Destination",
        resultsCount: 1,
        userId: targetUserId,
      },
      {
        fromCity: "Survivor Origin",
        toCity: "Survivor Destination",
        resultsCount: 1,
        userId: survivorUserId,
      },
    ]);
    await tx.insert(abuseReportsTable).values([
      {
        reporterId: targetUserId,
        targetType: "journey",
        targetId: String(survivorJourneyId),
        journeyId: survivorJourneyId,
        reason: "misleading",
        details: "Target's submitted abuse report is account data",
      },
      {
        reporterId: survivorUserId,
        targetType: "user",
        targetId: targetUserId,
        journeyId: targetJourneyId,
        reason: "personal_information",
        details: "Text mentioning Target Fixture must not be retained",
        moderatorNotes: "Moderator note mentioning Target Fixture",
        reviewedBy: targetUserId,
      },
      {
        reporterId: survivorUserId,
        targetType: "journey",
        targetId: String(targetJourneyId),
        journeyId: targetJourneyId,
        reason: "other",
        details: "Route report text mentioning Target Fixture",
      },
    ]);
    await tx.insert(sessionsTable).values([
      {
        sid: targetSessionId,
        sess: sessionData(targetUserId),
        expire: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        sid: secondTargetSessionId,
        sess: sessionData(targetUserId),
        expire: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        sid: survivorSessionId,
        sess: sessionData(survivorUserId),
        expire: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
  });
}

async function request(path: string, init?: RequestInit): Promise<{
  response: Response;
  body: unknown;
}> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML responses are useful to callers as text.
  }
  return { response, body };
}

before(async () => {
  await setupEndpointFixture();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await cleanFixture(
    [targetUserId, survivorUserId],
    [targetJourneyId, survivorJourneyId],
    [targetSessionId, secondTargetSessionId, survivorSessionId],
  );
  await pool.end();
});

test("deletion transaction rolls back an isolated fixture", async () => {
  const rollbackUserId = `legal-delete-rollback-${randomUUID()}`;
  const rollbackSessionId = randomBytes(32).toString("hex");
  let rollbackJourneyId = 0;

  await db.insert(usersTable).values({
    id: rollbackUserId,
    email: `${rollbackUserId}@example.invalid`,
    displayName: "Rollback Fixture",
  });
  const [journey] = await db
    .insert(journeysTable)
    .values({
      fromCity: "Rollback Origin",
      toCity: "Rollback Destination",
      departureTime: "08:00",
      arrivalTime: "09:00",
      scheduledDays: "Wednesday",
      busCompany: "Fixture Bus",
      pickupPoint: "Rollback Pickup",
      dropoffPoint: "Rollback Dropoff",
      price: "1.00",
      contributedBy: rollbackUserId,
      contributorName: "Rollback Fixture",
    })
    .returning({ id: journeysTable.id });
  rollbackJourneyId = journey.id;
  await db.insert(sessionsTable).values({
    sid: rollbackSessionId,
    sess: sessionData(rollbackUserId),
    expire: new Date(Date.now() + 60 * 60 * 1000),
  });

  class FixtureRollback extends Error {}
  await assert.rejects(
    db.transaction(async (tx) => {
      await deleteMabhaziAccountInTransaction(tx, rollbackUserId);
      const [deletedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, rollbackUserId));
      assert.equal(deletedUser, undefined);
      const [anonymizedJourney] = await tx
        .select({
          contributedBy: journeysTable.contributedBy,
          contributorName: journeysTable.contributorName,
        })
        .from(journeysTable)
        .where(eq(journeysTable.id, rollbackJourneyId));
      assert.deepEqual(anonymizedJourney, {
        contributedBy: null,
        contributorName: "Anonymous",
      });
      throw new FixtureRollback("rollback disposable fixture");
    }),
    (error: unknown) => error instanceof FixtureRollback,
  );

  const [restoredUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, rollbackUserId));
  assert.equal(restoredUser?.id, rollbackUserId);
  const [restoredSession] = await db
    .select({ sid: sessionsTable.sid })
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, rollbackSessionId));
  assert.equal(restoredSession?.sid, rollbackSessionId);
  const [restoredJourney] = await db
    .select({
      contributedBy: journeysTable.contributedBy,
      contributorName: journeysTable.contributorName,
    })
    .from(journeysTable)
    .where(eq(journeysTable.id, rollbackJourneyId));
  assert.deepEqual(restoredJourney, {
    contributedBy: rollbackUserId,
    contributorName: "Rollback Fixture",
  });

  await cleanFixture(
    [rollbackUserId],
    [rollbackJourneyId],
    [rollbackSessionId],
  );
});

test("deletion endpoint rejects unsafe requests and removes only disposable account data", async () => {
  const unauthorized = await request("/api/delete-account", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }),
  });
  assert.equal(unauthorized.response.status, 401);

  const wrongConfirmation = await request("/api/delete-account", {
    method: "POST",
    headers: {
      authorization: `Bearer ${targetSessionId}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(wrongConfirmation.response.status, 400);

  const missingCsrf = await request("/api/delete-account", {
    method: "POST",
    headers: {
      cookie: `sid=${secondTargetSessionId}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }),
  });
  assert.equal(missingCsrf.response.status, 403);

  const [stillPresent] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  assert.equal(stillPresent?.id, targetUserId);

  const deleted = await request("/api/delete-account", {
    method: "POST",
    headers: {
      authorization: `Bearer ${targetSessionId}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }),
  });
  assert.equal(deleted.response.status, 200);
  assert.deepEqual(deleted.body, { success: true });

  const [deletedUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  assert.equal(deletedUser, undefined);
  const [survivor] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, survivorUserId));
  assert.equal(survivor?.id, survivorUserId);

  const remainingTargetSessions = await db
    .select({ sid: sessionsTable.sid })
    .from(sessionsTable)
    .where(
      or(
        eq(sessionsTable.sid, targetSessionId),
        eq(sessionsTable.sid, secondTargetSessionId),
      ),
    );
  assert.deepEqual(remainingTargetSessions, []);
  const [survivorSession] = await db
    .select({ sid: sessionsTable.sid })
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, survivorSessionId));
  assert.equal(survivorSession?.sid, survivorSessionId);

  const [sharedJourney] = await db
    .select({
      contributedBy: journeysTable.contributedBy,
      contributorName: journeysTable.contributorName,
    })
    .from(journeysTable)
    .where(eq(journeysTable.id, targetJourneyId));
  assert.deepEqual(sharedJourney, {
    contributedBy: null,
    contributorName: "Anonymous",
  });
  const [survivorJourney] = await db
    .select({ contributedBy: journeysTable.contributedBy })
    .from(journeysTable)
    .where(eq(journeysTable.id, survivorJourneyId));
  assert.equal(survivorJourney?.contributedBy, survivorUserId);

  const targetReports = await db
    .select({ id: journeyReportsTable.id })
    .from(journeyReportsTable)
    .where(eq(journeyReportsTable.userId, targetUserId));
  assert.deepEqual(targetReports, []);
  const [survivorReport] = await db
    .select({ content: journeyReportsTable.content })
    .from(journeyReportsTable)
    .where(
      and(
        eq(journeyReportsTable.journeyId, targetJourneyId),
        eq(journeyReportsTable.userId, survivorUserId),
      ),
    );
  assert.equal(survivorReport?.content, "Survivor comment remains on shared route");

  const targetRatings = await db
    .select({ id: journeyRatingsTable.id })
    .from(journeyRatingsTable)
    .where(eq(journeyRatingsTable.userId, targetUserId));
  assert.deepEqual(targetRatings, []);
  const [survivorRating] = await db
    .select({ score: journeyRatingsTable.score })
    .from(journeyRatingsTable)
    .where(
      and(
        eq(journeyRatingsTable.journeyId, targetJourneyId),
        eq(journeyRatingsTable.userId, survivorUserId),
      ),
    );
  assert.equal(survivorRating?.score, 5);
  const targetClaims = await db
    .select({ id: journeyClaimsTable.id })
    .from(journeyClaimsTable)
    .where(eq(journeyClaimsTable.userId, targetUserId));
  assert.deepEqual(targetClaims, []);
  const [survivorClaim] = await db
    .select({ value: journeyClaimsTable.value })
    .from(journeyClaimsTable)
    .where(
      and(
        eq(journeyClaimsTable.journeyId, targetJourneyId),
        eq(journeyClaimsTable.userId, survivorUserId),
      ),
    );
  assert.deepEqual(survivorClaim?.value, { fixture: "survivor" });
  const targetContributions = await db
    .select({ id: journeyContributionsTable.id })
    .from(journeyContributionsTable)
    .where(eq(journeyContributionsTable.contributorId, targetUserId));
  assert.deepEqual(targetContributions, []);
  const [survivorContribution] = await db
    .select({ payload: journeyContributionsTable.payload })
    .from(journeyContributionsTable)
    .where(
      and(
        eq(journeyContributionsTable.journeyId, survivorJourneyId),
        eq(journeyContributionsTable.contributorId, survivorUserId),
      ),
    );
  assert.deepEqual(survivorContribution?.payload, { fixture: "survivor contribution" });
  const targetSearches = await db
    .select({ id: searchEventsTable.id })
    .from(searchEventsTable)
    .where(eq(searchEventsTable.userId, targetUserId));
  assert.deepEqual(targetSearches, []);
  const [survivorSearch] = await db
    .select({ userId: searchEventsTable.userId })
    .from(searchEventsTable)
    .where(eq(searchEventsTable.userId, survivorUserId));
  assert.equal(survivorSearch?.userId, survivorUserId);

  const retainedModerationReports = await db
    .select({
      reporterId: abuseReportsTable.reporterId,
      targetType: abuseReportsTable.targetType,
      targetId: abuseReportsTable.targetId,
      details: abuseReportsTable.details,
      moderatorNotes: abuseReportsTable.moderatorNotes,
      reviewedBy: abuseReportsTable.reviewedBy,
    })
    .from(abuseReportsTable)
    .where(
      and(
        eq(abuseReportsTable.reporterId, survivorUserId),
        eq(abuseReportsTable.journeyId, targetJourneyId),
      ),
    )
    .orderBy(asc(abuseReportsTable.id));
  assert.deepEqual(
    retainedModerationReports.map((report) => ({
      ...report,
      reporterId: report.reporterId,
    })),
    [
      {
        reporterId: survivorUserId,
        targetType: "user",
        targetId: "deleted-user",
        details: null,
        moderatorNotes: null,
        reviewedBy: null,
      },
      {
        reporterId: survivorUserId,
        targetType: "journey",
        targetId: String(targetJourneyId),
        details: null,
        moderatorNotes: null,
        reviewedBy: null,
      },
    ],
  );
  const submittedReports = await db
    .select({ id: abuseReportsTable.id })
    .from(abuseReportsTable)
    .where(eq(abuseReportsTable.reporterId, targetUserId));
  assert.deepEqual(submittedReports, []);

  const [association] = await db
    .select({ resolvedBy: proposedAssociationsTable.resolvedBy })
    .from(proposedAssociationsTable)
    .where(
      and(
        eq(proposedAssociationsTable.candidateJourneyId, targetJourneyId),
        eq(proposedAssociationsTable.parentJourneyId, survivorJourneyId),
      ),
    );
  assert.equal(association?.resolvedBy, null);
});