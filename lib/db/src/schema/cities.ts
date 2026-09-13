import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const citiesTable = pgTable("cities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  placeType: text("place_type").notNull(),
});

export type City = typeof citiesTable.$inferSelect;
