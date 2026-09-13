import { jsonb, pgEnum, pgTable, serial, text, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { journeysTable } from "./journeys";

export const contributionStatusEnum = pgEnum("contribution_status", [
  "published",
  "needs_confirmation",
  "superseded",
]);

export const journeyContributionsTable = pgTable("journey_contributions", {
  id: serial("id").primaryKey(),
  journeyId: integer("journey_id")
    .notNull()
    .references(() => journeysTable.id, { onDelete: "cascade" }),
  contributorId: varchar("contributor_id")
    .notNull()
    .references(() => usersTable.id),
  payload: jsonb("payload").notNull(),
  source: text("source").notNull().default("community"),
  status: contributionStatusEnum("status").notNull().default("published"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JourneyContribution = typeof journeyContributionsTable.$inferSelect;
export type InsertJourneyContribution = typeof journeyContributionsTable.$inferInsert;