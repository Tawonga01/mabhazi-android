import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import pg from "pg";
import { fieldResolutionTables } from "./schema/fieldResolution";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const at = "2026-10-02T12:00:00.000Z";
const assessSQL = "SELECT v2_assess_field($1,$2,$3,$4,$5,$6,$7,$8,$9) id";
type Options = { owner?: string; date?: string | null; sourceDate?: string | null; basis?: string; sources?: string[]; supersedes?: string; effectiveFrom?: string; effectiveTo?: string };
export function registerFieldResolutionTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  const hash = async (value: unknown) => (await q("SELECT v2_assessment_hash($1::jsonb) h", [JSON.stringify(value)])).rows[0].h as string;
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_assessment");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_assessment"); await q("RELEASE SAVEPOINT invalid_assessment"); }
  }
  async function subject(kind: string) {
    const id = randomUUID(); await q("INSERT INTO v2_subjects(id,kind) VALUES($1,$2)", [id, kind]); return id;
  }
  async function contribution(id: string, owner: string) {
    return (await q(`INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,gen_random_uuid(),'1.0','contribute_tab',$2,'{}',$3) RETURNING id`, [owner, "a".repeat(64), id])).rows[0].id as string;
  }
  async function lead() {
    const id = await subject("lead"), c = await contribution(id, context().user);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Assessment bus',$3)", [id, context().corridor, c]); return id;
  }
  async function source(owner = context().user, date: string | null = null, kind = "firsthand") {
    return (await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,$2,$3) RETURNING id", [owner, kind, date])).rows[0].id as string;
  }
  async function report(id: string, field: string, value: unknown, scope: unknown = {}, options: Options = {}) {
    const owner = options.owner ?? context().user, c = await contribution(id, owner);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,supersedes_id,effective_from,effective_to)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [c, id, field, value, scope, await hash(scope), await hash(value), options.basis ?? "observed_sign",
      options.date === undefined ? "2026-10-01" : options.date, options.supersedes ?? null, options.effectiveFrom ?? null, options.effectiveTo ?? null])).rows[0].id as string;
    const sources = options.sources ?? [await source(owner, options.sourceDate ?? null)];
    for (const s of sources) await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')", [observation, s]);
    return { observation, sources, id, field, value, scope, owner };
  }
  const fareScope = (extra: Record<string, unknown> = {}) => ({ schemaVersion: "1.0", segment: { kind: "city_pair", originCityId: context().origin, destinationCityId: context().destination },
    passengerCategory: "adult", ticketBasis: "one_way", paymentMethod: "cash", luggageIncluded: true, timeBasis: "scheduled", quotationDate: "2026-10-01", ...extra });
  const fare = (amount = "25.00", currency = "USD") => ({ amount, currency });
  const evaluate = async (id: string, field: string, scope: unknown = {}, when = at) => (await q("SELECT v2_evaluate_assessment($1,$2,$3,$4,'evidence/1') r", [id, field, scope, when])).rows[0].r;
  async function args(id: string, field: string, scope: unknown = {}, when = at) {
    const s = (await q("SELECT revision,input_generation FROM v2_subjects WHERE id=$1", [id])).rows[0];
    return [id, field, await hash(scope), scope, s.revision, s.input_generation, (await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision, when, randomUUID()];
  }
  const record = async (id: string, field: string, scope: unknown = {}, when = at) => (await q(assessSQL, await args(id, field, scope, when))).rows[0].id as string;
  const read = async (id: string, field: string, scope: unknown = {}, when = at) => (await q("SELECT v2_read_assessment_at($1,$2,$3,$4) r", [id, field, await hash(scope), when])).rows[0].r;
  async function link(a: string, b: string) {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
    const c = (await q("SELECT v2_open_source_case($1,$2,$3) id", [context().other, a, b])).rows[0].id;
    const d = (await q("SELECT v2_review_sources($1,$2,1,$3,'same_origin','source_inspected',NULL,$4,'source/1',NULL) id", [context().other, c, (await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision, randomUUID()])).rows[0].id;
    return { c, d };
  }
  async function transport() {
    const operator = await subject("operator"), route = await subject("route"), pattern = await subject("pattern"), stop = await subject("stop"), plan = await subject("service_plan"), run = await subject("run"), actual = await subject("actual_journey");
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Assessment operator')", [operator]);
    await q("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)", [route, operator]);
    await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Assessment stop')", [stop]);
    await q("INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)", [pattern, route, context().corridor]);
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,1)", [pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,1,0,$2),($1,1,1,$2)", [pattern, stop]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1", [pattern]);
    await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')", [plan, pattern]);
    await q("INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,28800)", [run, plan, pattern]);
    await q("INSERT INTO v2_actual_journeys(subject_id) VALUES($1)", [actual]);
    return { operator, route, pattern, stop, plan, run, actual };
  }
  const process = async (assessment: string) => (await q("SELECT v2_process_field_assessment($1) id", [assessment])).rows[0].id as string;
  const fieldRead = async (id: string, scope: unknown, when = at, field = "fare.quoted") => (await q("SELECT v2_read_field_at($1,$2,$3,$4) r", [id, field, await hash(scope), when])).rows[0].r;
  const thread = async (id: string) => (await q("SELECT c.* FROM v2_field_review_threads t JOIN v2_review_cases c ON c.id=t.case_id WHERE t.subject_id=$1", [id])).rows[0];
  async function reviewer() { await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]); }
  async function resolutionArgs(assessment: string, choice: string | null, excluded: string[] = [], action = "accept", actor = context().other) {
    const a = (await q("SELECT subject_id FROM v2_field_assessments WHERE id=$1", [assessment])).rows[0];
    return [actor, assessment, (await thread(a.subject_id))?.revision ?? 0, (await q("SELECT revision FROM v2_subjects WHERE id=$1", [a.subject_id])).rows[0].revision,
      choice, excluded, action, "scope_checked", "Synthetic private rationale", randomUUID()];
  }
  const resolveSQL = "SELECT v2_resolve_field($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id";
  const resolve = async (a: string, choice: string | null, excluded: string[] = [], action = "accept") => (await q(resolveSQL, await resolutionArgs(a, choice, excluded, action))).rows[0].id as string;
  async function conflict() {
    const id = await lead(), scope = fareScope(), a = await report(id, "fare.quoted", fare(), scope), b = await report(id, "fare.quoted", fare("30"), scope, { owner: context().other });
    const assessment = await record(id, "fare.quoted", scope); await process(assessment); await reviewer(); return { id, scope, a, b, assessment };
  }
  test("field resolution: computed support stays provisional and duplicate processing has one effect", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); await report(id, "fare.quoted", fare(), scope, { owner: context().other });
    const a = await record(id, "fare.quoted", scope), d = await process(a); assert.equal(await process(a), d);
    const r = await fieldRead(id, scope); assert.equal(r.support, "corroborated"); assert.equal(r.publication, "provisional"); assert.equal(r.reviewed, false);
    const b = await record(id, "fare.quoted", scope, "2026-10-02T13:00:00Z"); assert.equal(await process(b), d);
    assert.equal((await q("SELECT count(*) FROM v2_field_decisions WHERE subject_id=$1", [id])).rows[0].count, "1");
  });
  test("field resolution: conflicts open one durable case and withhold a winner", async () => {
    const f = await conflict(); const c = await thread(f.id); assert.equal(c.state, "open");
    const r = await fieldRead(f.id, f.scope); assert.equal(r.value, null); assert.equal(r.dispute, "open"); assert.equal(r.status, "review_required");
    await process(f.assessment); assert.equal((await q("SELECT count(*) FROM v2_field_case_events WHERE case_id=$1", [c.id])).rows[0].count, "1");
  });
  test("field resolution: reviewer must explicitly exclude conflicting evidence", async () => {
    const f = await conflict(); await invalid(() => resolve(f.assessment, f.a.observation));
    const review = await resolve(f.assessment, f.a.observation, [f.b.observation]);
    const r = await fieldRead(f.id, f.scope); assert.equal(r.value.amount, "25"); assert.equal(r.support, "reported"); assert.equal(r.dispute, "resolved"); assert.equal(r.reviewed, true);
    assert.equal((await thread(f.id)).last_decision_id, review); assert.equal((await q("SELECT count(*) FROM v2_field_resolution_inputs WHERE review_id=$1 AND rejected", [review])).rows[0].count, "1");
  });
  test("field resolution: excluding a supporting witness lowers support instead of adding a reviewer vote", async () => {
    const id = await lead(), scope = fareScope(), a = await report(id, "fare.quoted", fare(), scope), b = await report(id, "fare.quoted", fare(), scope, { owner: context().other });
    const assessment = await record(id, "fare.quoted", scope); await process(assessment); await reviewer(); await resolve(assessment, a.observation, [b.observation]);
    assert.equal((await fieldRead(id, scope)).support, "reported");
  });
  test("field resolution: unchanged rejected evidence does not reopen on a new assessment timestamp", async () => {
    const f = await conflict(); await resolve(f.assessment, f.a.observation, [f.b.observation]); const c = await thread(f.id);
    const a = await record(f.id, "fare.quoted", f.scope, "2026-10-02T13:00:00Z"); await process(a);
    assert.equal((await thread(f.id)).revision, c.revision); assert.equal((await fieldRead(f.id, f.scope, "2026-10-02T13:00:00Z")).dispute, "resolved");
  });
  test("field resolution: a new contradictory report reopens and clears the reviewed winner", async () => {
    const f = await conflict(); await resolve(f.assessment, f.a.observation, [f.b.observation]);
    await report(f.id, "fare.quoted", fare("40"), f.scope, { owner: context().other });
    assert.equal((await fieldRead(f.id, f.scope)).status, "recheck_required");
    await process(await record(f.id, "fare.quoted", f.scope)); assert.equal((await thread(f.id)).state, "reopened");
    assert.equal((await fieldRead(f.id, f.scope)).value, null); assert.equal((await q("SELECT count(*) FROM v2_field_case_events WHERE case_id=$1", [(await thread(f.id)).id])).rows[0].count, "2");
  });
  test("field resolution: unrelated pickup information does not reopen rejected fare evidence", async () => {
    const f = await conflict(); await resolve(f.assessment, f.a.observation, [f.b.observation]); const c = await thread(f.id);
    await report(f.id, "boarding.pickup", { cityId: context().origin, name: "A different field" }); await process(await record(f.id, "fare.quoted", f.scope));
    assert.equal((await thread(f.id)).revision, c.revision); assert.equal((await fieldRead(f.id, f.scope)).value.amount, "25");
  });
  test("field resolution: reject-all requires explicit exclusions and new eligible evidence reopens it", async () => {
    const f = await conflict(); await invalid(() => resolve(f.assessment, null, [f.b.observation], "reject"));
    await resolve(f.assessment, null, [f.a.observation, f.b.observation], "reject"); assert.equal((await fieldRead(f.id, f.scope)).value, null);
    await process(await record(f.id, "fare.quoted", f.scope)); assert.equal((await thread(f.id)).state, "resolved");
    await report(f.id, "fare.quoted", fare("20"), f.scope); await process(await record(f.id, "fare.quoted", f.scope)); assert.equal((await thread(f.id)).state, "reopened");
  });
  test("field resolution: withdrawing the chosen report invalidates and reopens the lost selection", async () => {
    const f = await conflict(); await resolve(f.assessment, f.a.observation, [f.b.observation]);
    await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user, f.a.observation, randomUUID()]);
    assert.equal((await fieldRead(f.id, f.scope)).status, "recheck_required"); await process(await record(f.id, "fare.quoted", f.scope));
    assert.equal((await thread(f.id)).state, "reopened");
  });
  test("field resolution: reversing the current judgement cannot restore an old selected value", async () => {
    const f = await conflict(); const review = await resolve(f.assessment, f.a.observation, [f.b.observation]); const c = await thread(f.id);
    const rev = (await q("SELECT revision FROM v2_subjects WHERE id=$1", [f.id])).rows[0].revision;
    await q("SELECT v2_record_review($1,$2,$3,$4,'reverse','reconsidered',NULL,ARRAY[]::uuid[],'evidence/1',$5)", [context().other,c.id,c.revision,rev,review]);
    assert.equal((await fieldRead(f.id, f.scope)).status, "recheck_required"); await process(await record(f.id, "fare.quoted", f.scope));
    assert.equal((await fieldRead(f.id, f.scope)).value, null); assert.equal((await thread(f.id)).state, "reopened");
  });
  test("field resolution: exact retry is a receipt and conflicting retry is rejected", async () => {
    const f = await conflict(), args = await resolutionArgs(f.assessment, f.a.observation, [f.b.observation]);
    const id = (await q(resolveSQL, args)).rows[0].id; assert.equal((await q(resolveSQL, args)).rows[0].id, id);
    await invalid(() => q(resolveSQL, args.map((v,i) => i === 8 ? "changed note" : v)));
    await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user,f.a.observation,randomUUID()]);
    assert.equal((await q(resolveSQL, args)).rows[0].id, id); assert.equal((await fieldRead(f.id, f.scope)).status, "recheck_required");
  });
  test("field resolution: stale case or subject, duplicate exclusions and foreign observations reject", async () => {
    const f = await conflict(), args = await resolutionArgs(f.assessment,f.a.observation,[f.b.observation]);
    for (const index of [2,3]) await invalid(() => q(resolveSQL,args.map((v,i) => i === index ? 99999 : v)),["40001"]);
    await invalid(() => resolve(f.assessment,f.a.observation,[f.b.observation,f.b.observation]));
    await invalid(() => resolve(f.assessment,f.a.observation,[randomUUID()]));
    await invalid(() => resolve(f.assessment,f.a.observation,[f.a.observation]));
  });
  test("field resolution: an expired assessment cannot be reviewed and reads do not serve stale selections", async () => {
    const t = await transport(), scope = { schemaVersion:"1.0",serviceDate:"2026-10-02",timezone:"Africa/Harare" };
    const o = await report(t.run,"departure.scheduled",{seconds:28800},scope); const a=await record(t.run,"departure.scheduled",scope); await process(a); await reviewer();
    await invalid(() => resolve(a,o.observation),["40001"]);
    assert.equal((await fieldRead(t.run,scope,"2026-10-02T22:00:00Z","departure.scheduled")).status,"recheck_required");
  });
  test("field resolution: historical paid fare conflicts can be reviewed without current-price claims", async () => {
    const t=await transport(), scope=fareScope({quotationDate:undefined,serviceDate:"2020-01-01",timeBasis:"actual"});
    const a=await report(t.actual,"fare.paid",fare(),scope,{basis:"travelled",date:"2020-01-01"});
    const b=await report(t.actual,"fare.paid",fare("30"),scope,{owner:context().other,basis:"travelled",date:"2020-01-01"});
    const assessment=await record(t.actual,"fare.paid",scope); await process(assessment); await reviewer(); assert.equal((await thread(t.actual)).state,"open");
    await resolve(assessment,a.observation,[b.observation]); const r=await fieldRead(t.actual,scope,at,"fare.paid");
    assert.equal(r.freshness,"unknown"); assert.equal(r.support,"reported"); assert.equal(r.dispute,"resolved"); assert.equal(r.publication,"provisional");
  });
  test("field resolution: account erasure removes reviewed choices, request digests and rejected input identifiers", async () => {
    const f=await conflict(); const review=await resolve(f.assessment,f.a.observation,[f.b.observation]);
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1",[context().user]); await q("RESET ROLE");
    const row=(await q("SELECT * FROM v2_field_resolutions WHERE review_id=$1",[review])).rows[0];
    assert.equal(row.erased,true); assert.equal(row.chosen_observation_id,null); assert.equal(row.request_digest,null);
    assert.ok((await q("SELECT * FROM v2_field_resolution_inputs WHERE review_id=$1",[review])).rows.every(x=>x.erased && x.observation_id===null && x.evidence_digest===null));
    assert.ok((await q("SELECT * FROM v2_field_decisions WHERE subject_id=$1",[f.id])).rows.every(x=>x.erased && x.selected_value===null));
    assert.equal((await fieldRead(f.id,f.scope)).status,"recheck_required"); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("field resolution: source-only erasure removes resolution data while preserving independently owned reports", async () => {
    const f=await conflict(); const review=await resolve(f.assessment,f.a.observation,[f.b.observation]); await q("DELETE FROM v2_sources WHERE id=$1",[f.a.sources[0]]);
    assert.equal((await q("SELECT erased FROM v2_field_resolutions WHERE review_id=$1",[review])).rows[0].erased,true);
    assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1",[f.b.observation])).rows[0].count,"1");
  });
  test("field resolution: source regrouping changes rejected evidence identity and reopens review", async () => {
    const f=await conflict(); await resolve(f.assessment,f.a.observation,[f.b.observation]); await link(f.a.sources[0],f.b.sources[0]);
    await process(await record(f.id,"fare.quoted",f.scope)); assert.equal((await thread(f.id)).state,"reopened");
  });
  test("field resolution: reviewer-only deletion redacts the retry fingerprint without erasing others' evidence", async () => {
    const id=await lead(), scope=fareScope(), o=await report(id,"fare.quoted",fare(),scope); const a=await record(id,"fare.quoted",scope); await reviewer();
    const review=await resolve(a,o.observation); await q("DELETE FROM users WHERE id=$1",[context().other]);
    const r=(await q("SELECT * FROM v2_field_resolutions WHERE review_id=$1",[review])).rows[0]; assert.equal(r.erased,false); assert.equal(r.receipt_redacted,true); assert.equal(r.request_digest,null);
    assert.equal((await fieldRead(id,scope)).value.amount,"25");
  });
  test("field resolution: raw histories cannot be rewritten and forged confidence is rejected", async () => {
    const f=await conflict(); const review=await resolve(f.assessment,f.a.observation,[f.b.observation]);
    await invalid(()=>q("UPDATE v2_field_resolutions SET chosen_observation_id=$1 WHERE review_id=$2",[f.b.observation,review]));
    const caseId=(await thread(f.id)).id; await invalid(()=>q("DELETE FROM v2_field_case_events WHERE case_id=$1",[caseId]));
    await invalid(async()=>{ await q("UPDATE v2_field_decisions SET support_status='corroborated' WHERE subject_id=$1",[f.id]); });
  });
  test("field resolution: immediate constraints permit complete review and field snapshots",async()=>{
    const f=await conflict(); await q("SET CONSTRAINTS ALL IMMEDIATE"); await resolve(f.assessment,f.a.observation,[f.b.observation]);
    await q("SET CONSTRAINTS ALL IMMEDIATE"); assert.equal((await fieldRead(f.id,f.scope)).dispute,"resolved");
  });
  test("field resolution: private storage and historical clock functions remain inaccessible to app roles", async () => {
    const f=await conflict(), args=await resolutionArgs(f.assessment,f.a.observation,[f.b.observation]);
    await invalid(()=>q(resolveSQL,args.map((v,i)=>i===0?context().user:v)),["42501"]);
    await q("SET LOCAL ROLE mabhazi_api");
    for(const t of fieldResolutionTables) await invalid(()=>q(`DELETE FROM ${getTableName(t)}`),["42501"]);
    await invalid(()=>q("SELECT v2_process_field_assessment($1)",[f.assessment]),["42501"]);
    await invalid(()=>q("SELECT v2_read_field_at($1,'fare.quoted',$2,$3)",[f.id,"a".repeat(64),at]),["42501"]);
    await q("RESET ROLE");
  });
  for(const isolation of ["READ COMMITTED","REPEATABLE READ"]) {
    test(`field resolution: concurrent reviewers cannot overwrite a newer decision at ${isolation}`,{timeout:20000},async()=>{
      const f=await conflict(), args=await resolutionArgs(f.assessment,f.a.observation,[f.b.observation]); await q("COMMIT");
      const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString}); await left.connect();await right.connect();
      try { await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");
        await right.query("SELECT revision FROM v2_subjects WHERE id=$1",[f.id]);await left.query(resolveSQL,args);
        const result=right.query(resolveSQL,args.map((v,i)=>i===9?randomUUID():v)).then(()=>"unexpected_success",(e:{code:string})=>e.code);
        await left.query("COMMIT");assert.equal(await result,"40001");await right.query("ROLLBACK");
      } finally {await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
    });
  }
}
