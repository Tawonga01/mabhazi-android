import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
});
export const processingTables = [v2NormalisedLeadsTable, v2WorkerStatusTable] as const;
