import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  abuseReportsTable,
  db,
  journeyRatingsTable,
  journeysTable,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { CURRENT_TERMS_VERSION } from "../lib/terms";

const userId = `terms-fixture-${randomUUID()}`;
const sessionId = randomBytes(32).toString("hex");
let journeyId = 0;
let server: Server | undefined;
let baseUrl = "";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep HTML/text responses available to assertion callers.
  }
  return { response, body };
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${sessionId}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

before(async () => {
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.invalid`,
    firstName: "Terms",
    lastName: "Fixture",
    displayName: "Terms Fixture",
  });
  const [journey] = await db
    .insert(journeysTable)
    .values({
      fromCity: "Terms Origin",
      toCity: "Terms Destination",
      departureTime: "08:00",
      arrivalTime: "10:00",
      scheduledDays: "Monday",
      busCompany: "Terms Bus",
      pickupPoint: "Terms Pickup",
      dropoffPoint: "Terms Dropoff",
      price: "10.00",
      contributedBy: userId,
      contributorName: "Terms Fixture",
    })
    .returning({ id: journeysTable.id });
  journeyId = journey.id;
  await db.insert(sessionsTable).values({
    sid: sessionId,
    sess: {
      user: {
        id: userId,
        email: `${userId}@example.invalid`,
        firstName: "Terms",
        lastName: "Fixture",
        profileImageUrl: null,
        displayName: "Terms Fixture",
        lastNameChange: null,
      },
      access_token: "fixture-token",
    },
    expire: new Date(Date.now() + 60 * 60 * 1000),
  });

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
  await db.delete(abuseReportsTable).where(eq(abuseReportsTable.journeyId, journeyId));
  await db.delete(journeyRatingsTable).where(eq(journeyRatingsTable.journeyId, journeyId));
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sessionId));
  await db.delete(journeysTable).where(eq(journeysTable.id, journeyId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("terms status reports missing acceptance and UGC writes return 428 without writing", async () => {
  const status = await request("/api/terms/status", { headers: authHeaders() });
  assert.equal(status.response.status, 200);
  assert.deepEqual(status.body, {
    currentVersion: CURRENT_TERMS_VERSION,
    acceptedVersion: null,
    acceptedAt: null,
    requiresAcceptance: true,
  });

  const before = await db
    .select({ id: journeyRatingsTable.id })
    .from(journeyRatingsTable)
    .where(and(eq(journeyRatingsTable.journeyId, journeyId), eq(journeyRatingsTable.userId, userId)));
  const rejected = await request(`/api/journeys/${journeyId}/rate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ score: 5 }),
  });
  assert.equal(rejected.response.status, 428);
  assert.equal((rejected.body as { code: string }).code, "TERMS_ACCEPTANCE_REQUIRED");
  const after = await db
    .select({ id: journeyRatingsTable.id })
    .from(journeyRatingsTable)
    .where(and(eq(journeyRatingsTable.journeyId, journeyId), eq(journeyRatingsTable.userId, userId)));
  assert.deepEqual(after, before);
});

test("accepting the current version permits a UGC write", async () => {
  const accepted = await request("/api/terms/accept", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ version: CURRENT_TERMS_VERSION }),
  });
  assert.equal(accepted.response.status, 200);
  assert.deepEqual(accepted.body, {
    currentVersion: CURRENT_TERMS_VERSION,
    acceptedVersion: CURRENT_TERMS_VERSION,
    acceptedAt: (accepted.body as { acceptedAt: string }).acceptedAt,
    requiresAcceptance: false,
  });

  const rating = await request(`/api/journeys/${journeyId}/rate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ score: 5 }),
  });
  assert.equal(rating.response.status, 200);
  assert.equal((rating.body as { userRating: number }).userRating, 5);
});

test("an obsolete accepted version is rejected before another write", async () => {
  const obsoleteAcceptance = await request("/api/terms/accept", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ version: "old-version" }),
  });
  assert.equal(obsoleteAcceptance.response.status, 409);

  await db
    .update(usersTable)
    .set({ termsAcceptedVersion: "old-version", termsAcceptedAt: new Date() })
    .where(eq(usersTable.id, userId));

  const rejected = await request(`/api/journeys/${journeyId}/rate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ score: 4 }),
  });
  assert.equal(rejected.response.status, 428);
  const [rating] = await db
    .select({ score: journeyRatingsTable.score })
    .from(journeyRatingsTable)
    .where(and(eq(journeyRatingsTable.journeyId, journeyId), eq(journeyRatingsTable.userId, userId)));
  assert.equal(rating?.score, 5);
});

test("abuse reports remain available without current terms acceptance", async () => {
  const report = await request(`/api/journeys/${journeyId}/abuse-reports`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      targetType: "journey",
      targetId: String(journeyId),
      reason: "misleading",
      details: "Safety exception fixture",
    }),
  });
  assert.equal(report.response.status, 201);
  const [stored] = await db
    .select({ reason: abuseReportsTable.reason })
    .from(abuseReportsTable)
    .where(
      and(
        eq(abuseReportsTable.journeyId, journeyId),
        eq(abuseReportsTable.reporterId, userId),
      ),
    );
  assert.equal(stored?.reason, "misleading");
});
