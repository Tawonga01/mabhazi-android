import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { intakeTables } from "./schema/contributionIntake";
import { transportTables } from "./schema/transportStructure";
import { reviewTables } from "./schema/reviewDecisions";
import { derivedTables } from "./schema/derivedDecisions";
import { registerTransportTests } from "./transport-structure.cases";
import { registerReviewTests } from "./review-decisions.cases";
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
  for (const name of ["0000_initial.sql", "0001_api_role.sql", "0002_contribution_intake.sql", "0003_transport_structure.sql", "0004_review_decisions.sql"]) {
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
  const intakeSnapshot = (await db.query("SELECT to_jsonb(l) AS lead,to_jsonb(c) AS contribution FROM v2_leads l JOIN v2_contributions c ON c.id=l.initial_contribution_id WHERE l.subject_id=$1", [upgradeSubject])).rows;
  // Model hosted defaults granting client roles access to newly created tables.
  // 0005 must actively revoke these grants, not merely rely on fresh PG defaults.
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
  assert.match(await migrate(), /Applied 0005_derived_decisions.sql/);
  assert.doesNotMatch(await migrate(), /Applied /);
  assert.deepEqual((await db.query("SELECT to_jsonb(l) AS lead,to_jsonb(c) AS contribution FROM v2_leads l JOIN v2_contributions c ON c.id=l.initial_contribution_id WHERE l.subject_id=$1", [upgradeSubject])).rows, intakeSnapshot);
  preservedIntakeUpgrade = true;
  // Remove only this synthetic setup fixture; each behavioural case rolls back.
  await db.query("BEGIN");
  await db.query("DELETE FROM v2_contributions WHERE id=$1", [upgradeContribution]);
  await db.query("DELETE FROM v2_leads WHERE subject_id=$1", [upgradeSubject]);
  await db.query("DELETE FROM v2_subjects WHERE id=$1", [upgradeSubject]);
  await db.query("DELETE FROM v2_corridors WHERE id=$1", [upgradeCorridor]);
  await db.query("DELETE FROM cities WHERE id=ANY($1::int[])", [upgradeCities]);
  await db.query("DELETE FROM users WHERE id=$1", [upgradeUser]);
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
  assert.equal(ledger.length, 6);
  for (const entry of ledger) {
    const sql = await readFile(new URL(`../migrations/${entry.name}`, import.meta.url), "utf8");
    assert.equal(entry.checksum, createHash("sha256").update(sql).digest("hex"));
  }
  assert.equal((await db.query("SELECT count(*) FROM v2_leads")).rows[0].count, "0");
});

test("all Drizzle query columns, primary keys, types and generated fields match the migrated database", async () => {
  for (const table of [...intakeTables, ...transportTables, ...reviewTables, ...derivedTables]) {
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
  assert.equal((await db.query("SELECT count(*) FROM v2_receipts")).rows[0].count, "2");
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
  assert.equal((await db.query("SELECT count(*) FROM v2_observations")).rows[0].count, "2");
  assert.equal((await db.query("SELECT count(*) FROM v2_observation_states")).rows[0].count, "2");
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
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  for (const table of ["v2_receipts", "v2_sources", "v2_observation_sources"]) assert.equal((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0", table);
  assert.deepEqual((await db.query("SELECT id FROM v2_contributions")).rows, [{ id: survivor.id }]);
  assert.deepEqual((await db.query("SELECT id FROM v2_observations")).rows, [{ id: survivorObservation.id }]);
  const retained = (await db.query("SELECT * FROM v2_leads WHERE subject_id=$1", [c.subjectId])).rows[0];
  assert.equal(retained.initial_contribution_id, null); assert.equal(retained.attribution_erased, true);
  const cancelled = (await db.query("SELECT * FROM v2_jobs WHERE id=$1", [pending.id])).rows[0];
  assert.equal(cancelled.state, "superseded"); assert.equal(cancelled.contribution_id, null); assert.equal(cancelled.lease_token, null);
  assert.deepEqual((await db.query("SELECT requested_generation FROM v2_jobs WHERE kind='erase_recompute'")).rows, [{ requested_generation: "2" }]);
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
  await db.query("SAVEPOINT interrupted_submit");
  const c = await lead(); await receipt(c); await job(c);
  await db.query("ROLLBACK TO SAVEPOINT interrupted_submit");
  for (const table of ["v2_subjects", "v2_leads", "v2_contributions", "v2_receipts", "v2_jobs"]) {
    assert.equal((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count, "0", table);
  }
});

test("all intake tables enable RLS and deny PUBLIC/anon/authenticated while permitting the server role", async () => {
  const tables = [...intakeTables, ...transportTables, ...reviewTables, ...derivedTables].map(getTableName);
  const policies = (await db.query("SELECT tablename,roles::text[] AS roles,cmd FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])", [tables])).rows;
  assert.equal(policies.length, tables.length);
  for (const policy of policies) { assert.deepEqual(policy.roles, ["mabhazi_api"]); assert.equal(policy.cmd, "ALL"); }
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
  const c = await lead(); await observation(c); await receipt(c); await job(c);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  await db.query("RESET ROLE");
});

registerTransportTests(() => ({ db, connectionString, origin, destination, corridor }));

registerReviewTests(() => ({ db, connectionString, user, other, corridor }));

registerDerivedTests(() => ({ db, connectionString, user, other, corridor }));
