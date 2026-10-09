import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Query mappings only: versioned SQL owns identity, history and access rules. */
export const v2TargetAssignmentsTable = pgTable("v2_target_assignments", {
  id: uuid("id").primaryKey().defaultRandom(), observationId: uuid("observation_id").notNull(),
  targetSubjectId: uuid("target_subject_id").notNull(), associationDecisionId: uuid("association_decision_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  expectedObservationRevision: bigint("expected_observation_revision", { mode: "bigint" }).notNull(),
  expectedOriginalRevision: bigint("expected_original_revision", { mode: "bigint" }).notNull(),
  expectedTargetRevision: bigint("expected_target_revision", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2TargetEventsTable = pgTable("v2_target_events", {
  id: uuid("id").primaryKey().defaultRandom(), observationId: uuid("observation_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  action: text("action", { enum: ["baseline", "assign", "invalidate"] }).notNull(),
  assignmentId: uuid("assignment_id"), previousEventId: uuid("previous_event_id"),
  causeAssociationDecisionId: uuid("cause_association_decision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const v2ObservationTargetsTable = pgTable("v2_observation_targets", {
  observationId: uuid("observation_id").primaryKey(), revision: bigint("revision", { mode: "bigint" }).notNull(),
  assignmentId: uuid("assignment_id"), latestEventId: uuid("latest_event_id").notNull(),
});
export const observationTargetTables = [v2TargetAssignmentsTable, v2TargetEventsTable, v2ObservationTargetsTable];
