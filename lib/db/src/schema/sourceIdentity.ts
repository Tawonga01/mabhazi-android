import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** SQL owns review, projection, erasure and access rules. No client writes. */
export const v2SourceGraphTable = pgTable("v2_source_graph", {
  id: boolean("id").primaryKey().default(true), revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
});
export const v2SourceCasesTable = pgTable("v2_source_cases", {
  id: uuid("id").primaryKey().defaultRandom(), sourceA: uuid("source_a"), sourceB: uuid("source_b"),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(1n), lastDecisionId: uuid("last_decision_id"),
  erased: boolean("erased").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2SourceDecisionsTable = pgTable("v2_source_decisions", {
  id: uuid("id").primaryKey(), registryKind: text("registry_kind", { enum: ["source"] }).notNull().default("source"),
  caseId: uuid("case_id").notNull(),
  action: text("action", { enum: ["same_origin", "suspected_same_origin", "separate", "reverse"] }).notNull(),
  expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
  expectedGraphRevision: bigint("expected_graph_revision", { mode: "bigint" }).notNull(),
  previousDecisionId: uuid("previous_decision_id"), reversesDecisionId: uuid("reverses_decision_id"),
  actorUserId: varchar("actor_user_id"), actorErased: boolean("actor_erased").notNull().default(false),
  evidenceErased: boolean("evidence_erased").notNull().default(false), requestId: uuid("request_id").notNull(),
  reasonCode: text("reason_code").notNull(), privateReason: text("private_reason"), policyVersion: text("policy_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2SourceRelationsTable = pgTable("v2_source_relations", {
  caseId: uuid("case_id").primaryKey(), sourceA: uuid("source_a").notNull(), sourceB: uuid("source_b").notNull(),
  decisionId: uuid("decision_id").notNull(), relation: text("relation", { enum: ["same_origin", "suspected_same_origin"] }).notNull(),
});
export const sourceIdentityTables = [v2SourceGraphTable, v2SourceCasesTable, v2SourceDecisionsTable, v2SourceRelationsTable];
