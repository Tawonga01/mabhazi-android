import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
const instant = (name: string) => timestamp(name, { withTimezone: true });
/** Internal assessment query mappings. SQL computes and validates outcomes. */
export const v2EvidencePoliciesTable = pgTable("v2_evidence_policies", {
  version: text("version").primaryKey(), engine: text("engine").notNull(), scheduleDays: integer("schedule_days").notNull(),
  placeDays: integer("place_days").notNull(), operatorDays: integer("operator_days").notNull(),
  disruptionDays: integer("disruption_days").notNull(), witnessCount: integer("witness_count").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2EvidencePolicyStateTable = pgTable("v2_evidence_policy_state", {
  id: boolean("id").primaryKey().default(true), version: text("version").notNull(), revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
});
export const v2FieldAssessmentsTable = pgTable("v2_field_assessments", {
  id: uuid("id").primaryKey().defaultRandom(), subjectId: uuid("subject_id").notNull(), fieldKey: text("field_key").notNull(),
  scopeKey: text("scope_key").notNull(), scope: jsonb("scope"), revision: bigint("revision", { mode: "bigint" }).notNull(),
  previousId: uuid("previous_id"), subjectRevision: bigint("subject_revision", { mode: "bigint" }).notNull(),
  inputGeneration: bigint("input_generation", { mode: "bigint" }).notNull(), sourceGraphRevision: bigint("source_graph_revision", { mode: "bigint" }).notNull(),
  policyVersion: text("policy_version").notNull(), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"), inputDigest: text("input_digest"),
  assessedAt: instant("assessed_at").notNull(), validUntil: instant("valid_until"), result: jsonb("result"),
  invalidated: boolean("invalidated").notNull().default(false), erased: boolean("erased").notNull().default(false),
});
export const v2AssessmentInputsTable = pgTable("v2_assessment_inputs", {
  id: uuid("id").primaryKey().defaultRandom(), assessmentId: uuid("assessment_id").notNull(), observationId: uuid("observation_id"),
  snapshot: jsonb("snapshot"), erased: boolean("erased").notNull().default(false),
});
export const v2CurrentAssessmentsTable = pgTable("v2_current_assessments", {
  subjectId: uuid("subject_id").notNull(), fieldKey: text("field_key").notNull(), scopeKey: text("scope_key").notNull(),
  assessmentId: uuid("assessment_id").notNull(),
}, t => [primaryKey({ columns: [t.subjectId, t.fieldKey, t.scopeKey] })]);
export const evidenceAssessmentTables = [v2EvidencePoliciesTable, v2EvidencePolicyStateTable, v2FieldAssessmentsTable, v2AssessmentInputsTable, v2CurrentAssessmentsTable];
