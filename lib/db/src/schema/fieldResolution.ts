import { bigint, boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const v2FieldReviewThreadsTable = pgTable("v2_field_review_threads", {
  subjectId: uuid("subject_id").notNull(), fieldKey: text("field_key").notNull(), scopeKey: text("scope_key").notNull(), caseId: uuid("case_id").notNull(),
}, t => [primaryKey({ columns: [t.subjectId,t.fieldKey,t.scopeKey] })]);
export const v2FieldResolutionsTable = pgTable("v2_field_resolutions", {
  reviewId: uuid("review_id").primaryKey(), assessmentId: uuid("assessment_id").notNull(), chosenObservationId: uuid("chosen_observation_id"),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest"), erased: boolean("erased").notNull().default(false),
  receiptRedacted: boolean("receipt_redacted").notNull().default(false),
});
export const v2FieldResolutionInputsTable = pgTable("v2_field_resolution_inputs", {
  id: uuid("id").primaryKey().defaultRandom(), reviewId: uuid("review_id").notNull(), observationId: uuid("observation_id"),
  rejected: boolean("rejected").notNull(), evidenceDigest: text("evidence_digest"), erased: boolean("erased").notNull().default(false),
});
export const v2FieldCaseEventsTable = pgTable("v2_field_case_events", {
  id: uuid("id").primaryKey().defaultRandom(), caseId: uuid("case_id").notNull(), assessmentId: uuid("assessment_id").notNull(),
  caseRevision: bigint("case_revision",{mode:"bigint"}).notNull(), action: text("action",{enum:["open","reopen"]}).notNull(),
  reasonCode: text("reason_code").notNull(), createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const fieldResolutionTables = [v2FieldReviewThreadsTable,v2FieldResolutionsTable,v2FieldResolutionInputsTable,v2FieldCaseEventsTable];
