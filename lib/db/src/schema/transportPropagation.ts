import { bigint, boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
/** Value-free structural invalidation history; SQL trigger-owned. */
export const v2TransportChangesTable = pgTable("v2_transport_changes", {
 id: uuid("id").primaryKey().defaultRandom(), sourceTable: text("source_table").notNull(), operation: text("operation").notNull(),
 changedColumns: text("changed_columns").array().notNull(), policyVersion: text("policy_version").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const v2TransportChangeSubjectsTable = pgTable("v2_transport_change_subjects", {
 changeId: uuid("change_id").notNull(), subjectId: uuid("subject_id").notNull(), isRoot: boolean("is_root").notNull(),
 previousRevision: bigint("previous_revision", { mode: "bigint" }).notNull(), previousGeneration: bigint("previous_generation", { mode: "bigint" }).notNull(),
 resultingRevision: bigint("resulting_revision", { mode: "bigint" }).notNull(), resultingGeneration: bigint("resulting_generation", { mode: "bigint" }).notNull(),
}, t => [primaryKey({ columns: [t.changeId, t.subjectId] })]);
export const transportPropagationTables = [v2TransportChangesTable, v2TransportChangeSubjectsTable];
