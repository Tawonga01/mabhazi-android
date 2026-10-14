import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { processingTables } from "./schema/processing";
import { registerProcessingTests } from "./processing.cases";
import { registerLeadAssociationTests } from "./lead-association.cases";
import { registerPatternAssociationTests } from "./pattern-association.cases";
import { identityLookupTables } from "./schema/identityLookup";
import { registerIdentityLookupTests } from "./identity-lookup.cases";
import { intakeTables } from "./schema/contributionIntake";
import { transportTables } from "./schema/transportStructure";
import { reviewTables } from "./schema/reviewDecisions";
import { derivedTables } from "./schema/derivedDecisions";
import { observationRegistryTables } from "./schema/observationRegistry";
import { observationEventTables } from "./schema/observationEvents";
import { observationTargetTables } from "./schema/observationTargets";
import { sourceIdentityTables } from "./schema/sourceIdentity";
import { evidenceAssessmentTables } from "./schema/evidenceAssessments";
import { fieldResolutionTables } from "./schema/fieldResolution";
import { routePatternCreationTables } from "./schema/routePatternCreation";
import { transportCreationTables } from "./schema/transportCreation";
import { transportWriterTables } from "./schema/transportWriters";
import { transportPropagationTables } from "./schema/transportPropagation";
import { promptTables } from "./schema/promptTasks";
import { affiliationIssuerTables } from "./schema/affiliationIssuers";
import { registerTransportTests } from "./transport-structure.cases";
import { registerReviewTests } from "./review-decisions.cases";
import { registerObservationEventTests } from "./observation-events.cases";
import { registerObservationRegistryTests } from "./observation-registry.cases";
import { registerObservationTargetTests } from "./observation-targets.cases";
import { registerSourceIdentityTests } from "./source-identity.cases";
import { registerAssessmentTests } from "./evidence-assessments.cases";
import { registerFieldResolutionTests } from "./field-resolution.cases";
import { registerActualIntakeTests } from "./actual-journey-intake.cases";
import { registerServiceRunTests } from "./service-run-creation.cases";
import { registerRoutePatternTests } from "./route-pattern-creation.cases";
import { registerTransportCreationTests } from "./transport-creation.cases";
import { registerLeadCreationTests } from "./lead-creation.cases";
import { registerWriterTests } from "./transport-writers.cases";
import { registerPropagationTests } from "./transport-propagation.cases";
import { registerPromptTests } from "./prompt-tasks.cases";
import { registerAffiliationTests } from "./affiliation-issuers.cases";
import { registerDerivedTests } from "./derived-decisions.cases";

