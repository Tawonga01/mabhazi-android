import { Router, type IRouter, type Request, type Response } from "express";
import { db, journeysTable, journeyStopsTable, proposedAssociationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireCurrentTerms } from "../middlewares/termsMiddleware";

const router: IRouter = Router();

router.get("/associations/pending", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const proposals = await db
    .select({
      id: proposedAssociationsTable.id,
      candidateJourneyId: proposedAssociationsTable.candidateJourneyId,
      parentJourneyId: proposedAssociationsTable.parentJourneyId,
      proposedStopCity: proposedAssociationsTable.proposedStopCity,
      proposedStopTime: proposedAssociationsTable.proposedStopTime,
      relationType: proposedAssociationsTable.relationType,
      confidenceScore: proposedAssociationsTable.confidenceScore,
      evidence: proposedAssociationsTable.evidence,
      status: proposedAssociationsTable.status,
      proposedAt: proposedAssociationsTable.proposedAt,
      resolvedAt: proposedAssociationsTable.resolvedAt,
      parentFromCity: journeysTable.fromCity,
      parentToCity: journeysTable.toCity,
      parentDepartureTime: journeysTable.departureTime,
      parentArrivalTime: journeysTable.arrivalTime,
      parentBusCompany: journeysTable.busCompany,
    })
    .from(proposedAssociationsTable)
    .innerJoin(journeysTable, eq(journeysTable.id, proposedAssociationsTable.parentJourneyId))
    .where(
      and(
        eq(journeysTable.contributedBy, userId),
        eq(proposedAssociationsTable.status, "pending"),
      ),
    )
    .orderBy(proposedAssociationsTable.proposedAt);

  res.json({ proposals });
});

router.get("/associations/resolved", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proposals = await db
    .select({
      id: proposedAssociationsTable.id,
      candidateJourneyId: proposedAssociationsTable.candidateJourneyId,
      parentJourneyId: proposedAssociationsTable.parentJourneyId,
      proposedStopCity: proposedAssociationsTable.proposedStopCity,
      proposedStopTime: proposedAssociationsTable.proposedStopTime,
      relationType: proposedAssociationsTable.relationType,
      confidenceScore: proposedAssociationsTable.confidenceScore,
      evidence: proposedAssociationsTable.evidence,
      status: proposedAssociationsTable.status,
      proposedAt: proposedAssociationsTable.proposedAt,
      resolvedAt: proposedAssociationsTable.resolvedAt,
      parentFromCity: journeysTable.fromCity,
      parentToCity: journeysTable.toCity,
      parentDepartureTime: journeysTable.departureTime,
      parentArrivalTime: journeysTable.arrivalTime,
      parentBusCompany: journeysTable.busCompany,
    })
    .from(proposedAssociationsTable)
    .innerJoin(journeysTable, eq(journeysTable.id, proposedAssociationsTable.parentJourneyId))
    .where(
      and(
        eq(journeysTable.contributedBy, req.user.id),
        eq(proposedAssociationsTable.status, "confirmed"),
      ),
    )
    .orderBy(proposedAssociationsTable.resolvedAt);

  res.json({ proposals });
});

router.post("/associations/:id/confirm", requireCurrentTerms, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proposalId = parseInt(req.params["id"] as string, 10);
  if (isNaN(proposalId)) {
    res.status(400).json({ error: "Invalid proposal ID" });
    return;
  }

  const [proposal] = await db
    .select({
      id: proposedAssociationsTable.id,
      parentJourneyId: proposedAssociationsTable.parentJourneyId,
      proposedStopCity: proposedAssociationsTable.proposedStopCity,
      proposedStopTime: proposedAssociationsTable.proposedStopTime,
      status: proposedAssociationsTable.status,
      parentContributedBy: journeysTable.contributedBy,
    })
    .from(proposedAssociationsTable)
    .innerJoin(journeysTable, eq(journeysTable.id, proposedAssociationsTable.parentJourneyId))
    .where(eq(proposedAssociationsTable.id, proposalId));

  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (proposal.parentContributedBy !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (proposal.status !== "pending") {
    res.status(409).json({ error: "Proposal already resolved" });
    return;
  }

  const [seq] = await db
    .select({ max: sql<number>`COALESCE(MAX(sequence), 0)` })
    .from(journeyStopsTable)
    .where(eq(journeyStopsTable.journeyId, proposal.parentJourneyId));

  await db.insert(journeyStopsTable).values({
    journeyId: proposal.parentJourneyId,
    city: proposal.proposedStopCity,
    arrivalTime: proposal.proposedStopTime ?? null,
    departureTime: null,
    sequence: (seq?.max ?? 0) + 1,
    sourceAssociationId: proposalId,
  });

  await db
    .update(proposedAssociationsTable)
    .set({
      status: "confirmed",
      resolvedAt: new Date(),
      resolvedBy: req.user.id,
    })
    .where(eq(proposedAssociationsTable.id, proposalId));

  res.json({ success: true });
});

router.post("/associations/:id/reject", requireCurrentTerms, async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proposalId = parseInt(req.params["id"] as string, 10);
  if (isNaN(proposalId)) {
    res.status(400).json({ error: "Invalid proposal ID" });
    return;
  }

  const [proposal] = await db
    .select({
      id: proposedAssociationsTable.id,
      status: proposedAssociationsTable.status,
      parentContributedBy: journeysTable.contributedBy,
    })
    .from(proposedAssociationsTable)
    .innerJoin(journeysTable, eq(journeysTable.id, proposedAssociationsTable.parentJourneyId))
    .where(eq(proposedAssociationsTable.id, proposalId));

  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (proposal.parentContributedBy !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (proposal.status !== "pending") {
    res.status(409).json({ error: "Proposal already resolved" });
    return;
  }

  await db
    .update(proposedAssociationsTable)
    .set({
      status: "rejected",
      resolvedAt: new Date(),
      resolvedBy: req.user.id,
    })
    .where(eq(proposedAssociationsTable.id, proposalId));

  res.json({ success: true });
});

router.post("/associations/:id/reverse", requireCurrentTerms, async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proposalId = parseInt(req.params["id"] as string, 10);
  if (isNaN(proposalId)) {
    res.status(400).json({ error: "Invalid proposal ID" });
    return;
  }

  const [proposal] = await db
    .select({
      id: proposedAssociationsTable.id,
      status: proposedAssociationsTable.status,
      parentContributedBy: journeysTable.contributedBy,
    })
    .from(proposedAssociationsTable)
    .innerJoin(journeysTable, eq(journeysTable.id, proposedAssociationsTable.parentJourneyId))
    .where(eq(proposedAssociationsTable.id, proposalId));

  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (proposal.parentContributedBy !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (proposal.status !== "confirmed") {
    res.status(409).json({ error: "Only confirmed proposals can be reversed" });
    return;
  }

  await db
    .delete(journeyStopsTable)
    .where(eq(journeyStopsTable.sourceAssociationId, proposalId));

  await db
    .update(proposedAssociationsTable)
    .set({
      status: "reversed",
      resolvedAt: new Date(),
      resolvedBy: req.user.id,
    })
    .where(eq(proposedAssociationsTable.id, proposalId));

  res.json({ success: true });
});

export default router;
