import { sql } from "drizzle-orm";
import { bigint, boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Query mappings for the additive intake foundation. Versioned SQL is authoritative
 * for constraints, deferred cyclic FKs, generated references, triggers and RLS.
 * Do not use drizzle-kit push to apply this schema; use the migration runner.
 * JSON here is internal storage, not an API validator or public response type. */
const instant = (name: string) => timestamp(name, { withTimezone: true });
const revision = (name: string) => bigint(name, { mode: "bigint" }).notNull().default(1n);
const object = (name: string) => jsonb(name).$type<Record<string, unknown>>();

export const v2SubjectsTable = pgTable("v2_subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["lead", "operator", "route", "stop", "pattern", "service_plan", "run", "actual_journey"] }).notNull(),
  revision: revision("revision"), inputGeneration: revision("input_generation"),
  lifecycle: text("lifecycle", { enum: ["active", "retired"] }).notNull().default("active"),
  createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2OperatorsTable = pgTable("v2_operators", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["operator"] }).notNull().default("operator"),
  displayName: text("display_name").notNull(), countryCode: text("country_code"),
  affiliationStatus: text("affiliation_status", { enum: ["unverified"] }).notNull().default("unverified"),
});
export const v2CorridorsTable = pgTable("v2_corridors", {
  id: uuid("id").primaryKey().defaultRandom(),
  originCityId: integer("origin_city_id").notNull(), destinationCityId: integer("destination_city_id").notNull(),
});
export const v2LeadsTable = pgTable("v2_leads", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["lead"] }).notNull().default("lead"),
  intakeKind: text("intake_kind", { enum: ["community", "legacy"] }).notNull().default("community"),
  corridorId: uuid("corridor_id"), reportedDepartureSeconds: integer("reported_departure_seconds"),
  operatorSubjectId: uuid("operator_subject_id"), operatorName: text("operator_name"),
  resolvedStatus: text("resolved_status", { enum: ["unresolved"] }).notNull().default("unresolved"),
  initialContributionId: uuid("initial_contribution_id"), attributionErased: boolean("attribution_erased").notNull().default(false),
});
export const v2ContributionsTable = pgTable("v2_contributions", {
  id: uuid("id").primaryKey().defaultRandom(), userId: varchar("user_id").notNull(),
  clientSubmissionId: uuid("client_submission_id").notNull(),
  schemaVersion: text("schema_version", { enum: ["1.0"] }).notNull(),
  entrySurface: text("entry_surface", { enum: ["contribute_tab", "search_empty", "search_result", "route_detail", "own_contribution", "reviewer_context", "legacy_import"] }).notNull(),
  semanticHash: text("semantic_hash").notNull(), payload: object("payload").notNull(),
  originalSubjectId: uuid("original_subject_id").notNull(), submittedAt: instant("submitted_at").notNull().defaultNow(),
});
export const v2ReceiptsTable = pgTable("v2_receipts", {
  userId: varchar("user_id").notNull(), clientSubmissionId: uuid("client_submission_id").notNull(),
  contributionId: uuid("contribution_id").notNull(), semanticHash: text("semantic_hash").notNull(),
  initialResponse: object("initial_response").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.clientSubmissionId] })]);
