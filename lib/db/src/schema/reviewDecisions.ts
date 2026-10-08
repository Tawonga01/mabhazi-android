import { bigint, boolean, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// Internal query mappings. SQL owns constraints, privileges and transactional writes.
const instant = (name: string) => timestamp(name, { withTimezone: true });
export const v2DecisionIdsTable = pgTable("v2_decision_ids", {
  id: uuid("id").primaryKey().defaultRandom(), kind: text("kind", { enum: ["review", "field", "association"] }).notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2ReviewRolesTable = pgTable("v2_review_roles", {
  id: uuid("id").primaryKey().defaultRandom(), userId: varchar("user_id").notNull(),
  role: text("role", { enum: ["reviewer", "administrator"] }).notNull(),
  grantedByUserId: varchar("granted_by_user_id"), grantedAt: instant("granted_at").notNull().defaultNow(),
  revokedAt: instant("revoked_at"), revokedByUserId: varchar("revoked_by_user_id"), reasonCode: text("reason_code").notNull(),
});
export const v2RoleEventsTable = pgTable("v2_role_events", {
  id: uuid("id").primaryKey().defaultRandom(), targetUserId: varchar("target_user_id"),
  role: text("role", { enum: ["reviewer", "administrator"] }).notNull(),
  action: text("action", { enum: ["grant", "revoke"] }).notNull(), actorUserId: varchar("actor_user_id"),
  reasonCode: text("reason_code").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2ReviewCasesTable = pgTable("v2_review_cases", {
  id: uuid("id").primaryKey().defaultRandom(), subjectId: uuid("subject_id").notNull(), subjectKind: text("subject_kind").notNull(),
  fieldKey: text("field_key"), scopeKey: text("scope_key"),
  kind: text("kind", { enum: ["identity", "correction", "conflict", "moderation", "affiliation"] }).notNull(),
  state: text("state", { enum: ["open", "in_review", "resolved", "reopened", "dismissed"] }).notNull().default("open"),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(1n), openedAt: instant("opened_at").notNull().defaultNow(),
  lastDecisionId: uuid("last_decision_id"), candidateId: uuid("candidate_id"),
});
export const v2ReviewDecisionsTable = pgTable("v2_review_decisions", {
  id: uuid("id").primaryKey(), decisionKind: text("decision_kind", { enum: ["review"] }).notNull().default("review"),
  caseId: uuid("case_id").notNull(),
  action: text("action", { enum: ["accept", "reject", "needs_context", "hide", "restore", "reverse", "verify_affiliation", "revoke_affiliation"] }).notNull(),
  expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
  expectedSubjectRevision: bigint("expected_subject_revision", { mode: "bigint" }).notNull(),
  reasonCode: text("reason_code").notNull(), privateReason: text("private_reason"), actorUserId: varchar("actor_user_id"),
  actorErased: boolean("actor_erased").notNull().default(false), evidenceErased: boolean("evidence_erased").notNull().default(false),
  createdAt: instant("created_at").notNull().defaultNow(), reversesDecisionId: uuid("reverses_decision_id"), policyVersion: text("policy_version").notNull(),
});
export const v2ReviewDecisionEvidenceTable = pgTable("v2_review_decision_evidence", {
  decisionId: uuid("decision_id").notNull(), observationId: uuid("observation_id").notNull(),
}, t => [primaryKey({ columns: [t.decisionId, t.observationId] })]);
export const reviewTables = [v2DecisionIdsTable, v2ReviewRolesTable, v2RoleEventsTable, v2ReviewCasesTable, v2ReviewDecisionsTable, v2ReviewDecisionEvidenceTable];
