import { integer, pgTable, serial, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { journeysTable } from "./journeys";
import { usersTable } from "./auth";

export const journeyRatingsTable = pgTable(
  "journey_ratings",
  {
    id: serial("id").primaryKey(),
    journeyId: integer("journey_id")
      .notNull()
      .references(() => journeysTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("journey_ratings_user_journey_unique").on(table.userId, table.journeyId),
  ],
);

export type JourneyRating = typeof journeyRatingsTable.$inferSelect;
export type InsertJourneyRating = typeof journeyRatingsTable.$inferInsert;
