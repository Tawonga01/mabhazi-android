import { jsonb, pgEnum, pgTable, serial, timestamp, unique, varchar, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { journeysTable } from "./journeys";

export const journeyClaimTypeEnum = pgEnum("journey_claim_type", [
  "route_active",
  "route_inactive",
  "pickup_point",
  "operator",
  "price",
  "schedule",
  "stop",
]);

export const journeyClaimStatusEnum = pgEnum("journey_claim_status", [
  "active",
  "disputed",
  "superseded",
]);

export const journeyClaimsTable = pgTable(
  "journey_claims",
  {
    id: serial("id").primaryKey(),
    journeyId: integer("journey_id")
      .notNull()
      .references(() => journeysTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id),
    type: journeyClaimTypeEnum("type").notNull(),
    value: jsonb("value").notNull(),
    status: journeyClaimStatusEnum("status").notNull().default("active"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_claim_user_type_unique").on(table.journeyId, table.userId, table.type),
  ],
);

export type JourneyClaim = typeof journeyClaimsTable.$inferSelect;
export type InsertJourneyClaim = typeof journeyClaimsTable.$inferInsert;