import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const busCompaniesTable = pgTable("bus_companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusCompany = typeof busCompaniesTable.$inferSelect;
export type InsertBusCompany = typeof busCompaniesTable.$inferInsert;