// Disposable database only. Never run mutation tests in the supplied database.
// Isolated test-cluster credentials need CREATEDB/CREATEROLE.
const databaseName = `mabhazi_intake_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let db: pg.Client;
let databaseCreated = false;
let connectionString: string;
const hash = "a".repeat(64);
const hash2 = "b".repeat(64);
let user: string;
let other: string;
let origin: number;
let destination: number;
let corridor: string;
let legacySnapshot: unknown;
let preservedIntakeUpgrade = false;
const createdRoles: string[] = [];

async function migrate() {
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./migrate.ts", import.meta.url))], {
    env: { ...process.env, DATABASE_URL: connectionString }, encoding: "utf8", timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required for isolated PostgreSQL tests");
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  connectionString = url.toString();
  db = new pg.Client({ connectionString });
  await db.connect();
  // Simulate a populated deployment with exactly the previously shipped migrations.
  await db.query("BEGIN");
  await db.query("CREATE SCHEMA mabhazi_migrations; REVOKE ALL ON SCHEMA mabhazi_migrations FROM PUBLIC");
  await db.query("CREATE TABLE mabhazi_migrations.applied(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of ["0000_initial.sql", "0001_api_role.sql", "0002_contribution_intake.sql", "0003_transport_structure.sql", "0004_review_decisions.sql", "0005_derived_decisions.sql", "0006_observation_registry.sql", "0007_observation_events.sql", "0008_observation_targets.sql", "0009_source_identity.sql", "0010_evidence_assessments.sql", "0011_field_resolution.sql", "0012_affiliation_issuers.sql", "0013_prompt_tasks.sql", "0014_transport_propagation.sql", "0015_transport_writers.sql", "0016_lead_creation.sql", "0017_transport_uuid_normalization.sql", "0018_transport_creation.sql", "0019_route_pattern_creation.sql", "0020_service_run_creation.sql"]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    // 0001 predates multi-database tests and creates a cluster-wide role.
    // Reuse that role in this isolated database without changing the shipped
    // migration or its recorded checksum; all database-local grants still run.
    let fixtureSql = sql;
    if (name === "0001_api_role.sql" && (await db.query("SELECT 1 FROM pg_roles WHERE rolname='mabhazi_api'")).rowCount) {
      const roleStatement = "CREATE ROLE mabhazi_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;";
      assert.ok(sql.includes(roleStatement));
      fixtureSql = sql.replace(roleStatement, "");
    }
    await db.query(fixtureSql);
    await db.query("INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES($1,$2)", [name, createHash("sha256").update(sql).digest("hex")]);
  }
  await db.query(`INSERT INTO journeys(from_city,to_city,departure_time,arrival_time,travel_date,bus_company,pickup_point,dropoff_point,price)
    VALUES ('Harare','Bulawayo','08:00','14:00','2026-10-07','Synthetic legacy company','A','B',25.50)`);
  legacySnapshot = (await db.query("SELECT to_jsonb(j) AS row FROM journeys j ORDER BY id")).rows;
  const upgradeUser = randomUUID(), upgradeSubject = randomUUID(), upgradeContribution = randomUUID();
  await db.query("INSERT INTO users(id) VALUES($1)", [upgradeUser]);
  const upgradeCities = (await db.query("INSERT INTO cities(name,place_type) VALUES('Upgrade origin','city'),('Upgrade destination','city') RETURNING id")).rows.map(r => r.id);
  const upgradeCorridor = (await db.query("INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$2) RETURNING id", upgradeCities)).rows[0].id;
  await db.query("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [upgradeSubject]);
  await db.query(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
    VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{"synthetic":"preserve intake"}',$4)`, [upgradeContribution, upgradeUser, hash, upgradeSubject]);
  await db.query(`INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id)
    VALUES($1,$2,0,'Upgrade operator',$3)`, [upgradeSubject, upgradeCorridor, upgradeContribution]);
  const upgradeObservation = (await db.query(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
    VALUES($1,$2,'boarding.pickup',$3,$4,$4) RETURNING *`, [upgradeContribution, upgradeSubject, { cityId: upgradeCities[0], name: "Upgrade named place" }, hash])).rows[0];
  // Preserve a real pre-target withdrawal and its complete event history.
  await db.query("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [upgradeUser, upgradeObservation.id, randomUUID()]);
  const upgradeState = (await db.query("SELECT * FROM v2_observation_states WHERE observation_id=$1", [upgradeObservation.id])).rows[0];
  const upgradeEvents = (await db.query("SELECT * FROM v2_observation_events WHERE observation_id=$1 ORDER BY revision", [upgradeObservation.id])).rows;
  const upgradeSource = (await db.query("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','synthetic source') RETURNING *", [upgradeUser])).rows[0];
  await db.query("INSERT INTO v2_observation_sources(observation_id,source_id) VALUES($1,$2)", [upgradeObservation.id, upgradeSource.id]);
  const upgradeGraph = (await db.query("SELECT * FROM v2_source_graph")).rows;
  const upgradeTargets = (await db.query("SELECT * FROM v2_observation_targets WHERE observation_id=$1", [upgradeObservation.id])).rows;
  const intakeSnapshot = (await db.query("SELECT to_jsonb(l) AS lead,to_jsonb(c) AS contribution FROM v2_leads l JOIN v2_contributions c ON c.id=l.initial_contribution_id WHERE l.subject_id=$1", [upgradeSubject])).rows;
  // Preserve an existing assessment without inventing a reviewed choice on upgrade.
  const upgradeAssessmentSubject = (await db.query("INSERT INTO v2_subjects(kind) VALUES('stop') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Synthetic assessment upgrade stop')",[upgradeAssessmentSubject]);
  const upgradeAssessment = (await db.query("SELECT v2_assess_field($1,'stop.location',v2_assessment_hash('{}'),'{}',1,1,$2,statement_timestamp(),gen_random_uuid()) id",[upgradeAssessmentSubject,upgradeGraph[0].revision])).rows[0].id;
  const assessmentSnapshot = (await db.query("SELECT * FROM v2_field_assessments WHERE id=$1",[upgradeAssessment])).rows[0];
  const upgradeField = (await db.query("SELECT v2_process_field_assessment($1) id",[upgradeAssessment])).rows[0].id;
  const fieldSnapshot = (await db.query("SELECT * FROM v2_field_decisions WHERE id=$1",[upgradeField])).rows[0];
  const upgradeOperator = (await db.query("INSERT INTO v2_subjects(kind) VALUES('operator') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Synthetic upgrade affiliation company')",[upgradeOperator]);
  const upgradeClaim = (await db.query("SELECT v2_claim_affiliation($1,$2,'operations representative',gen_random_uuid()) id",[upgradeUser,upgradeOperator])).rows[0].id;
  const upgradeProof = (await db.query("SELECT v2_add_affiliation_proof($1,$2,'authorization_document',statement_timestamp()-interval '1 day',statement_timestamp()+interval '30 days','private://synthetic-upgrade',gen_random_uuid()) id",[upgradeUser,upgradeClaim])).rows[0].id;
  const affiliationSnapshot = (await db.query("SELECT to_jsonb(c) claim,to_jsonb(p) proof FROM v2_affiliation_claims c JOIN v2_affiliation_proofs p ON p.claim_id=c.id WHERE c.id=$1",[upgradeClaim])).rows;
  const upgradeGeneration=(await db.query("SELECT input_generation FROM v2_subjects WHERE id=$1",[upgradeSubject])).rows[0].input_generation;
  await db.query("SELECT v2_prompt_put_task($1,'boarding.pickup','{}','pickup_place',$2)",[upgradeSubject,upgradeGeneration]);
  const upgradeInvitation=(await db.query("SELECT v2_prompt_reserve($1,gen_random_uuid(),ARRAY['knows_route'],'route_detail',NULL,$2) id",[upgradeUser,upgradeSubject])).rows[0].id;
  assert.ok(upgradeInvitation);
  await db.query("SELECT v2_prompt_event($1,$2,gen_random_uuid(),'unknown','Africa/Harare',NULL)",[upgradeUser,upgradeInvitation]);
  const promptSnapshot=async()=>Promise.all(["v2_question_tasks","v2_prompt_requests","v2_prompt_invitations","v2_prompt_sessions","v2_prompt_events","v2_prompt_suppressions"].map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  // Preserve real reviewed writer/history from populated0015 on upgrade0016.
  const writerSubject=randomUUID(),writerContribution=randomUUID();
  await db.query("INSERT INTO v2_subjects(id,kind) VALUES($1,'stop')",[writerSubject]);
  await db.query("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Pre-writer place')",[writerSubject]);
  await db.query("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)",[writerContribution,upgradeUser,hash,writerSubject]);
  const writerObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'stop.location',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[writerContribution,writerSubject,{cityId:upgradeCities[0],name:"Reviewed upgrade place",precision:"named_place"}])).rows[0].id;
  await db.query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture')",[upgradeUser]);
  const writerEdit=(await db.query("SELECT v2_propose_transport_edit($1,$2,1,$3,gen_random_uuid()) id",[upgradeUser,writerSubject,writerObservation])).rows[0].id;
  const writerReview=(await db.query("SELECT v2_review_transport_edit($1,$2,1,1,'accept','upgrade_writer',NULL,gen_random_uuid(),NULL) id",[upgradeUser,writerEdit])).rows[0].id;
  await db.query("SELECT v2_apply_transport_edit($1,$2,$3,gen_random_uuid())",[upgradeUser,writerEdit,writerReview]);
  const writerSnapshot=async()=>Promise.all(["v2_transport_edits","v2_transport_edit_events","v2_transport_edit_heads","v2_pattern_version_origins"].map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  const upgradeWriters=await writerSnapshot();
  assert.ok(upgradeWriters[0]!.length>0);
  //0019 preserves real intake origin, core events, receipt and work.
  await db.query("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=now() WHERE id=$1",[upgradeUser]);
  const originIntake=(await db.query("SELECT v2_submit_lead($1,'2026-09-12',$2) result",[upgradeUser,{schemaVersion:"1.0",clientSubmissionId:randomUUID(),entrySurface:"contribute_tab",target:{newLead:{originCityId:upgradeCities[0],destinationCityId:upgradeCities[1],departureTime:"10:00",operator:{name:"Atomic upgrade operator"}}},observations:[]}])).rows[0].result;
  const originSnapshot=async()=>Promise.all([
    db.query("SELECT to_jsonb(t) row FROM v2_subject_revisions t WHERE subject_id=$1 ORDER BY revision",[originIntake.subjectId]),
    db.query("SELECT to_jsonb(t) row FROM v2_receipts t WHERE contribution_id=$1",[originIntake.contributionId]),
    db.query("SELECT to_jsonb(t) row FROM v2_jobs t WHERE contribution_id=$1 ORDER BY id",[originIntake.contributionId]),
    db.query("SELECT to_jsonb(t) row FROM v2_observations t WHERE contribution_id=$1 ORDER BY id",[originIntake.contributionId]),
    db.query("SELECT to_jsonb(t) row FROM v2_observation_events t WHERE observation_id IN (SELECT id FROM v2_observations WHERE contribution_id=$1) ORDER BY id",[originIntake.contributionId])
  ]).then(results=>results.map(result=>result.rows));
  // Preserve real0018 created operator/place origins, receipts and current heads.
  const creationObservation=(await db.query("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[originIntake.contributionId])).rows[0].id;
  const upgradeCreation=(await db.query("SELECT v2_propose_transport_creation($1,$2,$3,$4,'operator',gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,creationObservation])).rows[0].id;
  const upgradeCreationReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_identity',NULL,gen_random_uuid(),NULL) id",[upgradeUser,upgradeCreation,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,upgradeCreation,upgradeCreationReview]);
  const placeObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'boarding.pickup',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[originIntake.contributionId,originIntake.subjectId,{cityId:upgradeCities[0],name:"Created upgrade place"}])).rows[0].id;
  const upgradePlace=(await db.query("SELECT v2_propose_transport_creation($1,$2,$3,$4,'stop',gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,placeObservation])).rows[0].id;
  const upgradePlaceReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_place',NULL,gen_random_uuid(),NULL) id",[upgradeUser,upgradePlace,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,upgradePlace,upgradePlaceReview]);
  // Preserve actual0019 route/pattern origins, parent epochs and initial sealed-version lineage.
  const createdOperator=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[upgradeCreation])).rows[0].target_subject_id;
  const createdPlace=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[upgradePlace])).rows[0].target_subject_id;
  const identityObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'operator.identity',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[originIntake.contributionId,originIntake.subjectId,{id:createdOperator}])).rows[0].id;
  const routeCreation=(await db.query("SELECT v2_propose_transport_creation($1,$2,$3,$4,'route',gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,identityObservation])).rows[0].id;
  const routeReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_route',NULL,gen_random_uuid(),NULL) id",[upgradeUser,routeCreation,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,routeCreation,routeReview]);
  const createdRoute=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[routeCreation])).rows[0].target_subject_id;
  const patternObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'pattern.stops',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[originIntake.contributionId,originIntake.subjectId,{stops:[{place:{stopId:createdPlace},pickup:'unknown',dropoff:'unknown'}],stopsComplete:false}])).rows[0].id;
  const patternCreation=(await db.query("SELECT v2_propose_pattern_creation($1,$2,$3,$4,$5,$6,gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,patternObservation,createdRoute,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[createdRoute])).rows[0].revision])).rows[0].id;
  const patternReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_pattern',NULL,gen_random_uuid(),NULL) id",[upgradeUser,patternCreation,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,patternCreation,patternReview]);
  // Preserve real0020 plan/run creation alongside a legacy actual report with no birth provenance.
  const createdPattern=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[patternCreation])).rows[0].target_subject_id;
  const modeObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'service.mode',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[originIntake.contributionId,originIntake.subjectId,{mode:'fixed_time'}])).rows[0].id;
  const planCreation=(await db.query("SELECT v2_propose_service_plan_creation($1,$2,$3,$4,$5,$6,gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,modeObservation,createdPattern,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[createdPattern])).rows[0].revision])).rows[0].id;
  const planReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_plan',NULL,gen_random_uuid(),NULL) id",[upgradeUser,planCreation,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,planCreation,planReview]);
  const createdPlan=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[planCreation])).rows[0].target_subject_id;
  const runObservation=(await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'departure.scheduled',$3,$4,v2_assessment_hash($4),v2_assessment_hash($3)) RETURNING id",[originIntake.contributionId,originIntake.subjectId,{seconds:25200},{schemaVersion:'1.0'}])).rows[0].id;
  const runCreation=(await db.query("SELECT v2_propose_run_creation($1,$2,$3,$4,$5,$6,gen_random_uuid()) id",[upgradeUser,originIntake.subjectId,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision,runObservation,createdPlan,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[createdPlan])).rows[0].revision])).rows[0].id;
  const runReview=(await db.query("SELECT v2_review_transport_creation($1,$2,1,$3,'accept','upgrade_run',NULL,gen_random_uuid(),NULL) id",[upgradeUser,runCreation,(await db.query("SELECT revision FROM v2_subjects WHERE id=$1",[originIntake.subjectId])).rows[0].revision])).rows[0].id;
  await db.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[upgradeUser,runCreation,runReview]);
  const createdRun=(await db.query("SELECT target_subject_id FROM v2_transport_creations WHERE id=$1",[runCreation])).rows[0].target_subject_id;
  await db.query("SET CONSTRAINTS public.v2_subject_subtype DEFERRED");const legacyActual=randomUUID(),legacyContribution=randomUUID();
  await db.query("INSERT INTO v2_subjects(id,kind) VALUES($1,'actual_journey')",[legacyActual]);
  await db.query("INSERT INTO v2_actual_journeys(subject_id,reported_service_date,timezone,intended_subject_id,intended_subject_kind,matched_run_subject_id,association_status) VALUES($1,'2026-10-01','Africa/Harare',$2,'route',$3,'matched')",[legacyActual,createdRoute,createdRun]);
  await db.query("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','route_detail',$3,'{}',$4)",[legacyContribution,upgradeUser,'a'.repeat(64),legacyActual]);
  await db.query("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'departure.actual',$3,$4,v2_assessment_hash($4),v2_assessment_hash($3))",[legacyContribution,legacyActual,{time:'08:20'},{schemaVersion:'1.0',serviceDate:'2026-10-01',timezone:'Africa/Harare'}]);
  await db.query("SET CONSTRAINTS public.v2_subject_subtype IMMEDIATE");
  const legacyActualSnapshot=async()=>Promise.all([db.query("SELECT v2_transport_snapshot($1) snapshot",[legacyActual]),db.query("SELECT to_jsonb(t) row FROM v2_contributions t WHERE id=$1",[legacyContribution]),db.query("SELECT to_jsonb(t) row FROM v2_observations t WHERE original_subject_id=$1 ORDER BY id",[legacyActual])]).then(items=>items.map(item=>item.rows));
  const upgradeActual=await legacyActualSnapshot();
  const parentSnapshot=async()=>Promise.all(["v2_transport_creation_dependencies","v2_pattern_creation_origins"].map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  const upgradeParents=await parentSnapshot();assert.equal(upgradeParents[1]!.length,1);
  const creationSnapshot=async()=>Promise.all(["v2_transport_creations","v2_transport_creation_events","v2_transport_creation_origins","v2_transport_creation_heads"].map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  const upgradeCreations=await creationSnapshot();assert.equal(upgradeCreations[0]!.length,6);
  const upgradeOrigins=await originSnapshot();
  const upgradePrompts=await promptSnapshot();
  await db.query("UPDATE v2_operators SET country_code='ZW' WHERE subject_id=$1",[upgradeOperator]);
  const propagationSnapshot=async()=>Promise.all(["v2_transport_changes","v2_transport_change_subjects"].map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  const upgradePropagation=await propagationSnapshot();
  assert.ok(upgradePropagation[0]!.length>0);
  // Model hosted defaults granting client roles access to newly created tables.
  //0021 explicitly revokes hosted defaults for actual intake/origin helpers.
  for (const role of ["anon", "authenticated"]) {
    if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) {
      await db.query(`CREATE ROLE ${role} NOLOGIN`);
      createdRoles.push(role);
    }
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}`);
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`);
  }
  await db.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC");
  await db.query("COMMIT");
  // Exercise0025 with committed0024 input and pending lead association intent.
  let previousStageLog = "";
  for (const name of ["0021_actual_journey_intake.sql", "0022_minimum_lead_api.sql", "0023_normalise_worker.sql", "0024_lead_association_worker.sql"]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await db.query("BEGIN"); await db.query(sql);
    await db.query("INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES($1,$2)", [name, createHash("sha256").update(sql).digest("hex")]);
    await db.query("COMMIT"); previousStageLog += `Applied ${name}\n`;
  }
  const workerUpgradeUser = randomUUID();
  await db.query("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',clock_timestamp())", [workerUpgradeUser]);
  const workerUpgrade = (await db.query("SELECT v2_api_submit_minimum_lead($1,'2026-09-12',$2) r", [workerUpgradeUser, {
    schemaVersion:"1.0", clientSubmissionId:randomUUID(), entrySurface:"contribute_tab",
    target:{newLead:{originCityId:upgradeCities[0],destinationCityId:upgradeCities[1],departureTime:"08:00",operator:{name:"Pre-worker reported bus"}}}, observations:[]
  }])).rows[0].r;
  // Select only the new worker fixture first; prior upgrade jobs must stay exact.
  await db.query("UPDATE v2_jobs SET available_at='1970-01-01T00:00:00Z' WHERE contribution_id=$1 AND kind='normalise'",[workerUpgrade.contributionId]);
  const upgradeLease=(await db.query('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;
  assert.equal((await db.query('SELECT v2_worker_finish_normalise($1,$2) r',[upgradeLease.id,upgradeLease.lease_token])).rows[0].r,'done');
  const associationUpgradeSnapshot=async()=>Promise.all(['v2_normalised_leads','v2_jobs'].map(async table=>
    (await db.query(`SELECT to_jsonb(t) row FROM ${table} t WHERE subject_id=$1 ORDER BY to_jsonb(t)::text`,[workerUpgrade.subjectId])).rows));
  const beforeAssociation=await associationUpgradeSnapshot();
  const workerSnapshot = async () => Promise.all(["v2_contributions","v2_receipts","v2_observations","v2_jobs"].map(async table =>
    (await db.query(`SELECT to_jsonb(t) row FROM ${table} t WHERE ${table === "v2_contributions" ? "id" : "contribution_id"}=$1 ORDER BY to_jsonb(t)::text`, [workerUpgrade.contributionId])).rows));
  const beforeWorker = await workerSnapshot();
  // Exercise the actual hosted editor representation, preserving all function ACLs and fences.
  const patternPriorNames=['v2_worker_finish_associate','v2_worker_claim_associate','v2_worker_heartbeat_associate','v2_worker_fail_associate','v2_worker_retry_associate','v2_association_catalog_change','v2_record_review','v2_apply_association_decision','v2_worker_drain_associate'];
  const priorDefinitions=(await db.query('SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=ANY($1::text[])',[patternPriorNames])).rows;
  assert.equal(priorDefinitions.length,9);
  for(const p of priorDefinitions)await db.query(p.definition.replace(/\r?\n/g,'\r\n'));
  assert.equal((await db.query('SELECT count(*) n FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=ANY($1::text[]) AND position(chr(13) IN prosrc)>0',[patternPriorNames])).rows[0].n,'9');
  const patternMigration=await readFile(new URL('../migrations/0025_pattern_association_worker.sql',import.meta.url),'utf8');
  const priorFinish=priorDefinitions.find(p=>p.signature==='v2_worker_finish_associate(uuid,uuid)')!;
  // Line endings may vary; an unrecorded body or fence change must still abort the entire upgrade.
  for(const changed of [priorFinish.definition.replace('AS $function$','AS $function$\n-- unrecorded body change'),priorFinish.definition.replace('SECURITY DEFINER','SECURITY INVOKER'),priorFinish.definition.replace('SET search_path TO \'pg_catalog\'','SET search_path TO \'public\'')]){
    assert.notEqual(changed,priorFinish.definition);
    await db.query('BEGIN');await db.query(changed);
    await assert.rejects(()=>db.query(patternMigration),(e:unknown)=>e instanceof Error && e.message.includes('pattern_prior_function_changed'));
    await db.query('ROLLBACK');
    assert.equal((await db.query("SELECT to_regclass('public.v2_pattern_catalog') t")).rows[0].t,null);
    assert.equal((await db.query('SELECT count(*) n FROM mabhazi_migrations.applied')).rows[0].n,'25');
  }
  // The hosted editor stores CRLF inside whole SQL scripts as well as prior bodies.
  for(const name of ['0025_pattern_association_worker.sql','0026_identity_lookup.sql']){
    const canonical=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
    await db.query('BEGIN');await db.query(name.startsWith('0026')?canonical.replace(/\r?\n/g,'\r\n'):canonical);
    await db.query('INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(canonical).digest('hex')]);
    await db.query('COMMIT');previousStageLog+=`Applied ${name}\n`;
  }
  const upgradeLog = previousStageLog + await migrate();
  assert.deepEqual(await workerSnapshot(), beforeWorker);
  assert.deepEqual(await associationUpgradeSnapshot(),beforeAssociation);
  assert.equal((await db.query("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='associate' AND state='pending'",[workerUpgrade.subjectId])).rows[0].n,'1');
  assert.equal(beforeWorker[1]!.length,1); assert.equal(beforeWorker[2]!.length,2); assert.equal(beforeWorker[3]!.length,1);

  assert.match(upgradeLog, /Applied 0021_actual_journey_intake.sql/);
  assert.match(upgradeLog, /Applied 0022_minimum_lead_api.sql/);
  assert.match(upgradeLog, /Applied 0023_normalise_worker.sql/);
  assert.match(upgradeLog, /Applied 0024_lead_association_worker.sql/);
  assert.match(upgradeLog, /Applied 0025_pattern_association_worker.sql/);
  assert.match(upgradeLog, /Applied 0026_identity_lookup.sql/);
  assert.deepEqual((await db.query(`SELECT has_function_privilege('mabhazi_api','v2_api_submit_minimum_lead(varchar,text,jsonb)','EXECUTE') api,
    has_function_privilege('anon','v2_api_submit_minimum_lead(varchar,text,jsonb)','EXECUTE') anon,
    has_function_privilege('authenticated','v2_api_submit_minimum_lead(varchar,text,jsonb)','EXECUTE') authenticated`)).rows[0], { api: true, anon: false, authenticated: false });
  assert.doesNotMatch(await migrate(), /Applied /);
  assert.deepEqual((await db.query("SELECT to_jsonb(l) AS lead,to_jsonb(c) AS contribution FROM v2_leads l JOIN v2_contributions c ON c.id=l.initial_contribution_id WHERE l.subject_id=$1", [upgradeSubject])).rows, intakeSnapshot);
  assert.deepEqual((await db.query("SELECT * FROM v2_observations WHERE id=$1", [upgradeObservation.id])).rows[0], upgradeObservation);
  assert.deepEqual((await db.query("SELECT path,city_id FROM v2_observation_refs WHERE observation_id=$1", [upgradeObservation.id])).rows, [{ path: "value.cityId", city_id: upgradeCities[0] }]);
  assert.deepEqual((await db.query("SELECT * FROM v2_observation_states WHERE observation_id=$1", [upgradeObservation.id])).rows[0], upgradeState);
  assert.deepEqual((await db.query("SELECT * FROM v2_observation_events WHERE observation_id=$1 ORDER BY revision", [upgradeObservation.id])).rows, upgradeEvents);
  assert.deepEqual((await db.query("SELECT revision,assignment_id FROM v2_observation_targets WHERE observation_id=$1", [upgradeObservation.id])).rows[0], { revision: "1", assignment_id: null });
  assert.equal((await db.query("SELECT v2_observation_subject($1) id", [upgradeObservation.id])).rows[0].id, upgradeSubject);
  assert.deepEqual((await db.query("SELECT * FROM v2_sources WHERE id=$1", [upgradeSource.id])).rows[0], upgradeSource);
  assert.deepEqual((await db.query("SELECT * FROM v2_observation_targets WHERE observation_id=$1", [upgradeObservation.id])).rows, upgradeTargets);
  assert.equal((await db.query("SELECT count(*) FROM v2_source_relations")).rows[0].count, "0");
  assert.equal((await db.query("SELECT v2_source_footprint($1) f", [upgradeObservation.id])).rows[0].f.known, false);
  assert.deepEqual((await db.query("SELECT * FROM v2_source_graph")).rows, upgradeGraph);
  assert.deepEqual((await db.query("SELECT * FROM v2_field_assessments WHERE id=$1",[upgradeAssessment])).rows[0],assessmentSnapshot);
  assert.deepEqual((await db.query("SELECT * FROM v2_field_decisions WHERE id=$1",[upgradeField])).rows[0],fieldSnapshot);
  assert.equal((await db.query("SELECT count(*) FROM v2_field_resolutions")).rows[0].count,"0");
  assert.deepEqual((await db.query("SELECT to_jsonb(c) claim,to_jsonb(p) proof FROM v2_affiliation_claims c JOIN v2_affiliation_proofs p ON p.claim_id=c.id WHERE c.id=$1",[upgradeClaim])).rows,affiliationSnapshot);
  assert.deepEqual(await promptSnapshot(),upgradePrompts);
  assert.deepEqual(await propagationSnapshot(),upgradePropagation);
  assert.deepEqual(await writerSnapshot(),upgradeWriters);
  assert.deepEqual(await originSnapshot(),upgradeOrigins);
  assert.deepEqual(await creationSnapshot(),upgradeCreations);
  assert.deepEqual(await parentSnapshot(),upgradeParents);
  assert.deepEqual(await legacyActualSnapshot(),upgradeActual);
  assert.equal((await db.query("SELECT initial_contribution_id FROM v2_actual_journeys WHERE subject_id=$1",[legacyActual])).rows[0].initial_contribution_id,null);
  assert.equal((await db.query("SELECT count(*) FROM v2_subject_revisions WHERE subject_id=$1",[legacyActual])).rows[0].count,"0");
  assert.equal((await db.query("SELECT count(*) FROM v2_source_issuers")).rows[0].count,"0");
  preservedIntakeUpgrade = true;
  // Remove only this synthetic setup fixture; each behavioural case rolls back.
  await db.query("BEGIN");
  await db.query("DELETE FROM v2_sources WHERE id=$1", [upgradeSource.id]);
  await db.query("DELETE FROM v2_contributions WHERE id=$1", [upgradeContribution]);
  await db.query("DELETE FROM v2_jobs WHERE subject_id=$1", [upgradeSubject]);
  await db.query("DELETE FROM v2_leads WHERE subject_id=$1", [upgradeSubject]);
  await db.query("DELETE FROM v2_subjects WHERE id=$1", [upgradeSubject]);
  // Keep the corridor shared with retained0016 atomic-origin upgrade evidence.
  // Preserve upgrade cities referenced by independently retained writer evidence.
  // Keep the independently checked writer fixture and its actor until DB teardown.
  await db.query("COMMIT");
});
after(async () => {
  if (db) await db.end();
  if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
  await admin.end();
});
beforeEach(async () => {
  await db.query("BEGIN");
  user = randomUUID(); other = randomUUID();
  await db.query("INSERT INTO users(id) VALUES($1),($2)", [user, other]);
  const rows = (await db.query("INSERT INTO cities(name,place_type) VALUES('Intake origin','city'),('Intake destination','city') RETURNING id")).rows;
  origin = rows[0].id; destination = rows[1].id;
  corridor = (await db.query("INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$2) RETURNING id", [origin, destination])).rows[0].id;
});
afterEach(async () => { await db.query("ROLLBACK"); });

async function rejectQuery(sql: string, values: unknown[] = [], codes = ["23514"]) {
  await db.query("SAVEPOINT invalid_input");
  try {
    await assert.rejects(db.query(sql, values), (err: unknown) => {
      assert.ok(err instanceof Error && "code" in err);
      assert.ok(codes.includes(String(err.code)), `unexpected PostgreSQL error ${String(err.code)}: ${err.message}`);
      return true;
    });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT invalid_input");
    await db.query("RELEASE SAVEPOINT invalid_input");
  }
}
async function contribution(subjectId: string, owner = user, clientId = randomUUID()) {
  const id = randomUUID();
  await db.query(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
    VALUES($1,$2,$3,'1.0','contribute_tab',$4,'{}',$5)`, [id, owner, clientId, hash, subjectId]);
  return { id, owner, clientId, subjectId };
}
async function lead(seconds: number | null = 8 * 3600, name: string | null = "Test operator") {
  const subjectId = randomUUID();
  await db.query("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [subjectId]);
  const c = await contribution(subjectId);
  await db.query(`INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id)
    VALUES($1,$2,$3,$4,$5)`, [subjectId, corridor, seconds, name, c.id]);
  return c;
}
type Contribution = Awaited<ReturnType<typeof contribution>>;
async function observation(c: Contribution, field = "departure.reported", value: unknown = { time: "08:00", basis: "unspecified" }, scope: unknown = {}, supersedes: string | null = null) {
  return (await db.query(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,supersedes_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [c.id, c.subjectId, field, JSON.stringify(value), JSON.stringify(scope), hash, hash2, supersedes])).rows[0];
}
const fareScope = () => ({ schemaVersion: "1.0", segment: { kind: "city_pair", originCityId: origin, destinationCityId: destination }, passengerCategory: "adult", ticketBasis: "one_way", serviceDate: "2026-10-01" });
async function receipt(c: Contribution) {
  await db.query(`INSERT INTO v2_receipts(user_id,client_submission_id,contribution_id,semantic_hash,initial_response)
    VALUES($1,$2,$3,$4,$5)`, [c.owner, c.clientId, c.id, hash, { status: "saved", contributionId: c.id }]);
}
async function job(c: Contribution) {
  return (await db.query(`INSERT INTO v2_jobs(kind,subject_id,contribution_id,requested_generation,policy_version,trigger_id)
    VALUES('normalise',$1,$2,1,'evidence/1',$3) RETURNING *`, [c.subjectId, c.id, randomUUID()])).rows[0];
}

test("populated upgrade preserves legacy rows and records checksums once", async () => {
  assert.equal(preservedIntakeUpgrade, true);
  assert.deepEqual((await db.query("SELECT to_jsonb(j) AS row FROM journeys j ORDER BY id")).rows, legacySnapshot);
  const ledger = (await db.query("SELECT name,checksum FROM mabhazi_migrations.applied ORDER BY name")).rows;
  assert.equal(ledger.length, 27);
  for (const entry of ledger) {
    const sql = await readFile(new URL(`../migrations/${entry.name}`, import.meta.url), "utf8");
    assert.equal(entry.checksum, createHash("sha256").update(sql).digest("hex"));
  }
  assert.equal((await db.query("SELECT count(*) FROM v2_leads WHERE corridor_id=$1", [corridor])).rows[0].count, "0");
});

test("all Drizzle query columns, primary keys, types and generated fields match the migrated database", async () => {
  for (const table of [...intakeTables, ...processingTables, ...identityLookupTables, ...transportTables, ...reviewTables, ...derivedTables, ...observationRegistryTables, ...observationEventTables, ...observationTargetTables, ...sourceIdentityTables, ...evidenceAssessmentTables, ...fieldResolutionTables, ...affiliationIssuerTables, ...promptTables, ...transportPropagationTables, ...transportWriterTables, ...transportCreationTables, ...routePatternCreationTables]) {
    const name = getTableName(table);
    const actual = (await db.query(`SELECT column_name,data_type,is_nullable,is_generated FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY column_name`, [name])).rows;
    const columns = Object.values(getTableColumns(table));
    assert.deepEqual(actual.map(r => r.column_name), columns.map(c => c.name).sort(), name);
    const aliases: Record<string, string> = { "timestamp with time zone": "timestamp with time zone", "date": "date", "varchar": "character varying", "integer": "integer", "bigint": "bigint", "boolean": "boolean", "uuid": "uuid", "text": "text", "jsonb": "jsonb" };
    for (const column of columns) {
      const row = actual.find(r => r.column_name === column.name)!;
      assert.equal(row.data_type, column.getSQLType().endsWith("[]") ? "ARRAY" : column.getSQLType().startsWith("numeric") ? "numeric" : aliases[column.getSQLType()], `${name}.${column.name} type`);
      assert.equal(row.is_nullable === "NO", column.notNull, `${name}.${column.name} nullability`);
      assert.equal(row.is_generated === "ALWAYS", !!column.generated, `${name}.${column.name} generated`);
    }
    const expectedPk = [...columns.filter(c => c.primary).map(c => c.name), ...getTableConfig(table).primaryKeys.flatMap(k => k.columns.map(c => c.name))].sort();
    const actualPk = (await db.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
      WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attname`, [`public.${name}`])).rows.map(r => r.attname);
    assert.deepEqual(actualPk, expectedPk, `${name} primary key`);
  }
});

test("four details suffice, midnight is explicit, no price or recurring schedule is invented", async () => {
  const c = await lead(0);
  await observation(c, "departure.reported", { time: "00:00", basis: "unspecified" });
  await receipt(c); await job(c);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  const row = (await db.query("SELECT * FROM v2_leads WHERE subject_id=$1", [c.subjectId])).rows[0];
  assert.equal(row.reported_departure_seconds, 0);
  assert.equal(row.resolved_status, "unresolved");
  assert.equal((await db.query("SELECT count(*) FROM v2_observations WHERE field_key LIKE 'fare.%'")).rows[0].count, "0");
  assert.equal((await db.query("SELECT knowledge_basis,observed_from FROM v2_observations")).rows[0].knowledge_basis, "unprovided");
  assert.equal((await db.query("SELECT observed_from FROM v2_observations")).rows[0].observed_from, null);
});

test("community leads reject missing required fields and sentinel operators", async () => {
  const c = await lead();
  for (const column of ["corridor_id", "reported_departure_seconds", "operator_name", "initial_contribution_id"]) {
    await rejectQuery(`UPDATE v2_leads SET ${column}=NULL WHERE subject_id=$1`, [c.subjectId]);
  }
  for (const name of ["", "unknown", "UNKNOWN", "n/a", "-", " Operator", "Operator\n"]) {
    await rejectQuery("UPDATE v2_leads SET operator_name=$1 WHERE subject_id=$2", [name, c.subjectId]);
  }
  for (const seconds of [-1, 86400]) await rejectQuery("UPDATE v2_leads SET reported_departure_seconds=$1 WHERE subject_id=$2", [seconds, c.subjectId]);
  await rejectQuery("INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$1)", [origin]);
});

test("subject registry requires the correct subtype at commit and stable identities", async () => {
  const c = await lead();
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await rejectQuery("INSERT INTO v2_subjects(kind) VALUES('lead')");
  await rejectQuery("UPDATE v2_subjects SET kind='operator' WHERE id=$1", [c.subjectId]);
  await rejectQuery("UPDATE v2_leads SET subject_id=gen_random_uuid() WHERE subject_id=$1", [c.subjectId]);
  await rejectQuery("DELETE FROM v2_leads WHERE subject_id=$1", [c.subjectId]);
  await rejectQuery("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Wrong subtype')", [c.subjectId], ["23503"]);
});

test("retry keys are per account and receipts cannot change owner, hash or contribution", async () => {
  const c = await lead(); await receipt(c);
  await rejectQuery(`INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
    VALUES($1,$2,'1.0','contribute_tab',$3,'{}',$4)`, [user, c.clientId, hash2, c.subjectId], ["23505"]);
  const d = await contribution(c.subjectId, other, c.clientId); await receipt(d);
  await rejectQuery(`INSERT INTO v2_receipts(user_id,client_submission_id,contribution_id,semantic_hash,initial_response)
    VALUES($1,$2,$3,$4,'{}')`, [other, randomUUID(), c.id, hash], ["23503"]);
  await rejectQuery("UPDATE v2_receipts SET initial_response='{}' WHERE contribution_id=$1", [c.id]);
  assert.equal((await db.query("SELECT count(*) FROM v2_receipts WHERE user_id=ANY($1::varchar[])", [[user,other]])).rows[0].count, "2");
});

test("typed observations reject unsupported fields, missing qualifiers and invalid money or time", async () => {
  const c = await lead();
  const valid = await observation(c, "fare.paid", { amount: "0.00", currency: "USD" }, fareScope());
  assert.equal(valid.value.amount, "0.00");
  const invalid: [string, unknown, unknown][] = [
    ["departure.reported", { time: "24:00", basis: "scheduled" }, {}],
    ["departure.reported", { time: "08:00\n", basis: "scheduled" }, {}],
    ["departure.reported", { time: "08:00" }, {}],
    ["departure.reported", { time: "08:00", basis: "actual" }, { weekdays: [1] }],
    ["operator.reported", { name: "unknown" }, {}],
    ["unregistered.field", { arbitrary: true }, {}],
    ["fare.paid", { amount: "-1", currency: "USD" }, fareScope()],
    ["fare.paid", { amount: 10, currency: "USD" }, fareScope()],
    ["fare.paid", { amount: "1.001", currency: "USD" }, fareScope()],
    ["fare.paid", { amount: "1", currency: "usd" }, fareScope()],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), serviceDate: null }],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), serviceDate: "2026-02-30" }],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), effectiveFrom: "2026-10-10", effectiveTo: "2026-10-01" }],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), passengerCategory: "other" }],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), ticketLabel: { bad: true } }],
    ["fare.paid", { amount: "1", currency: "USD" }, { ...fareScope(), timeBasis: "verified" }],
  ];
  for (const [field, value, scope] of invalid) {
    await rejectQuery(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key)
      VALUES($1,$2,$3,$4,$5,$6,$6)`, [c.id, c.subjectId, field, JSON.stringify(value), JSON.stringify(scope), hash]);
  }
});

test("JSON reference columns reject missing places/operators and prevent referenced deletion", async () => {
  const c = await lead();
  await rejectQuery(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
    VALUES($1,$2,'operator.reported',$3,$4,$4)`, [c.id, c.subjectId, { id: randomUUID() }, hash], ["23503"]);
  await rejectQuery(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
    VALUES($1,$2,'boarding.pickup',$3,$4,$4)`, [c.id, c.subjectId, { cityId: 999999999, name: "Terminal" }, hash], ["23503"]);
  const city = (await db.query("INSERT INTO cities(name,place_type) VALUES('Pickup only','city') RETURNING id")).rows[0].id;
  await observation(c, "boarding.pickup", { cityId: city, name: "Terminal" });
  await rejectQuery("DELETE FROM cities WHERE id=$1", [city], ["23503"]);
});

test("corrections append history and cannot supersede another account or field", async () => {
  const c = await lead(); const original = await observation(c);
  const next = await contribution(c.subjectId);
  const corrected = await observation(next, "departure.reported", { time: "09:00", basis: "scheduled" }, {}, original.id);
  assert.equal(corrected.supersedes_id, original.id);
  await rejectQuery("UPDATE v2_observations SET supersedes_id=NULL WHERE id=$1", [corrected.id]);
  await rejectQuery("UPDATE v2_observations SET value=$1 WHERE id=$2", [{ time: "10:00", basis: "scheduled" }, original.id]);
  const theirs = await contribution(c.subjectId, other);
  await rejectQuery(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key,supersedes_id)
    VALUES($1,$2,'departure.reported',$3,$4,$4,$5)`, [theirs.id, c.subjectId, { time: "09:00", basis: "actual" }, hash, original.id]);
  await rejectQuery(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key,observed_from)
    VALUES($1,$2,'departure.reported',$3,$4,$4,current_date+2)`, [c.id, c.subjectId, { time: "09:00", basis: "actual" }, hash]);
  assert.equal((await db.query("SELECT count(*) FROM v2_observations WHERE original_subject_id=$1", [c.subjectId])).rows[0].count, "2");
  assert.equal((await db.query("SELECT count(*) FROM v2_observation_states WHERE observation_id=ANY($1::uuid[])", [[original.id,corrected.id]])).rows[0].count, "2");
});

