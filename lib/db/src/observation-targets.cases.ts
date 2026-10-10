import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import pg from "pg";
import { observationTargetTables } from "./schema/observationTargets";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const key = "a".repeat(64);
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
const resolveSQL = "SELECT v2_resolve_observation_target($1,$2,$3,$4,$5,$6) id";
export function registerObservationTargetTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_target");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_target"); await q("RELEASE SAVEPOINT invalid_target"); }
  }
  const state = async (id: string) => (await q("SELECT * FROM v2_subjects WHERE id=$1", [id])).rows[0];
  const target = async (observation: string) => (await q("SELECT * FROM v2_observation_targets WHERE observation_id=$1", [observation])).rows[0];
  const effective = async (observation: string) => (await q("SELECT v2_observation_subject($1) id", [observation])).rows[0].id as string;
  async function subject(kind: string) {
    const id = randomUUID(); await q("INSERT INTO v2_subjects(id,kind) VALUES($1,$2)", [id, kind]); return id;
  }
  async function report(id: string, field = "departure.reported", value: unknown = { time: "08:00", basis: "scheduled" }, owner = context().user) {
    const contribution = randomUUID();
    await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, owner, key, id]);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key)
      VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [contribution, id, field, value, field.endsWith(".scheduled") || field.endsWith(".actual") ? { schemaVersion: "1.0" } : {}, key])).rows[0].id as string;
    return { id, contribution, observation };
  }
  async function lead(owner = context().user, field = "departure.reported", value: unknown = { time: "08:00", basis: "scheduled" }) {
    const id = await subject("lead"); const f = await report(id, field, value, owner);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Target fixture',$3)", [id, context().corridor, f.contribution]);
    return f;
  }
  type Report = Awaited<ReturnType<typeof report>>;
  async function transport() {
    const operator = await subject("operator"), route = await subject("route"), pattern = await subject("pattern"), stop = await subject("stop"), plan = await subject("service_plan"), run = await subject("run");
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Target bus')", [operator]);
    await q("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)", [route, operator]);
    await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Target stop')", [stop]);
    await q("INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)", [pattern, route, context().corridor]);
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,1)", [pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,1,0,$2),($1,1,1,$2)", [pattern, stop]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1", [pattern]);
    await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')", [plan, pattern]);
    await q("INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,28800)", [run, plan, pattern]);
    return { pattern, run };
  }
  async function review(f: Report, kind: string, action: string, options: { candidate?: string; caseId?: string; reverse?: string; evidence?: string[] } = {}) {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
    const caseId = options.caseId ?? (await q("SELECT v2_open_review_case($1,$2,$3,NULL,NULL) id", [context().other, f.id, kind])).rows[0].id as string;
    if (options.candidate) await q("UPDATE v2_review_cases SET candidate_id=$1 WHERE id=$2", [options.candidate, caseId]);
    const c = (await q("SELECT revision FROM v2_review_cases WHERE id=$1", [caseId])).rows[0];
    const id = (await q("SELECT v2_record_review($1,$2,$3,$4,$5,'reviewed_identity',NULL,$6,'review/1',$7) id", [context().other, caseId, c.revision, (await state(f.id)).revision, action, options.evidence ?? (action === "reverse" ? [] : [f.observation]), options.reverse ?? null])).rows[0].id as string;
    return { id, caseId };
  }
  async function link(a: Report, destination: string, relation = "duplicate_of", evidence = [a.observation], apply = true) {
    const sa = await state(a.id), sb = await state(destination);
    const candidate = (await q(`INSERT INTO v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,rule_version,source_revision,target_revision,segment_start,segment_end)
      VALUES($1,$2,$3,$4,$5,$6,ARRAY['identity_fixture'],'association/1',$7,$8,$9,$10) RETURNING id`, [a.id, sa.kind, destination, sb.kind, relation, digest(), sa.revision, sb.revision, relation === "contains_segment" ? 0 : null, relation === "contains_segment" ? 1 : null])).rows[0].id as string;
    for (const observation of evidence) await q("INSERT INTO v2_candidate_evidence VALUES($1,$2)", [candidate, observation]);
    const r = await review(a, "identity", "accept", { candidate, evidence });
    const id = randomUUID();
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'association')", [id]);
    await q(`INSERT INTO v2_association_decisions(id,candidate_id,action,actor_kind,reviewer_decision_id,reason_code,policy_version,expected_from_revision,expected_to_revision,expected_candidate_revision)
      VALUES($1,$2,'accept','reviewer',$3,'reviewed_identity','association/1',$4,$5,1)`, [id, candidate, r.id, (await state(a.id)).revision, (await state(destination)).revision]);
    if (apply) await q("SELECT v2_apply_association_decision($1)", [id]);
    return { id, candidate, destination, review: r };
  }
  type Link = Awaited<ReturnType<typeof link>>;
  async function args(a: Report, l: Link) {
    const os = (await q("SELECT revision FROM v2_observation_states WHERE observation_id=$1", [a.observation])).rows[0];
    return [a.observation, l.id, (await target(a.observation)).revision, os.revision, (await state(a.id)).revision, (await state(l.destination)).revision];
  }
  const resolve = async (a: Report, l: Link) => (await q(resolveSQL, await args(a, l))).rows[0].id as string;
  const reverse = (a: Report, l: Link) => review(a, "identity", "reverse", { caseId: l.review.caseId, reverse: l.review.id });
  async function selected(a: Report, destination = a.id) {
    const id = randomUUID(), s = await state(destination);
    const o = (await q("SELECT * FROM v2_observations WHERE id=$1", [a.observation])).rows[0];
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')", [id]);
    await q(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'reported','none','unknown','provisional',ARRAY['reported_evidence'],'evidence/1',$9)`, [id, destination, o.field_key, o.scope_key, o.scope, s.revision, s.input_generation, o.value, digest()]);
    await q("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')", [id, a.observation]);
    await q("SELECT v2_apply_field_decision($1)", [id]); return id;
  }
  test("targets: original declarations have a baseline without invented identity", async () => {
    const a = await lead(); const t = await target(a.observation);
    assert.equal(t.revision, "1"); assert.equal(t.assignment_id, null); assert.equal(await effective(a.observation), a.id);
    assert.equal((await q("SELECT action FROM v2_target_events WHERE id=$1", [t.latest_event_id])).rows[0].action, "baseline");
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("targets: valid observation insertion also works with constraints already immediate", async () => {
    const a = await lead(); await q("SET CONSTRAINTS ALL IMMEDIATE");
    const additional = await report(a.id);
    assert.equal(await effective(additional.observation), a.id); assert.equal((await target(additional.observation)).revision, "1");
  });
  test("targets: a current reviewed identity explicitly moves only its named observation", async () => {
    const a = await lead(), b = await lead(context().other), other = await report(a.id); const l = await link(a, b.id);
    assert.equal(await effective(a.observation), a.id); const assignment = await resolve(a, l);
    assert.equal(await effective(a.observation), b.id); assert.equal(await effective(other.observation), a.id);
    assert.equal((await target(a.observation)).assignment_id, assignment);
    assert.equal((await q("SELECT original_subject_id FROM v2_observations WHERE id=$1", [a.observation])).rows[0].original_subject_id, a.id);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("targets: only applied exact decisions and their reviewed candidate evidence qualify", async () => {
    const a = await lead(), b = await lead(), other = await report(a.id); const l = await link(a, b.id, "duplicate_of", [a.observation], false);
    await invalid(() => resolve(a, l)); await q("SELECT v2_apply_association_decision($1)", [l.id]);
    await invalid(() => resolve(other, l)); await resolve(a, l);
  });
  test("targets: grouping and correction relationships cannot retarget identity", async () => {
    const a = await lead(), b = await lead();
    for (const relation of ["same_corridor", "correction_of"]) { const l = await link(a, b.id, relation); await invalid(() => resolve(a, l)); }
    assert.equal(await effective(a.observation), a.id);
  });
  test("targets: variants and contained segments never inherit each other's observations", async () => {
    const ta = await transport(), tb = await transport(); const a = await report(ta.pattern, "boarding.pickup", { cityId: context().origin, name: "Main terminal" });
    for (const relation of ["variant_of", "contains_segment"]) { const l = await link(a, tb.pattern, relation); await invalid(() => resolve(a, l)); }
  });
  test("targets: scheduled observations can resolve to runs without changing their meaning", async () => {
    const a = await lead(context().user, "departure.scheduled", { seconds: 28800 }); const t = await transport();
    const l = await link(a, t.run, "same_service"); await resolve(a, l); const field = await selected(a, t.run);
    assert.equal(await effective(a.observation), t.run);
    assert.equal((await q("SELECT selected_value FROM v2_field_decisions WHERE id=$1", [field])).rows[0].selected_value.seconds, 28800);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("targets: unqualified clocks and actual journeys cannot become recurring schedule evidence", async () => {
    const t = await transport(), a = await lead(); const l = await link(a, t.run, "same_service"); await invalid(() => resolve(a, l));
    const journey = await subject("actual_journey"); await q("INSERT INTO v2_actual_journeys(subject_id) VALUES($1)", [journey]);
    const actual = await report(journey, "departure.actual", { time: "08:00" }); const actualLink = await link(actual, t.run, "same_service");
    await invalid(() => resolve(actual, actualLink));
  });
  test("targets: known opposite directions cannot resolve as one identity even with approval", async () => {
    const a = await lead(), b = await lead();
    const reversed = (await q("INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$2) RETURNING id", [context().destination, context().origin])).rows[0].id;
    await q("UPDATE v2_leads SET corridor_id=$1 WHERE subject_id=$2", [reversed, b.id]);
    const l = await link(a, b.id); await invalid(() => resolve(a, l)); assert.equal(await effective(a.observation), a.id);
  });
  test("targets: assignment is directed from the original subject, with no transitive graph inference", async () => {
    const a = await lead(), b = await lead(), c = await lead(); const ab = await link(a, b.id); await resolve(a, ab);
    const bc = await link(b, c.id); await invalid(() => resolve(a, bc)); assert.equal(await effective(a.observation), b.id);
    await invalid(() => resolve(b, ab));
  });
  test("targets: exact retries return the receipt without repeated effects or reinstatement", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); const values = await args(a, l);
    const id = (await q(resolveSQL, values)).rows[0].id; const before = await state(b.id);
    assert.equal((await q(resolveSQL, values)).rows[0].id, id); assert.deepEqual(await state(b.id), before);
    await invalid(() => q(resolveSQL, values.map((v, i) => i === 2 ? Number(v) + 1 : v)));
    await reverse(a, l); assert.equal((await q(resolveSQL, values)).rows[0].id, id); assert.equal(await effective(a.observation), a.id);
  });
  test("targets: every supplied revision is checked and incomplete requests fail", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); const values = await args(a, l);
    for (const index of [2, 3, 4, 5]) await invalid(() => q(resolveSQL, values.map((v, i) => i === index ? Number(v) + 1 : v)), ["40001"]);
    for (let index = 0; index < 6; index++) await invalid(() => q(resolveSQL, values.map((v, i) => i === index ? null : v)));
  });
  test("targets: events and projections cannot be forged, rewritten or deleted", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); const assignment = await resolve(a, l);
    for (const table of ["v2_target_assignments", "v2_target_events", "v2_observation_targets"]) await invalid(() => q(`DELETE FROM ${table} WHERE observation_id=$1`, [a.observation]));
    await invalid(() => q("UPDATE v2_target_assignments SET target_subject_id=$1 WHERE id=$2", [a.id, assignment]));
    await invalid(() => q("UPDATE v2_target_events SET action='baseline' WHERE assignment_id=$1", [assignment]));
    await invalid(() => q("UPDATE v2_observation_targets SET assignment_id=NULL WHERE observation_id=$1", [a.observation]));
    await invalid(() => q("INSERT INTO v2_target_events(observation_id,revision,action) VALUES($1,1,'baseline')", [a.observation]));
  });
  test("targets: reassignment invalidates old selected evidence and binds new selection to the effective subject", async () => {
    const a = await lead(), b = await lead(); const old = await selected(a); const l = await link(a, b.id); await resolve(a, l);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [old])).rows[0].invalidated, true);
    const kept = await selected(a, b.id);
    await reverse(a, l);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [kept])).rows[0].invalidated, true);
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=ANY($1::uuid[])", [[a.id, b.id]])).rows[0].count, "0");
    assert.equal(await effective(a.observation), a.id); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("targets: resolved evidence cannot still select a field at the original or unrelated subject", async () => {
    const a = await lead(), b = await lead(), c = await lead(); const l = await link(a, b.id); await resolve(a, l);
    await invalid(() => selected(a)); await invalid(() => selected(a, c.id)); await selected(a, b.id);
  });
  test("targets: reversal restores the newest still-valid earlier assignment", async () => {
    const a = await lead(), b = await lead(), c = await lead(); const ab = await link(a, b.id); const ac = await link(a, c.id);
    const previous = await resolve(a, ab); await resolve(a, ac); await reverse(a, ac);
    assert.equal(await effective(a.observation), b.id); assert.equal((await target(a.observation)).assignment_id, previous);
    const history = (await q("SELECT action,revision FROM v2_target_events WHERE observation_id=$1 ORDER BY revision", [a.observation])).rows;
    assert.deepEqual(history.map(r => r.action), ["baseline", "assign", "assign", "invalidate"]);
    await reverse(a, ab); assert.equal(await effective(a.observation), a.id); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("targets: reversing an older link leaves a later valid target in place", async () => {
    const a = await lead(), b = await lead(), c = await lead(); const ab = await link(a, b.id); const ac = await link(a, c.id);
    await resolve(a, ab); const current = await resolve(a, ac); const before = await target(a.observation); await reverse(a, ab);
    assert.equal(await effective(a.observation), c.id); assert.deepEqual(await target(a.observation), before);
    assert.equal((await target(a.observation)).assignment_id, current);
    await reverse(a, ac); assert.equal(await effective(a.observation), a.id);
  });
  test("targets: moderation removes resolved influence and restoring visibility does not revive identity", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); await resolve(a, l); const field = await selected(a, b.id);
    const hidden = await review(a, "moderation", "hide"); assert.equal(await effective(a.observation), a.id);
    await review(a, "moderation", "reverse", { caseId: hidden.caseId, reverse: hidden.id });
    assert.equal(await effective(a.observation), a.id); assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [field])).rows[0].invalidated, true);
    assert.ok(Number((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND policy_version='observation-targets/1'", [b.id])).rows[0].count) > 0);
  });
  test("targets: corrections retire old links and never inherit an unreviewed target", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); await resolve(a, l);
    const next = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key,supersedes_id)
      SELECT contribution_id,original_subject_id,field_key,'{"time":"09:00","basis":"scheduled"}',scope_key,value_key,id FROM v2_observations WHERE id=$1 RETURNING id`, [a.observation])).rows[0].id;
    assert.equal(await effective(a.observation), a.id); assert.equal(await effective(next), a.id); assert.equal((await target(next)).revision, "1");
  });
  test("targets: retiring a destination clears its current links without automatic resurrection", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); await resolve(a, l);
    await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1", [b.id]); assert.equal(await effective(a.observation), a.id);
    await q("UPDATE v2_subjects SET lifecycle='active' WHERE id=$1", [b.id]); assert.equal(await effective(a.observation), a.id);
  });
  test("targets: erasing an account removes target history and copied values while preserving unrelated data", async () => {
    const a = await lead(), b = await lead(context().other), c = await lead(context().other); const l = await link(a, b.id);
    await resolve(a, l); const erased = await selected(a, b.id); const kept = await selected(c);
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1", [context().user]); await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    for (const table of observationTargetTables.map(getTableName)) assert.equal((await q(`SELECT count(*) FROM ${table} WHERE observation_id=$1`, [a.observation])).rows[0].count, "0");
    assert.deepEqual((await q("SELECT erased,selected_value,scope FROM v2_field_decisions WHERE id=$1", [erased])).rows[0], { erased: true, selected_value: null, scope: null });
    assert.ok((await q("SELECT snapshot FROM v2_subject_revisions WHERE subject_id=$1", [b.id])).rows.every(r => r.snapshot === null));
    assert.equal((await q("SELECT field_decision_id FROM v2_current_fields WHERE subject_id=$1", [c.id])).rows[0].field_decision_id, kept);
    assert.ok(Number((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND kind='erase_recompute'", [b.id])).rows[0].count) > 0);
  });
  test("targets: backend can read but cannot reassign or invoke internal helpers", async () => {
    const a = await lead(), b = await lead(); const l = await link(a, b.id); const values = await args(a, l);
    for (const role of ["anon", "authenticated", "mabhazi_api"]) {
      await q(`SET LOCAL ROLE ${role}`);
      for (const table of observationTargetTables.map(getTableName)) {
        if (role === "mabhazi_api") await q(`SELECT * FROM ${table}`); else await invalid(() => q(`SELECT * FROM ${table}`), ["42501"]);
        for (const operation of ["DELETE FROM", "TRUNCATE"]) await invalid(() => q(`${operation} ${table}`), ["42501"]);
      }
      await invalid(() => q(resolveSQL, values), ["42501"]);
      await invalid(() => q("SELECT v2_refresh_observation_target($1)", [a.observation]), ["42501"]);
      await q("RESET ROLE");
    }
  });
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) {
    for (const race of ["reassignment", "withdrawal"]) test(`targets: ${race} cannot silently overwrite a competing effect at ${isolation}`, { timeout: 20_000 }, async () => {
      const a = await lead(), b = await lead(), c = await lead(); const ab = await link(a, b.id), ac = await link(a, c.id);
      const leftArgs = await args(a, ab), rightArgs = await args(a, ac); await q("COMMIT");
      const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
      await left.connect(); await right.connect();
      try {
        await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT revision FROM v2_observation_targets WHERE observation_id=$1", [a.observation]);
        if (race === "withdrawal") await left.query("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user, a.observation, randomUUID()]);
        else await left.query(resolveSQL, leftArgs);
        const result = right.query(resolveSQL, rightArgs).then(() => "unexpected_success", (e: { code: string }) => e.code);
        await left.query("COMMIT"); assert.equal(await result, "40001"); await right.query("ROLLBACK");
        assert.equal(await effective(a.observation), race === "withdrawal" ? a.id : b.id);
      } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
    });
  }
}
