import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; corridor: string };
const key = "a".repeat(64);
const withdrawSQL = "SELECT v2_withdraw_observation($1,$2,$3,$4,$5) id";
export function registerObservationEventTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_event");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_event"); await q("RELEASE SAVEPOINT invalid_event"); }
  }
  async function fixture() {
    const subject = randomUUID(), contribution = randomUUID();
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [subject]);
    await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, context().user, key, subject]);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Event fixture',$3)", [subject, context().corridor, contribution]);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
      VALUES($1,$2,'departure.reported','{"time":"08:00","basis":"unspecified"}',$3,$3) RETURNING id`, [contribution, subject, key])).rows[0].id as string;
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
    return { subject, contribution, observation };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const state = async (id: string) => (await q("SELECT * FROM v2_observation_states WHERE observation_id=$1", [id])).rows[0];
  const events = async (id: string) => (await q("SELECT * FROM v2_observation_events WHERE observation_id=$1 ORDER BY revision", [id])).rows;
  const revision = async (id: string) => Number((await q("SELECT revision FROM v2_subjects WHERE id=$1", [id])).rows[0].revision);
  async function withdraw(f: Fixture, expected = 1, request = randomUUID(), note: string | null = null, actor = context().user) {
    return (await q(withdrawSQL, [actor, f.observation, expected, request, note])).rows[0].id as string;
  }
  const correctionSQL = `INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key,supersedes_id)
    SELECT contribution_id,original_subject_id,field_key,'{"time":"09:00","basis":"unspecified"}',scope_key,value_key,id
    FROM v2_observations WHERE id=$1 RETURNING id`;
  async function correct(f: Fixture) { return (await q(correctionSQL, [f.observation])).rows[0].id as string; }
  async function review(f: Fixture, action: string, options: { caseId?: string; reverse?: string; evidence?: string[]; actor?: string } = {}) {
    const actor = options.actor ?? context().other;
    const caseId = options.caseId ?? (await q("SELECT v2_open_review_case($1,$2,'moderation',NULL,NULL) id", [actor, f.subject])).rows[0].id as string;
    const expected = Number((await q("SELECT revision FROM v2_review_cases WHERE id=$1", [caseId])).rows[0].revision);
    const id = (await q("SELECT v2_record_review($1,$2,$3,$4,$5,'moderation_reason','Private review note',$6,'review/1',$7) id",
      [actor, caseId, expected, await revision(f.subject), action, options.evidence ?? (action === "reverse" ? [] : [f.observation]), options.reverse ?? null])).rows[0].id as string;
    return { id, caseId };
  }
  async function selection(f: Fixture) {
    const id = randomUUID(), s = (await q("SELECT * FROM v2_subjects WHERE id=$1", [f.subject])).rows[0];
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')", [id]);
    await q(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
      VALUES($1,$2,'departure.reported',$3,'{}',1,$4,$5,'{"time":"08:00","basis":"unspecified"}','reported','none','unknown','provisional',ARRAY['reported_evidence'],'evidence/1',$3)`, [id, f.subject, key, s.revision, s.input_generation]);
    await q("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')", [id, f.observation]);
    await q("SELECT v2_apply_field_decision($1)", [id]); return id;
  }

  test("events: insertion creates a linked initial audit without inventing an observed date", async () => {
    const f = await fixture(), s = await state(f.observation), history = await events(f.observation);
    assert.equal(history.length, 1); assert.equal(history[0].action, "submit"); assert.equal(history[0].actor_user_id, context().user);
    assert.equal(history[0].previous_event_id, null); assert.equal(s.latest_event_id, history[0].id); assert.equal(s.revision, "1");
    assert.equal((await q("SELECT observed_from FROM v2_observations WHERE id=$1", [f.observation])).rows[0].observed_from, null);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("events: states cannot be edited, deleted or detached from their audit", async () => {
    const f = await fixture();
    for (const sql of ["UPDATE v2_observation_states SET status='hidden' WHERE observation_id=$1", "UPDATE v2_observation_states SET revision=revision+1 WHERE observation_id=$1", "UPDATE v2_observation_states SET reason_code='forged' WHERE observation_id=$1", "DELETE FROM v2_observation_states WHERE observation_id=$1"]) await invalid(() => q(sql, [f.observation]));
    await invalid(() => q("UPDATE v2_observation_states SET latest_event_id=NULL WHERE observation_id=$1", [f.observation]));
  });
  test("events: author withdrawal is atomic, idempotent and rejects changed retry payloads", async () => {
    const f = await fixture(), request = randomUUID(); await q("SET LOCAL ROLE mabhazi_api");
    const id = await withdraw(f, 1, request, "Incorrect report"); const after = await revision(f.subject);
    assert.equal(await withdraw(f, 1, request, "Incorrect report"), id); assert.equal(await revision(f.subject), after);
    await invalid(() => withdraw(f, 1, request, "Different note"));
    await invalid(() => withdraw(f, 2, request, "Incorrect report"));
    await invalid(() => withdraw(f), ["40001"]);
    assert.equal((await state(f.observation)).status, "withdrawn");
    assert.equal((await q("SELECT count(*) FROM v2_jobs WHERE trigger_id=$1", [id])).rows[0].count, "1");
    await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
  });
  test("events: null requests, other authors and nonowners cannot withdraw", async () => {
    const f = await fixture();
    await invalid(() => withdraw(f, 1, randomUUID(), null, context().other), ["42501"]);
    for (const values of [[null, f.observation, 1, randomUUID(), null], [context().user, randomUUID(), 1, randomUUID(), null]]) await invalid(() => q(withdrawSQL, values), ["42501"]);
    for (const values of [[context().user, f.observation, null, randomUUID(), null], [context().user, f.observation, 1, null, null], [context().user, f.observation, 1, randomUUID(), "x".repeat(2001)]]) await invalid(() => q(withdrawSQL, values));
    assert.equal((await events(f.observation)).length, 1);
  });
  test("events: corrections supersede the exact active predecessor with immutable history", async () => {
    const f = await fixture(), next = await correct(f), history = await events(f.observation);
    assert.equal((await state(f.observation)).status, "superseded"); assert.equal((await state(next)).status, "active");
    assert.equal(history[1].replacement_observation_id, next); assert.equal(history[1].previous_event_id, history[0].id);
    assert.equal(history[1].action, "supersede");
    await invalid(() => correct(f));
    const third = await correct({ ...f, observation: next });
    assert.equal((await state(next)).status, "superseded"); assert.equal((await state(third)).status, "active");
    assert.equal((await q("SELECT value->>'time' time FROM v2_observations WHERE id=$1", [f.observation])).rows[0].time, "08:00");
  });
  test("events: hidden or withdrawn predecessors cannot be reactivated through a correction", async () => {
    const f = await fixture(); await review(f, "hide");
    await invalid(() => correct(f)); await withdraw(f, 2); await invalid(() => correct(f));
    assert.equal((await q("SELECT count(*) FROM v2_observations WHERE original_subject_id=$1", [f.subject])).rows[0].count, "1");
  });
  test("events: withdrawing or superseding support immediately invalidates selected values", async () => {
    for (const action of ["withdraw", "supersede"]) {
      const f = await fixture(), d = await selection(f);
      if (action === "withdraw") await withdraw(f); else await correct(f);
      assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [d])).rows[0].invalidated, true);
      assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE field_decision_id=$1", [d])).rows[0].count, "0");
    }
  });
  test("events: moderation atomically targets its exact evidence and preserves unrelated reports", async () => {
    const f = await fixture(), unrelated = await fixture(), d = await selection(f);
    const hidden = await review(f, "hide");
    assert.equal((await state(f.observation)).status, "hidden"); assert.equal((await state(unrelated.observation)).status, "active");
    const event = (await events(f.observation))[1]; assert.equal(event.review_decision_id, hidden.id); assert.equal(event.actor_user_id, context().other); assert.equal(event.private_reason, null);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [d])).rows[0].invalidated, true);
    await review(f, "restore"); assert.equal((await state(f.observation)).status, "active");
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE field_decision_id=$1", [d])).rows[0].count, "0");
  });
  test("events: empty moderation and restore on active or withdrawn reports roll back the review", async () => {
    const f = await fixture();
    for (const action of ["hide", "restore"]) await invalid(() => review(f, action, { evidence: [] }));
    await invalid(() => review(f, "restore"));
    assert.equal((await events(f.observation)).length, 1);
    await withdraw(f); await invalid(() => review(f, "restore"));
    assert.equal((await q("SELECT count(*) FROM v2_review_decisions d JOIN v2_review_cases c ON c.id=d.case_id WHERE c.subject_id=$1", [f.subject])).rows[0].count, "0");
  });
  test("events: reversing current hide restores visibility; reversing restore hides it again", async () => {
    const f = await fixture(), hide = await review(f, "hide");
    await review(f, "reverse", { caseId: hide.caseId, reverse: hide.id });
    assert.equal((await state(f.observation)).status, "active");
    await review(f, "hide"); const restore = await review(f, "restore");
    await review(f, "reverse", { caseId: restore.caseId, reverse: restore.id });
    assert.equal((await state(f.observation)).status, "hidden");
    assert.deepEqual((await events(f.observation)).map(e => e.action), ["submit", "hide", "reverse", "hide", "restore", "reverse"]);
  });
  test("events: reversal never resurrects subsequently withdrawn or superseded evidence", async () => {
    const f = await fixture(), hide = await review(f, "hide"); await withdraw(f, 2);
    await review(f, "reverse", { caseId: hide.caseId, reverse: hide.id }); assert.equal((await state(f.observation)).status, "withdrawn");
    const g = await fixture(); await review(g, "hide"); const restore = await review(g, "restore"); const replacement = await correct(g);
    await review(g, "reverse", { caseId: restore.caseId, reverse: restore.id });
    assert.equal((await state(g.observation)).status, "superseded"); assert.equal((await state(replacement)).status, "active");
  });
  test("events: an earlier moderation reversal cannot undo a newer case's decision", async () => {
    const f = await fixture(), hide = await review(f, "hide"); await review(f, "restore"); await review(f, "hide");
    const before = await state(f.observation);
    await review(f, "reverse", { caseId: hide.caseId, reverse: hide.id });
    assert.equal((await state(f.observation)).latest_event_id, before.latest_event_id);
  });
  test("events: revoked reviewers cannot change visibility or reverse history", async () => {
    const f = await fixture(), hide = await review(f, "hide");
    // Owner-only bootstrap fixture; the production grant/revoke primitive is tested separately.
    await q("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL", [context().other]);
    await invalid(() => review(f, "restore"), ["42501"]);
    await invalid(() => review(f, "reverse", { caseId: hide.caseId, reverse: hide.id }), ["42501"]);
    assert.equal((await state(f.observation)).status, "hidden");
  });
  test("events: audit rows cannot be rewritten, removed or forged through backend SQL", async () => {
    const f = await fixture(), original = (await events(f.observation))[0];
    for (const sql of ["UPDATE v2_observation_events SET reason_code='rewritten' WHERE id=$1", "UPDATE v2_observation_events SET private_reason='rewritten' WHERE id=$1", "DELETE FROM v2_observation_events WHERE id=$1"]) await invalid(() => q(sql, [original.id]));
    await q("SET LOCAL ROLE mabhazi_api");
    await invalid(() => q("UPDATE v2_observation_states SET status='hidden' WHERE observation_id=$1", [f.observation]), ["42501"]);
    await invalid(() => q("INSERT INTO v2_observation_events(observation_id,revision,action,status) VALUES($1,1,'baseline','active')", [f.observation]), ["42501"]);
    await invalid(() => q("SELECT v2_append_observation_event($1,$2,1,'withdraw',$3)", [context().user, f.observation, randomUUID()]), ["42501"]);
    await q("RESET ROLE");
    for (const role of ["anon", "authenticated"]) {
      await q(`SET LOCAL ROLE ${role}`);
      await invalid(() => q("SELECT * FROM v2_observation_events"), ["42501"]);
      await invalid(() => withdraw(f), ["42501"]); await q("RESET ROLE");
    }
  });
  test("events: deleting a replacement retains a safe supersession tombstone", async () => {
    const f = await fixture(), next = await correct(f); await q("DELETE FROM v2_observations WHERE id=$1", [next]);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
    const event = (await events(f.observation))[1]; assert.equal(event.replacement_observation_id, null); assert.equal(event.replacement_erased, true);
    assert.equal((await state(f.observation)).status, "superseded");
  });
  test("events: reviewer deletion anonymizes audit while preserving the moderation outcome", async () => {
    const f = await fixture(), hide = await review(f, "hide");
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1", [context().other]); await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    const event = (await events(f.observation))[1]; assert.equal(event.actor_user_id, null); assert.equal(event.actor_erased, true); assert.equal(event.private_reason, null);
    assert.equal(event.review_decision_id, hide.id); assert.equal((await state(f.observation)).status, "hidden");
    assert.equal((await q("SELECT private_reason FROM v2_review_decisions WHERE id=$1", [hide.id])).rows[0].private_reason, null);
  });
  test("events: author deletion erases owned event streams and private notes without erasing unrelated evidence", async () => {
    const f = await fixture(), g = await fixture(); await withdraw(f, 1, randomUUID(), "Private account note");
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM v2_contributions WHERE id=$1", [f.contribution]); await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    assert.equal((await events(f.observation)).length, 0); assert.equal((await events(g.observation)).length, 1);
    await q("DELETE FROM users WHERE id=$1", [context().user]); await q("SET CONSTRAINTS ALL IMMEDIATE"); assert.equal((await events(g.observation)).length, 0);
  });
  test("events: rolled-back changes leave no history, state or generation effects", async () => {
    const f = await fixture(), before = await state(f.observation), rev = await revision(f.subject);
    await q("SAVEPOINT interrupted_event"); await withdraw(f); await q("ROLLBACK TO SAVEPOINT interrupted_event"); await q("RELEASE SAVEPOINT interrupted_event");
    assert.deepEqual(await state(f.observation), before); assert.equal(await revision(f.subject), rev); assert.equal((await events(f.observation)).length, 1);
  });
  // These fixtures commit only inside the disposable test database, dropped at suite end.
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) test(`events: competing withdrawals have one effect at ${isolation}`, { timeout: 20_000 }, async () => {
    const f = await fixture(); await q("COMMIT");
    const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
    await left.connect(); await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT revision FROM v2_observation_states WHERE observation_id=$1", [f.observation]);
      await left.query("SET LOCAL ROLE mabhazi_api"); await right.query("SET LOCAL ROLE mabhazi_api");
      await left.query(withdrawSQL, [context().user, f.observation, 1, randomUUID(), null]);
      const losing = right.query(withdrawSQL, [context().user, f.observation, 1, randomUUID(), null]).then(() => "unexpected_success", (e: { code: string }) => e.code);
      await left.query("COMMIT"); assert.equal(await losing, "40001"); await right.query("ROLLBACK");
      assert.equal((await events(f.observation)).length, 2); assert.equal((await state(f.observation)).revision, "2");
    } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
  });
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) test(`events: competing corrections cannot fork the active predecessor at ${isolation}`, { timeout: 20_000 }, async () => {
    const f = await fixture(); await q("COMMIT");
    const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
    await left.connect(); await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT revision FROM v2_observation_states WHERE observation_id=$1", [f.observation]);
      const replacement = (await left.query(correctionSQL, [f.observation])).rows[0].id;
      const losing = right.query(correctionSQL, [f.observation]).then(() => "unexpected_success", (e: { code: string }) => e.code);
      await left.query("COMMIT"); assert.equal(await losing, isolation === "READ COMMITTED" ? "23514" : "40001"); await right.query("ROLLBACK");
      assert.equal((await state(replacement)).status, "active"); assert.equal((await events(f.observation)).length, 2);
      assert.equal((await q("SELECT count(*) FROM v2_observations WHERE supersedes_id=$1", [f.observation])).rows[0].count, "1");
    } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
  });
}
