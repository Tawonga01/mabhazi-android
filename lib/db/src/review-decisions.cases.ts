import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { getTableName } from "drizzle-orm";
import { reviewTables } from "./schema/reviewDecisions";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; corridor: string };
const scope = "a".repeat(64);
const recordSql = "SELECT v2_record_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id";
const roleSql = "SELECT v2_change_review_role($1,$2,$3,$4,$5) AS id";
const openSql = "SELECT v2_open_review_case($1,$2,$3,$4,$5) AS id";

export function registerReviewTests(context: () => Context) {
  const query = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function reject(sql: string, values: unknown[] = [], codes = ["23514"]) {
    await query("SAVEPOINT invalid_review");
    try {
      await assert.rejects(query(sql, values), (e: unknown) => {
        assert.ok(e instanceof Error && "code" in e);
        assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
      });
    } finally { await query("ROLLBACK TO SAVEPOINT invalid_review"); await query("RELEASE SAVEPOINT invalid_review"); }
  }
  async function fixture() {
    const { user, other, corridor } = context();
    const reviewer: string = randomUUID(), subject = randomUUID(), contribution = randomUUID();
    await query("INSERT INTO users(id) VALUES($1)", [reviewer]);
    await query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','bootstrap')", [other]);
    await query(roleSql, [other, reviewer, "reviewer", "grant", "delegated_review"]);
    await query("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [subject]);
    await query(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, user, scope, subject]);
    await query(`INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id)
      VALUES($1,$2,28800,'Review fixture',$3)`, [subject, corridor, contribution]);
    const observation = (await query(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
      VALUES($1,$2,'departure.reported','{"time":"08:00","basis":"scheduled"}',$3,$3) RETURNING id`, [contribution, subject, scope])).rows[0].id as string;
    const caseId = (await query(openSql, [reviewer, subject, "identity", null, null])).rows[0].id as string;
    return { user, administrator: other, reviewer, subject, contribution, observation, caseId };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function args(f: Fixture, action = "accept", expected = 1, expectedSubject = 1, evidence: string[] | null = [f.observation], reverse: string | null = null) {
    return [f.reviewer, f.caseId, expected, expectedSubject, action, "evidence_reviewed", "Private fixture rationale", evidence, "review/1", reverse];
  }
  async function record(f: Fixture, action = "accept", expected = 1, expectedSubject = 1, evidence: string[] | null = [f.observation], reverse: string | null = null) {
    return (await query(recordSql, args(f, action, expected, expectedSubject, evidence, reverse))).rows[0].id as string;
  }

  test("review: registry requires a real subtype and rejects future placeholder kinds", async () => {
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    await reject("INSERT INTO v2_decision_ids(kind) VALUES('review')");
    await reject("INSERT INTO v2_decision_ids(kind) VALUES('field')");
  });
  test("review: server reads through RLS but cannot forge roles, cases, decisions or evidence", async () => {
    const f = await fixture();
    await query("SET LOCAL ROLE mabhazi_api");
    for (const table of reviewTables.map(getTableName)) {
      await query(`SELECT * FROM ${table}`);
      await reject(`DELETE FROM ${table}`, [], ["42501"]);
    }
    await reject("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','forged')", [f.user], ["42501"]);
    await record(f);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    await query("RESET ROLE");
  });
  test("review: role grants and revocations are audited, idempotent and immutable", async () => {
    const f = await fixture();
    const input = [f.administrator, f.user, "reviewer", "grant", "delegated_review"];
    const grant = (await query(roleSql, input)).rows[0].id;
    assert.equal((await query(roleSql, input)).rows[0].id, grant);
    assert.equal((await query("SELECT count(*) FROM v2_role_events WHERE target_user_id=$1", [f.user])).rows[0].count, "1");
    await query(roleSql, [f.administrator, f.user, "reviewer", "revoke", "access_revoked"]);
    await query(roleSql, [f.administrator, f.user, "reviewer", "revoke", "access_revoked"]);
    assert.deepEqual((await query("SELECT action FROM v2_role_events WHERE target_user_id=$1 ORDER BY action", [f.user])).rows, [{ action: "grant" }, { action: "revoke" }]);
    await reject("UPDATE v2_review_roles SET revoked_at=NULL WHERE id=$1", [grant]);
    await reject("UPDATE v2_review_roles SET role='administrator' WHERE id=$1", [grant]);
    await reject("DELETE FROM v2_role_events WHERE target_user_id=$1", [f.user]);
    const regrant = (await query(roleSql, input)).rows[0].id; assert.notEqual(regrant, grant);
  });
  test("review: no self promotion, unprivileged delegation or null role-change bypass", async () => {
    const f = await fixture();
    await reject(roleSql, [f.administrator, f.administrator, "reviewer", "grant", "forged"]);
    for (const actor of [f.user, f.reviewer]) await reject(roleSql, [actor, f.administrator, "administrator", "grant", "forged"], ["42501"]);
    for (const input of [[f.administrator, f.user, null, "grant", "reason"], [f.administrator, f.user, "reviewer", null, "reason"], [f.administrator, f.user, "reviewer", "grant", null]]) await reject(roleSql, input);
    await reject(recordSql, [f.user, ...args(f).slice(1)], ["42501"]);
    await reject(openSql, [f.user, f.subject, "identity", null, null], ["42501"]);
  });
  test("review: revoking authority denies subsequent decisions and keeps history", async () => {
    const f = await fixture(); const id = await record(f, "needs_context", 1, 1, []);
    await query(roleSql, [f.administrator, f.reviewer, "reviewer", "revoke", "access_revoked"]);
    await reject(recordSql, args(f, "accept", 2, 2), ["42501"]);
    assert.equal((await query("SELECT count(*) FROM v2_review_decisions WHERE id=$1", [id])).rows[0].count, "1");
  });
  test("review: queue target, kind and field/scope shapes are constrained", async () => {
    const f = await fixture();
    await reject(openSql, [f.reviewer, randomUUID(), "identity", null, null], ["23503"]);
    await reject(openSql, [f.reviewer, f.subject, "conflict", null, null]);
    await reject(openSql, [f.reviewer, f.subject, "correction", "departure.reported", null]);
    await reject(openSql, [f.reviewer, f.subject, "affiliation", null, null]);
    await reject(openSql, [f.reviewer, f.subject, "invented", null, null]);
    await query(openSql, [f.reviewer, f.subject, "conflict", "departure.reported", scope]);
  });
  test("review: atomic decision keeps evidence, advances case/subject and schedules assessment", async () => {
    const f = await fixture(); const id = await record(f);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await query("SELECT state,revision,last_decision_id FROM v2_review_cases WHERE id=$1", [f.caseId])).rows[0], { state: "resolved", revision: "2", last_decision_id: id });
    assert.deepEqual((await query("SELECT revision,input_generation FROM v2_subjects WHERE id=$1", [f.subject])).rows[0], { revision: "2", input_generation: "2" });
    assert.deepEqual((await query("SELECT observation_id FROM v2_review_decision_evidence WHERE decision_id=$1", [id])).rows, [{ observation_id: f.observation }]);
    assert.deepEqual((await query("SELECT kind,requested_generation FROM v2_jobs WHERE trigger_id=$1", [id])).rows, [{ kind: "assess", requested_generation: "2" }]);
  });
  test("review: stale case or subject rejects without orphan decisions or jobs", async () => {
    const f = await fixture();
    await reject(recordSql, args(f, "accept", 2), ["40001"]);
    await query("UPDATE v2_subjects SET revision=revision+1 WHERE id=$1", [f.subject]);
    await reject(recordSql, args(f), ["40001"]);
    for (const t of ["v2_decision_ids", "v2_review_decisions", "v2_review_decision_evidence", "v2_jobs"]) assert.equal((await query(`SELECT count(*) FROM ${t}`)).rows[0].count, "0");
    await record(f, "accept", 1, 2);
  });
  test("review: affirmative evidence cannot be missing, duplicate, hidden, withdrawn or unrelated", async () => {
    const f = await fixture();
    for (const evidence of [null, [], [randomUUID()], [f.observation, f.observation], [null]]) await reject(recordSql, [f.reviewer, f.caseId, 1, 1, "accept", "reason", null, evidence, "review/1", null]);
    for (const status of ["hidden", "withdrawn", "superseded"]) {
      await query("UPDATE v2_observation_states SET status=$1 WHERE observation_id=$2", [status, f.observation]);
      await reject(recordSql, args(f));
    }
    await query("UPDATE v2_observation_states SET status='active' WHERE observation_id=$1", [f.observation]);
    const another = randomUUID();
    await query("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')", [another]);
    await query("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Other subject')", [another]);
    const otherCase = (await query(openSql, [f.reviewer, another, "identity", null, null])).rows[0].id;
    await reject(recordSql, args({ ...f, caseId: otherCase }));
  });
  test("review: field decisions cannot borrow evidence from another field or scope", async () => {
    const f = await fixture();
    for (const [field, key] of [["fare.paid", scope], ["departure.reported", "b".repeat(64)]]) {
      const caseId = (await query(openSql, [f.reviewer, f.subject, "conflict", field, key])).rows[0].id;
      await reject(recordSql, args({ ...f, caseId }));
    }
  });
  test("review: decisions and registry are append only; invalid rationale rolls back all writes", async () => {
    const f = await fixture();
    const bad = args(f); bad[6] = "x".repeat(4001); await reject(recordSql, bad);
    assert.equal((await query("SELECT count(*) FROM v2_decision_ids")).rows[0].count, "0");
    const id = await record(f);
    await reject("UPDATE v2_review_decisions SET private_reason=NULL WHERE id=$1", [id]);
    await reject("DELETE FROM v2_review_decisions WHERE id=$1", [id]);
    await reject("UPDATE v2_decision_ids SET created_at=now()+interval '1 second' WHERE id=$1", [id]);
  });
  test("review: reversing the current decision reopens with history and another assessment job", async () => {
    const f = await fixture(); const id = await record(f);
    await reject(recordSql, args(f, "accept", 2, 2));
    await reject(recordSql, args(f, "reverse", 2, 2, [], randomUUID()));
    const reversed = await record(f, "reverse", 2, 2, [], id);
    await reject(recordSql, args(f, "reverse", 3, 3, [], id));
    await reject(recordSql, args(f, "reverse", 3, 3, [], reversed));
    assert.equal((await query("SELECT state FROM v2_review_cases WHERE id=$1", [f.caseId])).rows[0].state, "reopened");
    assert.equal((await query("SELECT count(*) FROM v2_review_decisions")).rows[0].count, "2");
    assert.equal((await query("SELECT count(*) FROM v2_jobs WHERE kind='assess'")).rows[0].count, "2");
    await record(f, "accept", 3, 3);
  });
  test("review: action restrictions keep moderation explicit and affiliation unavailable pending its proof model", async () => {
    const f = await fixture();
    for (const action of ["hide", "restore", "verify_affiliation", "revoke_affiliation"]) await reject(recordSql, args(f, action));
    const caseId = (await query(openSql, [f.reviewer, f.subject, "moderation", null, null])).rows[0].id;
    await reject(recordSql, args({ ...f, caseId }));
    await record({ ...f, caseId }, "hide");
  });
  test("review: evidence erasure redacts the whole case including reversal notes, retaining safe tombstones", async () => {
    const f = await fixture(); const id = await record(f); await record(f, "reverse", 2, 2, [], id);
    await query("DELETE FROM v2_observations WHERE id=$1", [f.observation]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await query("SELECT evidence_erased,private_reason FROM v2_review_decisions WHERE case_id=$1", [f.caseId])).rows, [{ evidence_erased: true, private_reason: null }, { evidence_erased: true, private_reason: null }]);
    assert.equal((await query("SELECT count(*) FROM v2_review_decision_evidence")).rows[0].count, "0");
    assert.deepEqual((await query("SELECT state,revision FROM v2_review_cases WHERE id=$1", [f.caseId])).rows[0], { state: "reopened", revision: "4" });
    assert.equal((await query("SELECT count(*) FROM v2_jobs WHERE kind='erase_recompute' AND trigger_id=$1", [f.observation])).rows[0].count, "1");
  });
  test("review: account deletion works as backend, removes evidence and preserves unrelated review history", async () => {
    const f = await fixture(); await record(f);
    const unrelated = (await query(openSql, [f.administrator, f.subject, "identity", null, null])).rows[0].id;
    const kept = await record({ ...f, reviewer: f.administrator, caseId: unrelated }, "needs_context", 1, 2, []);
    await query("SET LOCAL ROLE mabhazi_api");
    await query("DELETE FROM users WHERE id=$1", [f.user]);
    await query("DELETE FROM users WHERE id=$1", [f.reviewer]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    await query("RESET ROLE");
    const erased = (await query("SELECT actor_user_id,actor_erased,evidence_erased,private_reason FROM v2_review_decisions WHERE case_id=$1", [f.caseId])).rows[0];
    assert.deepEqual(erased, { actor_user_id: null, actor_erased: true, evidence_erased: true, private_reason: null });
    assert.equal((await query("SELECT private_reason FROM v2_review_decisions WHERE id=$1", [kept])).rows[0].private_reason, "Private fixture rationale");
    assert.equal((await query("SELECT count(*) FROM v2_review_roles WHERE user_id=$1", [f.reviewer])).rows[0].count, "0");
    assert.equal((await query("SELECT count(*) FROM v2_role_events WHERE target_user_id=$1 OR actor_user_id=$1", [f.reviewer])).rows[0].count, "0");
  });
  test("review: erasing a reviewer alone removes private rationale without deleting public decision identity", async () => {
    const f = await fixture(); const id = await record(f);
    const reversal = await record({ ...f, reviewer: f.administrator }, "reverse", 2, 2, [], id);
    await query("DELETE FROM users WHERE id=$1", [f.reviewer]);
    assert.equal((await query("SELECT private_reason FROM v2_review_decisions WHERE id=$1", [reversal])).rows[0].private_reason, null);
    await query("DELETE FROM users WHERE id=$1", [f.administrator]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await query("SELECT actor_user_id,actor_erased,evidence_erased,private_reason FROM v2_review_decisions WHERE id=$1", [id])).rows[0], { actor_user_id: null, actor_erased: true, evidence_erased: false, private_reason: null });
    assert.equal((await query("SELECT count(*) FROM v2_review_decision_evidence WHERE decision_id=$1", [id])).rows[0].count, "1");
  });
  test("review: client roles cannot execute privileged functions even with inherited hosted grants", async () => {
    const f = await fixture();
    for (const role of ["anon", "authenticated"]) {
      await query(`SET LOCAL ROLE ${role}`);
      await reject(roleSql, [f.administrator, f.user, "reviewer", "grant", "forged"], ["42501"]);
      await reject(openSql, [f.reviewer, f.subject, "identity", null, null], ["42501"]);
      await reject(recordSql, args(f), ["42501"]);
      await query("RESET ROLE");
    }
    const functions = (await query("SELECT proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('v2_change_review_role','v2_open_review_case','v2_record_review','v2_erase_review_evidence')")).rows;
    assert.equal(functions.length, 4);
    assert.ok(functions.every(f => f.proconfig.includes("search_path=pg_catalog")));
  });
  // Last: these committed rows live only until the disposable database is dropped.
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) test(`review: competing reviewers cannot overwrite at ${isolation}`, { timeout: 20_000 }, async () => {
    const f = await fixture(); await query("COMMIT");
    const left = new pg.Client({ connectionString: context().connectionString });
    const right = new pg.Client({ connectionString: context().connectionString });
    await left.connect(); await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'");
      await right.query("SELECT revision FROM v2_review_cases WHERE id=$1", [f.caseId]);
      await left.query("SET LOCAL ROLE mabhazi_api"); await right.query("SET LOCAL ROLE mabhazi_api");
      await left.query(recordSql, args(f));
      const losing = right.query(recordSql, [f.administrator, ...args(f).slice(1)]).then(() => "unexpected_success", (e: { code: string }) => e.code);
      await left.query("COMMIT");
      assert.equal(await losing, "40001"); await right.query("ROLLBACK");
      assert.equal((await query("SELECT count(*) FROM v2_review_decisions WHERE case_id=$1", [f.caseId])).rows[0].count, "1");
      assert.equal((await query("SELECT revision FROM v2_subjects WHERE id=$1", [f.subject])).rows[0].revision, "2");
    } finally {
      await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await query("BEGIN");
    }
  });
}