test("private evidence links enforce ownership", async () => {
  const c = await lead(); const o = await observation(c);
  const source = (await db.query("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','private fixture') RETURNING id", [other])).rows[0].id;
  await rejectQuery("INSERT INTO v2_observation_sources(observation_id,source_id) VALUES($1,$2)", [o.id, source]);
  await rejectQuery("UPDATE v2_sources SET owner_user_id=$1 WHERE id=$2", [user, source]);
});

test("account deletion erases private rows, preserves others, invalidates pending work and schedules recomputation", async () => {
  const c = await lead(); await receipt(c); const pending = await job(c);
  const old = await observation(c); const newer = await contribution(c.subjectId);
  await observation(newer, "departure.reported", { time: "09:00", basis: "unspecified" }, {}, old.id);
  const survivor = await contribution(c.subjectId, other); const survivorObservation = await observation(survivor);
  const source = (await db.query("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','private fixture') RETURNING id", [user])).rows[0].id;
  await db.query("INSERT INTO v2_observation_sources(observation_id,source_id) VALUES($1,$2)", [old.id, source]);
  await db.query("UPDATE v2_jobs SET state='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' WHERE id=$1", [pending.id]);
  const beforeErase = BigInt((await db.query("SELECT input_generation FROM v2_subjects WHERE id=$1", [c.subjectId])).rows[0].input_generation);
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  assert.equal((await db.query("SELECT count(*) FROM v2_receipts WHERE user_id=$1", [user])).rows[0].count,"0");
  for (const table of ["v2_sources", "v2_observation_sources"]) assert.equal((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0", table);
  assert.deepEqual((await db.query("SELECT id FROM v2_contributions WHERE original_subject_id=$1", [c.subjectId])).rows, [{ id: survivor.id }]);
  assert.deepEqual((await db.query("SELECT id FROM v2_observations WHERE original_subject_id=$1", [c.subjectId])).rows, [{ id: survivorObservation.id }]);
  const retained = (await db.query("SELECT * FROM v2_leads WHERE subject_id=$1", [c.subjectId])).rows[0];
  assert.equal(retained.initial_contribution_id, null); assert.equal(retained.attribution_erased, true);
  const cancelled = (await db.query("SELECT * FROM v2_jobs WHERE id=$1", [pending.id])).rows[0];
  assert.equal(cancelled.state, "superseded"); assert.equal(cancelled.contribution_id, null); assert.equal(cancelled.lease_token, null);
  const erasedGeneration = (await db.query("SELECT input_generation FROM v2_subjects WHERE id=$1", [c.subjectId])).rows[0].input_generation;
  // Account, source and observation invalidations can each advance generation.
  // The required contract is stale old work plus durable work for the final state.
  assert.ok(BigInt(erasedGeneration) > beforeErase);
  assert.equal((await db.query("SELECT max(requested_generation) generation FROM v2_jobs WHERE kind='erase_recompute' AND subject_id=$1", [c.subjectId])).rows[0].generation, erasedGeneration);
});

test("deleting an old observation clears correction lineage without rewriting the newer evidence", async () => {
  const c = await lead(); const old = await observation(c); const next = await contribution(c.subjectId);
  const corrected = await observation(next, "departure.reported", { time: "09:00", basis: "scheduled" }, {}, old.id);
  await db.query("DELETE FROM v2_observations WHERE id=$1", [old.id]);
  const row = (await db.query("SELECT * FROM v2_observations WHERE id=$1", [corrected.id])).rows[0];
  assert.equal(row.supersedes_id, null); assert.deepEqual(row.value, corrected.value);
});

test("outbox keys, lease shape and subject ownership reject inconsistent jobs", async () => {
  const c = await lead(); const j = await job(c); const d = await lead();
  await rejectQuery("UPDATE v2_jobs SET subject_id=NULL WHERE id=$1", [j.id], ["23502"]);
  await rejectQuery("UPDATE v2_jobs SET subject_id=$1 WHERE id=$2", [d.subjectId, j.id], ["23503"]);
  await rejectQuery("UPDATE v2_jobs SET state='leased' WHERE id=$1", [j.id]);
  await rejectQuery(`INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    VALUES($1,$2,$3,$4,$5)`, [j.kind, j.subject_id, j.requested_generation, j.policy_version, j.trigger_id], ["23505"]);
});

test("failed transaction leaves no contribution, receipt or job", async () => {
  const tables=["v2_subjects","v2_leads","v2_contributions","v2_receipts","v2_jobs"];
  const before=new Map<string,string>();
  for(const table of tables) before.set(table,(await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  await db.query("SAVEPOINT interrupted_submit");
  const c = await lead(); await receipt(c); await job(c);
  await db.query("ROLLBACK TO SAVEPOINT interrupted_submit");
  for (const table of tables) {
    assert.equal((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count, before.get(table), table);
  }
});

test("all intake tables enable RLS and deny PUBLIC/anon/authenticated while permitting the server role", async () => {
  const tables = [...intakeTables, ...processingTables, ...identityLookupTables, ...transportTables, ...reviewTables, ...derivedTables, ...observationRegistryTables, ...observationEventTables, ...observationTargetTables, ...sourceIdentityTables, ...evidenceAssessmentTables, ...fieldResolutionTables, ...affiliationIssuerTables, ...promptTables, ...transportPropagationTables, ...transportWriterTables, ...transportCreationTables, ...routePatternCreationTables].map(getTableName);
  const policies = (await db.query("SELECT tablename,roles::text[] AS roles,cmd FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])", [tables])).rows;
  assert.equal(policies.length, tables.length);
  for (const policy of policies) { assert.deepEqual(policy.roles, ["mabhazi_api"]); assert.equal(policy.cmd, ["v2_jobs", "v2_job_effects", ...processingTables.map(getTableName), ...identityLookupTables.map(getTableName), "v2_observation_refs", "v2_observation_events", ...observationTargetTables.map(getTableName), ...sourceIdentityTables.map(getTableName), ...evidenceAssessmentTables.map(getTableName), ...fieldResolutionTables.map(getTableName), ...affiliationIssuerTables.map(getTableName), ...promptTables.map(getTableName), ...transportPropagationTables.map(getTableName), ...transportWriterTables.map(getTableName), ...transportCreationTables.map(getTableName), ...routePatternCreationTables.map(getTableName)].includes(policy.tablename) ? "SELECT" : "ALL"); }
  const rls = (await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", [tables])).rows;
  assert.ok(rls.every(row => row.relrowsecurity));
  const publicGrants = await db.query(`SELECT c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND a.grantee=0`, [tables]);
  assert.equal(publicGrants.rowCount, 0);
  for (const role of ["anon", "authenticated"]) {
    await db.query(`SET LOCAL ROLE ${role}`);
    for (const table of tables) await rejectQuery(`SELECT * FROM ${table}`, [], ["42501"]);
    await db.query("RESET ROLE");
  }
  await db.query("SET LOCAL ROLE mabhazi_api");
  const c = await lead(); await observation(c); await receipt(c);
  await rejectQuery("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('normalise',$1,1,'intake/1',gen_random_uuid())", [c.subjectId], ["42501"]);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  await db.query("RESET ROLE");
});

registerTransportTests(() => ({ db, connectionString, origin, destination, corridor }));

registerReviewTests(() => ({ db, connectionString, user, other, corridor }));

registerDerivedTests(() => ({ db, connectionString, user, other, corridor }));

registerObservationRegistryTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerObservationEventTests(() => ({ db, connectionString, user, other, corridor }));

registerObservationTargetTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerSourceIdentityTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerAssessmentTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));
registerFieldResolutionTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerAffiliationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerPromptTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerPropagationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerWriterTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerLeadCreationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerTransportCreationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerRoutePatternTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerServiceRunTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerActualIntakeTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));

registerProcessingTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));
registerLeadAssociationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));
registerPatternAssociationTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));
registerIdentityLookupTests(() => ({ db, connectionString, user, other, origin, destination, corridor }));
