import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Private affiliation evidence and source assertions. SQL owns all transitions. */
export const v2AffiliationClaimsTable = pgTable("v2_affiliation_claims", {
  id: uuid("id").primaryKey().defaultRandom(), caseId: uuid("case_id").notNull(), operatorSubjectId: uuid("operator_subject_id").notNull(),
  claimantUserId: varchar("claimant_user_id"), claimedRole: text("claimed_role"), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"),
  erased: boolean("erased").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2AffiliationProofsTable = pgTable("v2_affiliation_proofs", {
  id: uuid("id").primaryKey().defaultRandom(), claimId: uuid("claim_id").notNull(), ownerUserId: varchar("owner_user_id"),
  kind: text("kind", { enum: ["authorization_document", "independent_confirmation"] }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  privateReference: text("private_reference"), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"),
  erased: boolean("erased").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2AffiliationResolutionsTable = pgTable("v2_affiliation_resolutions", {
  reviewId: uuid("review_id").primaryKey(), claimId: uuid("claim_id").notNull(), validUntil: timestamp("valid_until", { withTimezone: true }),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"), evidenceErased: boolean("evidence_erased").notNull().default(false),
  receiptRedacted: boolean("receipt_redacted").notNull().default(false),
});
export const v2AffiliationResolutionProofsTable = pgTable("v2_affiliation_resolution_proofs", {
  id: uuid("id").primaryKey().defaultRandom(), reviewId: uuid("review_id").notNull(), proofId: uuid("proof_id"), erased: boolean("erased").notNull().default(false),
});
export const v2SourceIssuerEventsTable = pgTable("v2_source_issuer_events", {
  id: uuid("id").primaryKey().defaultRandom(), sourceId: uuid("source_id"), operatorSubjectId: uuid("operator_subject_id"), affiliationReviewId: uuid("affiliation_review_id"),
  revision: bigint("revision", { mode: "bigint" }).notNull(), previousEventId: uuid("previous_event_id"),
  action: text("action", { enum: ["claim", "withdraw"] }).notNull(), actorUserId: varchar("actor_user_id"), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"),
  erased: boolean("erased").notNull().default(false), receiptRedacted: boolean("receipt_redacted").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2SourceIssuersTable = pgTable("v2_source_issuers", {
  sourceId: uuid("source_id").primaryKey(), eventId: uuid("event_id").notNull(), revision: bigint("revision", { mode: "bigint" }).notNull(),
});
export const affiliationIssuerTables = [v2AffiliationClaimsTable, v2AffiliationProofsTable, v2AffiliationResolutionsTable, v2AffiliationResolutionProofsTable, v2SourceIssuerEventsTable, v2SourceIssuersTable];
