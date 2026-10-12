import { bigint, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
/** SQL controls immutable parent epochs and version1 creation provenance. */
export const v2TransportCreationDependenciesTable=pgTable("v2_transport_creation_dependencies",{
 creationId:uuid("creation_id").notNull(),subjectId:uuid("subject_id").notNull(),subjectKind:text("subject_kind").notNull(),subjectRevision:bigint("subject_revision",{mode:"bigint"}).notNull(),inputGeneration:bigint("input_generation",{mode:"bigint"}).notNull(),originCreationId:uuid("origin_creation_id").notNull(),originEventId:uuid("origin_event_id").notNull(),
},t=>[primaryKey({columns:[t.creationId,t.subjectId]})]);
export const v2PatternCreationOriginsTable=pgTable("v2_pattern_creation_origins",{
 patternSubjectId:uuid("pattern_subject_id").notNull(),patternVersion:integer("pattern_version").notNull(),creationId:uuid("creation_id").notNull(),eventId:uuid("event_id").notNull(),reviewId:uuid("review_id").notNull(),
},t=>[primaryKey({columns:[t.patternSubjectId,t.patternVersion]})]);
export const routePatternCreationTables=[v2TransportCreationDependenciesTable,v2PatternCreationOriginsTable];
