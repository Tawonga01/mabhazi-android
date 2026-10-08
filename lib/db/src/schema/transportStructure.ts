import { bigint, boolean, date, integer, numeric, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

// Query mappings only. Versioned SQL owns FK/check/trigger/RLS invariants.
// These internal projections are not public API response schemas.
export const v2TransportGuardTable = pgTable("v2_transport_guard", {
  id: boolean("id").primaryKey().default(true), toggle: boolean("toggle").notNull().default(false),
});
export const v2TimezonesTable = pgTable("v2_timezones", { name: text("name").primaryKey() });
export const v2RoutesTable = pgTable("v2_routes", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["route"] }).notNull().default("route"),
  operatorSubjectId: uuid("operator_subject_id").notNull(), publicName: text("public_name"), publicCode: text("public_code"),
});
export const v2StopsTable = pgTable("v2_stops", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["stop"] }).notNull().default("stop"),
  cityId: integer("city_id"), name: text("name").notNull(), parentStopId: uuid("parent_stop_id"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }), longitude: numeric("longitude", { precision: 9, scale: 6 }),
  precision: text("precision", { enum: ["named_place", "approximate"] }).notNull().default("named_place"),
});
export const v2PatternsTable = pgTable("v2_patterns", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["pattern"] }).notNull().default("pattern"),
  routeSubjectId: uuid("route_subject_id").notNull(), corridorId: uuid("corridor_id").notNull(),
  currentPatternVersion: integer("current_pattern_version").notNull(), currentVersionSealed: boolean("current_version_sealed").notNull().default(true),
});
export const v2PatternVersionsTable = pgTable("v2_pattern_versions", {
  patternSubjectId: uuid("pattern_subject_id").notNull(), version: integer("version").notNull(),
  effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"),
  stopsComplete: boolean("stops_complete").notNull().default(false), sealed: boolean("sealed").notNull().default(false),
}, t => [primaryKey({ columns: [t.patternSubjectId, t.version] })]);
export const v2PatternStopsTable = pgTable("v2_pattern_stops", {
  patternSubjectId: uuid("pattern_subject_id").notNull(), patternVersion: integer("pattern_version").notNull(),
  sequence: integer("sequence").notNull(), stopSubjectId: uuid("stop_subject_id").notNull(),
  pickup: text("pickup", { enum: ["allowed", "forbidden", "request", "unknown"] }).notNull().default("unknown"),
  dropoff: text("dropoff", { enum: ["allowed", "forbidden", "request", "unknown"] }).notNull().default("unknown"),
}, t => [primaryKey({ columns: [t.patternSubjectId, t.patternVersion, t.sequence] })]);
export const v2CalendarsTable = pgTable("v2_calendars", {
  id: uuid("id").primaryKey().defaultRandom(), timezone: text("timezone").notNull(),
  startDate: date("start_date"), endDate: date("end_date"), weekdays: integer("weekdays"),
  coverage: text("coverage", { enum: ["recurring", "explicit_dates"] }).notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
});
export const v2CalendarExceptionsTable = pgTable("v2_calendar_exceptions", {
  calendarId: uuid("calendar_id").notNull(), serviceDate: date("service_date").notNull(),
  action: text("action", { enum: ["add", "remove"] }).notNull(),
}, t => [primaryKey({ columns: [t.calendarId, t.serviceDate] })]);
export const v2ServicePlansTable = pgTable("v2_service_plans", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["service_plan"] }).notNull().default("service_plan"),
  patternSubjectId: uuid("pattern_subject_id").notNull(), patternVersion: integer("pattern_version").notNull(),
  patternSealed: boolean("pattern_sealed").notNull().default(true),
  mode: text("mode", { enum: ["fixed_time", "frequency", "when_full", "on_demand", "unknown"] }).notNull(),
  calendarId: uuid("calendar_id"), timezone: text("timezone"), effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"),
  boardingInstructions: text("boarding_instructions"),
});
export const v2RunsTable = pgTable("v2_runs", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["run"] }).notNull().default("run"),
  servicePlanSubjectId: uuid("service_plan_subject_id").notNull(),
  planMode: text("plan_mode", { enum: ["fixed_time"] }).notNull().default("fixed_time"),
  patternSubjectId: uuid("pattern_subject_id").notNull(), patternVersion: integer("pattern_version").notNull(),
  departureSeconds: integer("departure_seconds").notNull(), arrivalSeconds: integer("arrival_seconds"),
  runLabel: text("run_label"), validityFrom: date("validity_from"), validityTo: date("validity_to"),
});
export const v2RunStopTimesTable = pgTable("v2_run_stop_times", {
  runSubjectId: uuid("run_subject_id").notNull(), patternSubjectId: uuid("pattern_subject_id").notNull(),
  patternVersion: integer("pattern_version").notNull(), patternSequence: integer("pattern_sequence").notNull(),
  arrivalSeconds: integer("arrival_seconds"), departureSeconds: integer("departure_seconds"),
}, t => [primaryKey({ columns: [t.runSubjectId, t.patternSequence] })]);
export const v2FrequencyWindowsTable = pgTable("v2_frequency_windows", {
  id: uuid("id").primaryKey().defaultRandom(), servicePlanSubjectId: uuid("service_plan_subject_id").notNull(),
  planMode: text("plan_mode", { enum: ["frequency"] }).notNull().default("frequency"),
  startSeconds: integer("start_seconds").notNull(), endSeconds: integer("end_seconds").notNull(), headwaySeconds: integer("headway_seconds").notNull(),
});
export const v2AvailabilityWindowsTable = pgTable("v2_availability_windows", {
  id: uuid("id").primaryKey().defaultRandom(), servicePlanSubjectId: uuid("service_plan_subject_id").notNull(),
  planMode: text("plan_mode", { enum: ["when_full", "on_demand"] }).notNull(),
  startSeconds: integer("start_seconds"), endSeconds: integer("end_seconds"), bookingNote: text("booking_note"),
});
export const v2ActualJourneysTable = pgTable("v2_actual_journeys", {
  subjectId: uuid("subject_id").primaryKey(),
  subjectKind: text("subject_kind", { enum: ["actual_journey"] }).notNull().default("actual_journey"),
  reportedServiceDate: date("reported_service_date"), timezone: text("timezone"), intendedSubjectId: uuid("intended_subject_id"),
  intendedSubjectKind: text("intended_subject_kind", { enum: ["lead", "route", "pattern", "service_plan", "run"] }),
  matchedRunSubjectId: uuid("matched_run_subject_id"),
  associationStatus: text("association_status", { enum: ["unresolved", "matched"] }).notNull().default("unresolved"),
});
export const v2ExternalIdsTable = pgTable("v2_external_ids", {
  id: uuid("id").primaryKey().defaultRandom(), sourceNamespace: text("source_namespace").notNull(),
  entityKind: text("entity_kind", { enum: ["lead", "operator", "route", "stop", "pattern", "service_plan", "run", "actual_journey"] }).notNull(),
  externalId: text("external_id").notNull(), subjectId: uuid("subject_id").notNull(), importVersion: text("import_version").notNull(),
  active: boolean("active").notNull().default(true),
});
export const v2LegacyLinksTable = pgTable("v2_legacy_links", {
  legacyJourneyId: integer("legacy_journey_id").notNull(), subjectId: uuid("subject_id").notNull(),
  mappingState: text("mapping_state", { enum: ["unresolved"] }).notNull().default("unresolved"), importVersion: text("import_version").notNull(),
}, t => [primaryKey({ columns: [t.legacyJourneyId, t.subjectId] })]);

export const transportTables = [v2TransportGuardTable, v2TimezonesTable, v2RoutesTable, v2StopsTable, v2PatternsTable,
  v2PatternVersionsTable, v2PatternStopsTable, v2CalendarsTable, v2CalendarExceptionsTable, v2ServicePlansTable,
  v2RunsTable, v2RunStopTimesTable, v2FrequencyWindowsTable, v2AvailabilityWindowsTable, v2ActualJourneysTable,
  v2ExternalIdsTable, v2LegacyLinksTable] as const;
