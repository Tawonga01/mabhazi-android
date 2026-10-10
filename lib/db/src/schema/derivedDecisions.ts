import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Query mappings only; SQL owns lineage, access, validation and erasure.
const instant = (n: string) => timestamp(n, { withTimezone: true });
const count = (n: string) => bigint(n, { mode: "bigint" });
const object = (n: string) => jsonb(n).$type<Record<string, unknown>>();
export const v2AssociationCandidatesTable = pgTable("v2_association_candidates", {
  id: uuid("id").primaryKey().defaultRandom(), fromSubjectId: uuid("from_subject_id").notNull(), fromKind: text("from_kind").notNull(),
  toSubjectId: uuid("to_subject_id").notNull(), toKind: text("to_kind").notNull(), relation: text("relation").notNull(), evidenceDigest: text("evidence_digest"),
  reasonCodes: text("reason_codes").array().notNull(), ruleVersion: text("rule_version").notNull(),
  sourceRevision: count("source_revision").notNull(), targetRevision: count("target_revision").notNull(),
  segmentStart: integer("segment_start"), segmentEnd: integer("segment_end"),
  state: text("state", { enum: ["pending", "decided", "obsolete"] }).notNull().default("pending"),
  revision: count("revision").notNull().default(1n), evidenceErased: boolean("evidence_erased").notNull().default(false),
  lastDecisionId: uuid("last_decision_id"), createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2CandidateEvidenceTable = pgTable("v2_candidate_evidence", {
  candidateId: uuid("candidate_id").notNull(), observationId: uuid("observation_id").notNull(),
}, t => [primaryKey({ columns: [t.candidateId, t.observationId] })]);
export const v2AssociationDecisionsTable = pgTable("v2_association_decisions", {
  id: uuid("id").primaryKey(), decisionKind: text("decision_kind", { enum: ["association"] }).notNull().default("association"),
  candidateId: uuid("candidate_id").notNull(), action: text("action", { enum: ["accept", "reject", "reverse", "defer"] }).notNull(),
  previousDecisionId: uuid("previous_decision_id"), actorKind: text("actor_kind", { enum: ["system", "reviewer"] }).notNull(),
  reviewerDecisionId: uuid("reviewer_decision_id"), reasonCode: text("reason_code").notNull(), policyVersion: text("policy_version").notNull(),
  expectedFromRevision: count("expected_from_revision").notNull(), expectedToRevision: count("expected_to_revision").notNull(),
  expectedCandidateRevision: count("expected_candidate_revision").notNull(),
  invalidated: boolean("invalidated").notNull().default(false), erased: boolean("erased").notNull().default(false), createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2AssociationLinksTable = pgTable("v2_association_links", {
  candidateId: uuid("candidate_id").primaryKey(), fromSubjectId: uuid("from_subject_id").notNull(), toSubjectId: uuid("to_subject_id").notNull(),
  relation: text("relation").notNull(), decisionId: uuid("decision_id").notNull(),
});
export const v2FieldDecisionsTable = pgTable("v2_field_decisions", {
  id: uuid("id").primaryKey(), decisionKind: text("decision_kind", { enum: ["field"] }).notNull().default("field"),
  subjectId: uuid("subject_id").notNull(), fieldKey: text("field_key").notNull(), scopeKey: text("scope_key").notNull(), scope: object("scope"),
  revision: count("revision").notNull(), expectedSubjectRevision: count("expected_subject_revision").notNull(), inputGeneration: count("input_generation").notNull(),
  selectedValue: object("selected_value"), supportStatus: text("support_status", { enum: ["unknown", "reported", "corroborated"] }).notNull(),
  disputeStatus: text("dispute_status", { enum: ["none", "open", "resolved"] }).notNull(),
  freshness: text("freshness", { enum: ["unknown", "current", "recheck_due", "expired"] }).notNull(),
  publication: text("publication", { enum: ["provisional", "selected", "withheld"] }).notNull(),
  reasonCodes: text("reason_codes").array().notNull(), policyVersion: text("policy_version").notNull(), inputDigest: text("input_digest"),
  assessedAt: instant("assessed_at").notNull().defaultNow(), nextRecheckAt: instant("next_recheck_at"),
  reviewerDecisionId: uuid("reviewer_decision_id"), previousDecisionId: uuid("previous_decision_id"),
  assessmentId: uuid("assessment_id"), resolutionId: uuid("resolution_id"), reviewBlocked: boolean("review_blocked").notNull().default(false),
  invalidated: boolean("invalidated").notNull().default(false), erased: boolean("erased").notNull().default(false),
});
export const v2FieldDecisionEvidenceTable = pgTable("v2_field_decision_evidence", {
  id: uuid("id").primaryKey().defaultRandom(), fieldDecisionId: uuid("field_decision_id").notNull(), observationId: uuid("observation_id"),
  disposition: text("disposition", { enum: ["supporting", "conflicting", "excluded"] }).notNull(), reasonCode: text("reason_code").notNull(),
  erased: boolean("erased").notNull().default(false),
});
export const v2CurrentFieldsTable = pgTable("v2_current_fields", {
  subjectId: uuid("subject_id").notNull(), fieldKey: text("field_key").notNull(), scopeKey: text("scope_key").notNull(),
  fieldDecisionId: uuid("field_decision_id").notNull(), generation: count("generation").notNull(),
}, t => [primaryKey({ columns: [t.subjectId, t.fieldKey, t.scopeKey] })]);
export const v2SubjectRevisionsTable = pgTable("v2_subject_revisions", {
  subjectId: uuid("subject_id").notNull(), subjectKind: text("subject_kind").notNull(), revision: count("revision").notNull(), snapshot: object("snapshot"),
  originKind: text("origin_kind", { enum: ["decision", "contribution", "erased"] }).notNull(), decisionId: uuid("decision_id"),
  decisionKind: text("decision_kind", { enum: ["field", "association"] }), initialContributionId: uuid("initial_contribution_id"),
  recordedAt: instant("recorded_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.subjectId, t.revision] })]);
export const derivedTables = [v2AssociationCandidatesTable, v2CandidateEvidenceTable, v2AssociationDecisionsTable, v2AssociationLinksTable,
  v2FieldDecisionsTable, v2FieldDecisionEvidenceTable, v2CurrentFieldsTable, v2SubjectRevisionsTable];
