import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
/** Private prompt state. Owner-only SQL primitives; no direct mobile access. */
export const v2PromptPoliciesTable = pgTable("v2_prompt_policies", {
  version: text("version").primaryKey(),
  sessionMinutes: integer("session_minutes").notNull(),
  dailyCap: integer("daily_cap").notNull(),
  unopenedMinutes: integer("unopened_minutes").notNull(),
  cooldownHours: integer("cooldown_hours").notNull(),
  unknownDays: integer("unknown_days").notNull(),
  retentionDays: integer("retention_days").notNull(),
});
export const v2QuestionRegistryTable = pgTable("v2_question_registry", {
  key: text("key").notNull(),
  version: text("version").notNull(),
  fieldKeys: text("field_keys").array().notNull(),
  targetKinds: text("target_kinds").array().notNull(),
  prerequisites: text("prerequisites").array().notNull(),
  contexts: text("contexts").array().notNull(),
  contextMode: text("context_mode").notNull(),
  formSchemaId: text("form_schema_id").notNull(),
  surfaces: text("surfaces").array().notNull(),
  priority: integer("priority").notNull(),
  freshnessPolicy: text("freshness_policy").notNull(),
  suppressionPolicy: text("suppression_policy").notNull(),
}, t => [primaryKey({ columns: [t.key, t.version] })]);
export const v2QuestionTasksTable = pgTable("v2_question_tasks", {
  id: uuid("id").primaryKey(),
  subjectId: uuid("subject_id").notNull(),
  fieldKey: text("field_key").notNull(),
  scopeKey: text("scope_key").notNull(),
  scope: jsonb("scope").notNull(),
  registryKey: text("registry_key").notNull(),
  registryVersion: text("registry_version").notNull(),
  reason: text("reason").notNull(),
  inputGeneration: bigint("input_generation", { mode: "bigint" }).notNull(),
  state: text("state").notNull(),
  priority: integer("priority").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const v2PromptPreferencesTable = pgTable("v2_prompt_preferences", {
  userId: varchar("user_id").primaryKey(),
  invitationsEnabled: boolean("invitations_enabled").notNull(),
  disabledTypes: text("disabled_types").array().notNull(),
  dismissedUntil: timestamp("dismissed_until", { withTimezone: true }),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
});
export const v2PromptSuppressionsTable = pgTable("v2_prompt_suppressions", {
  userId: varchar("user_id").notNull(),
  subjectId: uuid("subject_id").notNull(),
  fieldKey: text("field_key").notNull(),
  scopeKey: text("scope_key").notNull(),
  untilTime: timestamp("until_time", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.subjectId, t.fieldKey, t.scopeKey] })]);
export const v2PromptSessionsTable = pgTable("v2_prompt_sessions", {
  userId: varchar("user_id").primaryKey(),
  sessionId: uuid("session_id").notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
  inviteReserved: boolean("invite_reserved").notNull(),
});
export const v2PromptRequestsTable = pgTable("v2_prompt_requests", {
  id: uuid("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  requestDigest: text("request_digest"),
  sessionId: uuid("session_id").notNull(),
  consumed: boolean("consumed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const v2PromptInvitationsTable = pgTable("v2_prompt_invitations", {
  id: uuid("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  taskId: uuid("task_id").notNull(),
  policyVersion: text("policy_version").notNull(),
  mode: text("mode").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  targetRevision: bigint("target_revision", { mode: "bigint" }).notNull(),
  identityHash: text("identity_hash").notNull(),
  declaredContext: text("declared_context").array().notNull(),
  surface: text("surface").notNull(),
});
export const v2PromptEventsTable = pgTable("v2_prompt_events", {
  id: uuid("id").primaryKey(),
  invitationId: uuid("invitation_id").notNull(),
  userId: varchar("user_id").notNull(),
  outcome: text("outcome").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  clientObservedAt: timestamp("client_observed_at", { withTimezone: true }),
  requestDigest: text("request_digest").notNull(),
  observationId: uuid("observation_id"),
});
export const v2PromptMetricsTable = pgTable("v2_prompt_metrics", {
  policyVersion: text("policy_version").notNull(),
  registryKey: text("registry_key").notNull(),
  outcome: text("outcome").notNull(),
  count: bigint("count", { mode: "bigint" }).notNull(),
}, t => [primaryKey({ columns: [t.policyVersion, t.registryKey, t.outcome] })]);
export const promptTables = [v2PromptPoliciesTable, v2QuestionRegistryTable, v2QuestionTasksTable, v2PromptPreferencesTable, v2PromptSuppressionsTable, v2PromptSessionsTable, v2PromptRequestsTable, v2PromptInvitationsTable, v2PromptEventsTable, v2PromptMetricsTable];
