import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Internal mappings. SQL owns proposal binding, history, erasure and writes. */
export const v2TransportEditsTable = pgTable("v2_transport_edits", {
  id: uuid("id").primaryKey().defaultRandom(), subjectId: uuid("subject_id").notNull(), caseId: uuid("case_id").notNull(),
  actorUserId: varchar("actor_user_id"), observationId: uuid("observation_id"), fieldKey: text("field_key").notNull(),
  expectedSubjectRevision: bigint("expected_subject_revision", { mode: "bigint" }).notNull(), expectedGeneration: bigint("expected_generation", { mode: "bigint" }).notNull(),
  observationRevision: bigint("observation_revision", { mode: "bigint" }), targetRevision: bigint("target_revision", { mode: "bigint" }),
  beforeSnapshot: jsonb("before_snapshot"), afterSnapshot: jsonb("after_snapshot"), observationScope: jsonb("observation_scope"),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"), erased: boolean("erased").notNull().default(false),
  policyVersion: text("policy_version").notNull().default("transport-writers/1"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const v2TransportEditEventsTable = pgTable("v2_transport_edit_events", {
  id: uuid("id").primaryKey().defaultRandom(), editId: uuid("edit_id").notNull(), revision: bigint("revision", { mode: "bigint" }).notNull(),
  previousEventId: uuid("previous_event_id"), action: text("action").notNull(), actorUserId: varchar("actor_user_id"), reviewId: uuid("review_id"),
  requestId: uuid("request_id"), requestDigest: text("request_digest"), causeId: uuid("cause_id"),
  resultingRevision: bigint("resulting_revision", { mode: "bigint" }).notNull(), resultingGeneration: bigint("resulting_generation", { mode: "bigint" }).notNull(),
  projectionChanged: boolean("projection_changed").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const v2TransportEditHeadsTable = pgTable("v2_transport_edit_heads", {
  subjectId: uuid("subject_id").primaryKey(), editId: uuid("edit_id").notNull(), eventId: uuid("event_id").notNull(),
});
export const v2PatternVersionOriginsTable = pgTable("v2_pattern_version_origins", {
  patternSubjectId: uuid("pattern_subject_id").notNull(), patternVersion: integer("pattern_version").notNull(), editId: uuid("edit_id").notNull(), reviewId: uuid("review_id").notNull(),
}, t => [primaryKey({ columns: [t.patternSubjectId, t.patternVersion] })]);
export const transportWriterTables = [v2TransportEditsTable, v2TransportEditEventsTable, v2TransportEditHeadsTable, v2PatternVersionOriginsTable];
