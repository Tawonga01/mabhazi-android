import { integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const associationStatusEnum = pgEnum("association_status", ["pending", "confirmed", "rejected", "reversed"]);
export const associationRelationTypeEnum = pgEnum("association_relation_type", [
  "contains_stop",
  "same_service",
  "duplicate",
  "correction",
]);
export const journeyDataStatusEnum = pgEnum("journey_data_status", ["active", "uncertain", "inactive"]);

export const journeysTable = pgTable("journeys", {
  id: serial("id").primaryKey(),
  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  departureTime: text("departure_time").notNull(),
  arrivalTime: text("arrival_time").notNull(),
  scheduledDays: text("travel_date").notNull(),
  busCompany: text("bus_company").notNull(),
  pickupPoint: text("pickup_point").notNull(),
  dropoffPoint: text("dropoff_point").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  contributedBy: varchar("contributed_by").references(() => usersTable.id),
  contributorName: text("contributor_name").notNull().default("Anonymous"),
  // "visible" is public; "removed" and "hidden" remain available to
  // moderators without exposing objectionable route content to travellers.
  moderationStatus: text("moderation_status").notNull().default("visible"),
  dataStatus: journeyDataStatusEnum("data_status").notNull().default("active"),
  confidenceScore: integer("confidence_score").notNull().default(50),
  confirmationCount: integer("confirmation_count").notNull().default(0),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journeyStopsTable = pgTable("journey_stops", {
  id: serial("id").primaryKey(),
  journeyId: integer("journey_id")
    .notNull()
    .references(() => journeysTable.id, { onDelete: "cascade" }),
  city: text("city").notNull(),
  arrivalTime: text("arrival_time"),
  departureTime: text("departure_time"),
  sequence: integer("sequence").notNull().default(0),
  sourceAssociationId: integer("source_association_id"),
});

export const proposedAssociationsTable = pgTable("proposed_associations", {
  id: serial("id").primaryKey(),
  candidateJourneyId: integer("candidate_journey_id")
    .notNull()
    .references(() => journeysTable.id, { onDelete: "cascade" }),
  parentJourneyId: integer("parent_journey_id")
    .notNull()
    .references(() => journeysTable.id, { onDelete: "cascade" }),
  proposedStopCity: text("proposed_stop_city").notNull(),
  proposedStopTime: text("proposed_stop_time"),
  relationType: associationRelationTypeEnum("relation_type").notNull().default("contains_stop"),
  confidenceScore: integer("confidence_score").notNull().default(50),
  evidence: jsonb("evidence"),
  status: associationStatusEnum("status").notNull().default("pending"),
  proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by").references(() => usersTable.id),
});

export type Journey = typeof journeysTable.$inferSelect;
export type InsertJourney = typeof journeysTable.$inferInsert;
export type JourneyStop = typeof journeyStopsTable.$inferSelect;
export type InsertJourneyStop = typeof journeyStopsTable.$inferInsert;
export type ProposedAssociation = typeof proposedAssociationsTable.$inferSelect;
export type InsertProposedAssociation = typeof proposedAssociationsTable.$inferInsert;
