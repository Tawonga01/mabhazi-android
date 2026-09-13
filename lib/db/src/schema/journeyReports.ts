import { integer, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { journeysTable } from "./journeys";

export const journeyReportsTable = pgTable("journey_reports", {
  id: serial("id").primaryKey(),
  journeyId: integer("journey_id").notNull().references(() => journeysTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => usersTable.id),
  type: text("type").notNull(),
  content: text("content"),
  minutesLate: integer("minutes_late"),
  reportedPrice: numeric("reported_price", { precision: 10, scale: 2 }),
  moderationStatus: text("moderation_status").notNull().default("visible"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JourneyReport = typeof journeyReportsTable.$inferSelect;
