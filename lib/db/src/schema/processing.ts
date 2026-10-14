import { bigint, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Internal derived projection. Versioned SQL owns constraints, access and erasure.
export const v2NormalisedLeadsTable = pgTable('v2_normalised_leads', {
  subjectId: uuid('subject_id').primaryKey(), contributionId: uuid('contribution_id').notNull(),
  operatorObservationId: uuid('operator_observation_id').notNull(), departureObservationId: uuid('departure_observation_id').notNull(),
  inputGeneration: bigint('input_generation', { mode: 'bigint' }).notNull(), policyVersion: text('policy_version').notNull(),
  corridorId: uuid('corridor_id').notNull(), operatorKey: text('operator_key'), operatorSubjectId: uuid('operator_subject_id'),
  departureSeconds: integer('departure_seconds').notNull(), timeBasis: text('time_basis').notNull(), inputDigest: text('input_digest').notNull(),
  normalisedAt: timestamp('normalised_at', { withTimezone: true }).notNull().defaultNow(),
});
export const v2WorkerStatusTable = pgTable('v2_worker_status', {
  runnerKey: text('runner_key').primaryKey(), lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }).notNull(),
  lastDone: integer('last_done').notNull(), lastSuperseded: integer('last_superseded').notNull(),
  lastFailedAttempts: integer('last_failed_attempts').notNull(),
  lastContinued: integer('last_continued').notNull().default(0),
});
export const v2AssociationCatalogTable = pgTable('v2_association_catalog', {
  corridorId: uuid('corridor_id').primaryKey(), revision: bigint('revision', { mode: 'bigint' }).notNull(),
});
export const v2AssociationScansTable = pgTable('v2_association_scans', {
  jobId: uuid('job_id').primaryKey(), subjectId: uuid('subject_id').notNull(),
  sourceRevision: bigint('source_revision', { mode: 'bigint' }).notNull(),
  catalogRevision: bigint('catalog_revision', { mode: 'bigint' }).notNull(), inputDigest: text('input_digest').notNull(),
  cursorSubjectId: uuid('cursor_subject_id'), pagesCompleted: integer('pages_completed').notNull().default(0),
});
export const v2PatternCatalogTable = pgTable('v2_pattern_catalog', {
  routeSubjectId: uuid('route_subject_id').primaryKey(), revision: bigint('revision', { mode: 'bigint' }).notNull(),
});
export const v2PatternScansTable = pgTable('v2_pattern_scans', {
  jobId: uuid('job_id').primaryKey(), subjectId: uuid('subject_id').notNull(),
  sourceRevision: bigint('source_revision', { mode: 'bigint' }).notNull(), routeRevision: bigint('route_revision', { mode: 'bigint' }).notNull(),
  corridorRevision: bigint('corridor_revision', { mode: 'bigint' }).notNull(), inputDigest: text('input_digest').notNull(),
  cursorSubjectId: uuid('cursor_subject_id'), cursorKey: text('cursor_key'), pagesCompleted: integer('pages_completed').notNull().default(0),
});
export const v2PatternCandidateSupportTable = pgTable('v2_pattern_candidate_support', {
  candidateId: uuid('candidate_id').notNull(), observationId: uuid('observation_id').notNull(),
}, t => [primaryKey({ columns: [t.candidateId,t.observationId] })]);
export const processingTables = [v2NormalisedLeadsTable, v2WorkerStatusTable, v2AssociationCatalogTable, v2AssociationScansTable, v2PatternCatalogTable, v2PatternScansTable, v2PatternCandidateSupportTable] as const;
