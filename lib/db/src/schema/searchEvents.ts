import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const searchEventsTable = pgTable("search_events", {
  id: serial("id").primaryKey(),
  fromCity: text("from_city"),
  toCity: text("to_city"),
  day: text("day"),
  resultsCount: integer("results_count").notNull(),
  userId: varchar("user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SearchEvent = typeof searchEventsTable.$inferSelect;
