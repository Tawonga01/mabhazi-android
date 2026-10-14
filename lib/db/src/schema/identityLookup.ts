import { bigint, boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
// Private query mappings; versioned SQL owns authority, review, lineage and RLS.
export const v2ImportRevisionsTable=pgTable('v2_import_revisions',{
 requestId:uuid('request_id').primaryKey(),sourceNamespace:text('source_namespace').notNull(),importVersion:text('import_version').notNull(),
 epoch:bigint('epoch',{mode:'bigint'}).notNull(),expectedEpoch:bigint('expected_epoch',{mode:'bigint'}).notNull(),active:boolean('active').notNull().default(true),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const v2IdentityBindingsTable=pgTable('v2_identity_bindings',{
 id:uuid('id').primaryKey().defaultRandom(),requestId:uuid('request_id').notNull(),requestDigest:text('request_digest'),actorUserId:varchar('actor_user_id'),kind:text('kind').notNull(),
 sourceSubjectId:uuid('source_subject_id').notNull(),targetSubjectId:uuid('target_subject_id').notNull(),caseId:uuid('case_id').notNull(),
 expectedSourceRevision:bigint('expected_source_revision',{mode:'bigint'}).notNull(),expectedSourceGeneration:bigint('expected_source_generation',{mode:'bigint'}).notNull(),
 expectedTargetRevision:bigint('expected_target_revision',{mode:'bigint'}).notNull(),expectedTargetGeneration:bigint('expected_target_generation',{mode:'bigint'}).notNull(),
 payload:jsonb('payload'),importEpoch:bigint('import_epoch',{mode:'bigint'}),reviewDecisionId:uuid('review_decision_id'),state:text('state').notNull().default('pending'),
 appliedSourceRevision:bigint('applied_source_revision',{mode:'bigint'}),appliedSourceGeneration:bigint('applied_source_generation',{mode:'bigint'}),
 appliedTargetRevision:bigint('applied_target_revision',{mode:'bigint'}),appliedTargetGeneration:bigint('applied_target_generation',{mode:'bigint'}),
 erased:boolean('erased').notNull().default(false),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const v2IdentityBindingEvidenceTable=pgTable('v2_identity_binding_evidence',{
 bindingId:uuid('binding_id').notNull(),observationId:uuid('observation_id').notNull(),observationRevision:bigint('observation_revision',{mode:'bigint'}).notNull(),
},t=>[primaryKey({columns:[t.bindingId,t.observationId]})]);
export const v2OperatorAliasesTable=pgTable('v2_operator_aliases',{
 id:uuid('id').primaryKey().defaultRandom(),operatorSubjectId:uuid('operator_subject_id').notNull(),originalName:text('original_name').notNull(),normalisedName:text('normalised_name').notNull(),
 bindingId:uuid('binding_id').notNull(),provenanceDecisionId:uuid('provenance_decision_id').notNull(),active:boolean('active').notNull().default(true),
});
export const v2ExternalIdOriginsTable=pgTable('v2_external_id_origins',{mappingId:uuid('mapping_id').primaryKey(),bindingId:uuid('binding_id').notNull()});
export const v2IdentityBindingEventsTable=pgTable('v2_identity_binding_events',{
 id:uuid('id').primaryKey().defaultRandom(),bindingId:uuid('binding_id').notNull(),operation:text('operation').notNull(),reviewDecisionId:uuid('review_decision_id'),actorUserId:varchar('actor_user_id'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const identityLookupTables=[v2ImportRevisionsTable,v2IdentityBindingsTable,v2IdentityBindingEvidenceTable,v2OperatorAliasesTable,v2ExternalIdOriginsTable,v2IdentityBindingEventsTable] as const;
