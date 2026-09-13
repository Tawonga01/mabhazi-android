import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Reports submitted through the in-app UGC safety controls.
 *
 * targetId is intentionally text rather than a foreign key. Moderators can
 * remove a route/comment while retaining the abuse report as an audit record.
 */
export const abuseReportsTable = pgTable("abuse_reports", {
  id: serial("id").primaryKey(),
  // Keep the report if its author later deletes their account.
  reporterId: varchar("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  journeyId: integer("journey_id"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("pending"),
  moderatorNotes: text("moderator_notes"),
  // A reviewer can delete their account without blocking report cleanup.
  reviewedBy: varchar("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AbuseReport = typeof abuseReportsTable.$inferSelect;
export type InsertAbuseReport = typeof abuseReportsTable.$inferInsert;