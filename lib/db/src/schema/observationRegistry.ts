import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

/** Generated reference projection. SQL owns the FKs, parity checks and RLS.
 * Backend query-only; never write this table or use schema push. */
export const v2ObservationRefsTable = pgTable("v2_observation_refs", {
  observationId: uuid("observation_id").notNull(), path: text("path").notNull(),
  operatorId: uuid("operator_id"), stopId: uuid("stop_id"), cityId: integer("city_id"),
  calendarId: uuid("calendar_id"), timezone: text("timezone"),
}, table => [primaryKey({ columns: [table.observationId, table.path] })]);

export const observationRegistryTables = [v2ObservationRefsTable];