export const v2ObservationsTable = pgTable("v2_observations", {
  id: uuid("id").primaryKey().defaultRandom(), contributionId: uuid("contribution_id").notNull(),
  originalSubjectId: uuid("original_subject_id").notNull(),
  fieldKey: text("field_key", { enum: ["operator.reported", "departure.reported", "boarding.pickup", "alighting.dropoff", "fare.paid", "fare.quoted", "fare.advertised"] }).notNull(),
  schemaVersion: text("schema_version", { enum: ["1.0"] }).notNull().default("1.0"),
  value: object("value").notNull(), scope: object("scope").notNull().default({}),
  operatorRef: uuid("operator_ref").generatedAlwaysAs(sql`CASE WHEN field_key='operator.reported' THEN (value->>'id')::uuid END`),
  placeCityRef: integer("place_city_ref").generatedAlwaysAs(sql`CASE WHEN field_key IN ('boarding.pickup','alighting.dropoff') THEN (value->>'cityId')::integer END`),
  fareOriginRef: integer("fare_origin_ref").generatedAlwaysAs(sql`CASE WHEN field_key IN ('fare.paid','fare.quoted','fare.advertised') THEN (scope->'segment'->>'originCityId')::integer END`),
  fareDestinationRef: integer("fare_destination_ref").generatedAlwaysAs(sql`CASE WHEN field_key IN ('fare.paid','fare.quoted','fare.advertised') THEN (scope->'segment'->>'destinationCityId')::integer END`),
  scopeKey: text("scope_key").notNull(), valueKey: text("value_key").notNull(),
  knowledgeBasis: text("knowledge_basis", { enum: ["travelled", "saw_operating", "observed_sign", "operator_statement", "heard_from_other", "unprovided", "legacy_import"] }).notNull().default("unprovided"),
  observedFrom: date("observed_from"), observedTo: date("observed_to"),
  effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"),
  submittedAt: instant("submitted_at").notNull().defaultNow(), supersedesId: uuid("supersedes_id"),
});
export const v2ObservationStatesTable = pgTable("v2_observation_states", {
  observationId: uuid("observation_id").primaryKey(), revision: revision("revision"),
  status: text("status", { enum: ["active", "superseded", "withdrawn", "hidden"] }).notNull().default("active"),
  reasonCode: text("reason_code"), updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const v2SourcesTable = pgTable("v2_sources", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: varchar("owner_user_id").notNull(),
  kind: text("kind", { enum: ["firsthand", "document", "operator_statement", "hearsay", "unprovided", "legacy_import"] }).notNull(),
  sourceDate: date("source_date"), privateReference: text("private_reference"),
  normalisedDocumentFingerprint: text("normalised_document_fingerprint"),
  visibility: text("visibility", { enum: ["public_metadata", "review_only"] }).notNull().default("review_only"),
  createdAt: instant("created_at").notNull().defaultNow(),
});
export const v2ObservationSourcesTable = pgTable("v2_observation_sources", {
  observationId: uuid("observation_id").notNull(), sourceId: uuid("source_id").notNull(),
  relation: text("relation", { enum: ["direct", "cites"] }).notNull().default("direct"),
}, t => [primaryKey({ columns: [t.observationId, t.sourceId] })]);
export const v2JobsTable = pgTable("v2_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["normalise", "associate", "assess", "refresh_tasks", "rebuild_legacy", "erase_recompute"] }).notNull(),
  subjectId: uuid("subject_id").notNull(), contributionId: uuid("contribution_id"),
  requestedGeneration: bigint("requested_generation", { mode: "bigint" }).notNull(),
  policyVersion: text("policy_version").notNull(), triggerId: uuid("trigger_id").notNull(),
  state: text("state", { enum: ["pending", "leased", "done", "failed", "superseded"] }).notNull().default("pending"),
  availableAt: instant("available_at").notNull().defaultNow(), leaseUntil: instant("lease_until"), leaseToken: uuid("lease_token"),
  attempt: integer("attempt").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(8),
  lastErrorCode: text("last_error_code"), createdAt: instant("created_at").notNull().defaultNow(), completedAt: instant("completed_at"),
});
export const v2JobEffectsTable = pgTable("v2_job_effects", {
  jobId: uuid("job_id").notNull(), stage: text("stage").notNull(), inputDigest: text("input_digest").notNull(),
  resultRevision: bigint("result_revision", { mode: "bigint" }).notNull(), committedAt: instant("committed_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.jobId, t.stage, t.inputDigest] })]);

export const intakeTables = [v2SubjectsTable, v2OperatorsTable, v2CorridorsTable, v2LeadsTable,
  v2ContributionsTable, v2ReceiptsTable, v2ObservationsTable, v2ObservationStatesTable,
  v2SourcesTable, v2ObservationSourcesTable, v2JobsTable, v2JobEffectsTable] as const;
