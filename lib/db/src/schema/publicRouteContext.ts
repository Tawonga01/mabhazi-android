import {integer,pgTable,timestamp,uuid,varchar} from 'drizzle-orm/pg-core';
// Versioned SQL is authoritative for FKs, uniqueness, RLS and fenced writers.
export const v2RouteReportBlocksTable=pgTable('v2_route_report_blocks',{
 id:uuid('id').primaryKey().defaultRandom(),blockerId:varchar('blocker_id').notNull(),blockedUserId:varchar('blocked_user_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const v2PublicLeadHidesTable=pgTable('v2_public_lead_hides',{
 subjectId:uuid('subject_id').primaryKey(),reportId:integer('report_id').notNull(),hiddenAt:timestamp('hidden_at',{withTimezone:true}).notNull().defaultNow(),
});
export const v2PublicFareRefsTable=pgTable('v2_public_fare_refs',{id:uuid('id').primaryKey().defaultRandom(),observationId:uuid('observation_id').notNull().unique()});
export const v2PublicFareHidesTable=pgTable('v2_public_fare_hides',{fareRef:uuid('fare_ref').primaryKey(),reportId:integer('report_id').notNull(),hiddenAt:timestamp('hidden_at',{withTimezone:true}).notNull().defaultNow()});
export const publicRouteContextTables=[v2RouteReportBlocksTable,v2PublicLeadHidesTable,v2PublicFareRefsTable,v2PublicFareHidesTable];
