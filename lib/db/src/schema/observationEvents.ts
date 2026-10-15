import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Append-only audit; SQL owns transition checks, lineage, projection and erasure. */
export const v2ObservationEventsTable = pgTable("v2_observation_events", {
  id: uuid("id").primaryKey().defaultRandom(), observationId: uuid("observation_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  action: text("action", { enum: ["baseline", "submit", "supersede", "withdraw", "hide", "restore", "reverse"] }).notNull(),
  fromStatus: text("from_status", { enum: ["active", "superseded", "withdrawn", "hidden"] }),
  status: text("status", { enum: ["active", "superseded", "withdrawn", "hidden"] }).notNull(),
  previousEventId: uuid("previous_event_id"), actorUserId: varchar("actor_user_id"),
  actorErased: boolean("actor_erased").notNull().default(false), reasonCode: text("reason_code"),
  privateReason: text("private_reason"), requestId: uuid("request_id"), reviewDecisionId: uuid("review_decision_id"),
  replacementObservationId: uuid("replacement_observation_id"), replacementErased: boolean("replacement_erased").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const observationEventTables = [v2ObservationEventsTable];
