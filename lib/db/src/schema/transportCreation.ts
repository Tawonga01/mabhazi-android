import { bigint, boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
/** Internal query mappings only. SQL controls exact proposal/origin/history. */
export const v2TransportCreationsTable=pgTable("v2_transport_creations",{
 id:uuid("id").primaryKey().defaultRandom(),sourceSubjectId:uuid("source_subject_id").notNull(),targetSubjectId:uuid("target_subject_id").notNull(),targetKind:text("target_kind").notNull(),caseId:uuid("case_id").notNull(),actorUserId:varchar("actor_user_id"),observationId:uuid("observation_id"),fieldKey:text("field_key").notNull(),
 expectedSourceRevision:bigint("expected_source_revision",{mode:"bigint"}).notNull(),expectedGeneration:bigint("expected_generation",{mode:"bigint"}).notNull(),observationRevision:bigint("observation_revision",{mode:"bigint"}),targetRevision:bigint("target_revision",{mode:"bigint"}),sourceSnapshot:jsonb("source_snapshot"),desiredSnapshot:jsonb("desired_snapshot"),requestId:uuid("request_id").notNull(),requestDigest:text("request_digest"),erased:boolean("erased").notNull().default(false),policyVersion:text("policy_version").notNull().default("transport-creation/1"),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
});
export const v2TransportCreationEventsTable=pgTable("v2_transport_creation_events",{
 id:uuid("id").primaryKey().defaultRandom(),creationId:uuid("creation_id").notNull(),revision:bigint("revision",{mode:"bigint"}).notNull(),previousEventId:uuid("previous_event_id"),action:text("action").notNull(),actorUserId:varchar("actor_user_id"),reviewId:uuid("review_id"),requestId:uuid("request_id"),requestDigest:text("request_digest"),causeId:uuid("cause_id"),sourceRevision:bigint("source_revision",{mode:"bigint"}).notNull(),sourceGeneration:bigint("source_generation",{mode:"bigint"}).notNull(),projectionChanged:boolean("projection_changed").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
});
export const v2TransportCreationOriginsTable=pgTable("v2_transport_creation_origins",{
 subjectId:uuid("subject_id").primaryKey(),creationId:uuid("creation_id").notNull(),eventId:uuid("event_id").notNull(),reviewId:uuid("review_id").notNull(),initialRevision:bigint("initial_revision",{mode:"bigint"}).notNull(),initialGeneration:bigint("initial_generation",{mode:"bigint"}).notNull(),snapshot:jsonb("snapshot"),erased:boolean("erased").notNull().default(false),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
});
export const v2TransportCreationHeadsTable=pgTable("v2_transport_creation_heads",{
 subjectId:uuid("subject_id").primaryKey(),creationId:uuid("creation_id").notNull(),eventId:uuid("event_id").notNull(),
});
export const transportCreationTables=[v2TransportCreationsTable,v2TransportCreationEventsTable,v2TransportCreationOriginsTable,v2TransportCreationHeadsTable];
