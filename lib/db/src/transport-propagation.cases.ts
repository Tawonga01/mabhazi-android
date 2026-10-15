import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const key = "a".repeat(64);
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
const resolveSQL = "SELECT v2_resolve_observation_target($1,$2,$3,$4,$5,$6) id";
export function registerPropagationTests(context: () => Context) {
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
  async function report(id: string, field = "departure.reported", value: unknown = { time: "08:00", basis: "scheduled" }, owner = context().user, scope?: unknown) {
    const contribution = randomUUID();
    await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, owner, key, id]);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key)
      VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [contribution, id, field, value, scope ?? (field.endsWith(".scheduled") || field.endsWith(".actual") ? { schemaVersion: "1.0" } : {}), key])).rows[0].id as string;
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
    return { operator, route, pattern, stop, plan, run };
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
  const eventCount = async () => Number((await q("SELECT count(*) FROM v2_transport_changes")).rows[0].count);
  const generations = async (ids: string[]) => (await q("SELECT id,revision,input_generation FROM v2_subjects WHERE id=ANY($1) ORDER BY id", [ids])).rows;
  async function advanced(before: Awaited<ReturnType<typeof generations>>) {
    for (const old of before) {
      const now = await state(old.id);
      assert.ok(BigInt(now.revision)>BigInt(old.revision), `revision ${old.id}`);
      assert.ok(BigInt(now.input_generation)>BigInt(old.input_generation), `generation ${old.id}`);
    }
  }
  async function calendar() { return (await q("INSERT INTO v2_calendars(timezone,coverage) VALUES('Africa/Harare','recurring') RETURNING id")).rows[0].id as string; }
  async function assessment(subjectId: string) {
    const s = await state(subjectId);
    return (await q("SELECT v2_assess_field($1,'departure.scheduled',v2_assessment_hash($2),$2,$3,$4,(SELECT revision FROM v2_source_graph),statement_timestamp(),gen_random_uuid()) id", [subjectId,{schemaVersion:"1.0"},s.revision,s.input_generation])).rows[0].id as string;
  }
  async function actual(intended: string) {
    const id=await subject("actual_journey");
    await q("INSERT INTO v2_actual_journeys(subject_id,intended_subject_id,intended_subject_kind) VALUES($1,$2,'run')",[id,intended]); return id;
  }
  test("propagation: operator edits reach service descendants once, including diamond paths", async()=>{
    const f=await transport(), journey=await actual(f.run), unrelated=await transport();
    const ids=[f.operator,f.route,f.pattern,f.plan,f.run,journey], before=await generations(ids), untouched=await generations(Object.values(unrelated));
    const n=await eventCount(); await q("UPDATE v2_operators SET display_name='Revised operator' WHERE subject_id=$1",[f.operator]);
    await advanced(before); assert.deepEqual(await generations(Object.values(unrelated)),untouched); assert.equal(await eventCount(),n+1);
    const effects=(await q("SELECT * FROM v2_transport_change_subjects WHERE change_id=(SELECT change_id FROM v2_transport_change_subjects WHERE subject_id=$1 ORDER BY resulting_generation DESC LIMIT 1)",[f.operator])).rows;
    assert.deepEqual(effects.map(x=>x.subject_id).sort(),ids.sort()); assert.equal(effects.filter(x=>x.is_root).length,1);
    for(const e of effects) {
      assert.equal(e.resulting_generation,(await state(e.subject_id)).input_generation);
      const jobs=(await q("SELECT kind,requested_generation FROM v2_jobs WHERE trigger_id=$1 AND subject_id=$2 ORDER BY kind",[e.change_id,e.subject_id])).rows;
      assert.deepEqual(jobs,[{kind:"assess",requested_generation:e.resulting_generation},{kind:"refresh_tasks",requested_generation:e.resulting_generation}]);
    }
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("propagation: stop ancestry reaches plans attached to historical sealed versions",async()=>{
    const f=await transport(), parent=await subject("stop"), otherStop=await subject("stop");
    await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Parent terminal'),($2,'Replacement stop')",[parent,otherStop]);
    await q("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2",[parent,f.stop]);
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,2)",[f.pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,2,0,$2)",[f.pattern,otherStop]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1 AND version=2",[f.pattern]);
    await q("UPDATE v2_patterns SET current_pattern_version=2 WHERE subject_id=$1",[f.pattern]);
    const before=await generations([parent,f.stop,f.pattern,f.plan,f.run]);
    await q("UPDATE v2_stops SET name='Renamed terminal' WHERE subject_id=$1",[parent]); await advanced(before);
    assert.equal((await q("SELECT pattern_version FROM v2_service_plans WHERE subject_id=$1",[f.plan])).rows[0].pattern_version,1);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("propagation: draft stop-list construction does not disturb published dependents",async()=>{
    const f=await transport(), before=await generations(Object.values(f)), count=await eventCount();
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,2)",[f.pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,2,0,$2)",[f.pattern,f.stop]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1 AND version=2",[f.pattern]);
    assert.deepEqual(await generations(Object.values(f)),before); assert.equal(await eventCount(),count);
  });
  test("propagation: a plan edit invalidates dependent assessment and selected field",async()=>{
    const f=await transport(), a=await assessment(f.run), d=(await q("SELECT v2_process_field_assessment($1) id",[a])).rows[0].id;
    await q("UPDATE v2_service_plans SET boarding_instructions='Board at revised bay' WHERE subject_id=$1",[f.plan]);
    assert.equal((await q("SELECT invalidated FROM v2_field_assessments WHERE id=$1",[a])).rows[0].invalidated,true);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1",[d])).rows[0].invalidated,true);
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=$1",[f.run])).rows[0].count,"0");
    assert.equal((await q("SELECT count(*) FROM v2_current_assessments WHERE subject_id=$1",[f.run])).rows[0].count,"0");
    await invalid(()=>q("SELECT v2_process_field_assessment($1)",[a]),["23514","40001"]);
  });
  test("propagation: calendar changes and each exception operation invalidate attached services",async()=>{
    const f=await transport(), cal=await calendar();
    await q("UPDATE v2_service_plans SET calendar_id=$1 WHERE subject_id=$2",[cal,f.plan]);
    for(const sql of ["UPDATE v2_calendars SET weekdays=31 WHERE id=$1","INSERT INTO v2_calendar_exceptions VALUES($1,'2026-11-12','add')","UPDATE v2_calendar_exceptions SET action='remove' WHERE calendar_id=$1","DELETE FROM v2_calendar_exceptions WHERE calendar_id=$1"]) {
      const before=await generations([f.plan,f.run]); await q(sql,[cal]); await advanced(before);
    }
  });
  test("propagation: run-stop insertion, correction and deletion affect only that run",async()=>{
    const f=await transport(); const parent=await generations([f.pattern,f.plan]);
    const statements=["INSERT INTO v2_run_stop_times(run_subject_id,pattern_subject_id,pattern_version,pattern_sequence,departure_seconds) VALUES($1,$2,1,0,28800)","UPDATE v2_run_stop_times SET departure_seconds=28900 WHERE run_subject_id=$1 AND pattern_subject_id=$2","DELETE FROM v2_run_stop_times WHERE run_subject_id=$1 AND pattern_subject_id=$2"];
    for(const sql of statements) {const before=await generations([f.run]);await q(sql,[f.run,f.pattern]);await advanced(before);}
    assert.deepEqual(await generations([f.pattern,f.plan]),parent);
  });
  test("propagation: inserted and deleted child rows invalidate non-root actual journeys",async()=>{
    const f=await transport(),journey=await actual(f.run);
    for(const sql of ["INSERT INTO v2_run_stop_times(run_subject_id,pattern_subject_id,pattern_version,pattern_sequence,departure_seconds) VALUES($1,$2,1,0,28800)","DELETE FROM v2_run_stop_times WHERE run_subject_id=$1 AND pattern_subject_id=$2"]) {
      const before=await generations([f.run,journey]);await q(sql,[f.run,f.pattern]);await advanced(before);
      const effects=(await q("SELECT is_root FROM v2_transport_change_subjects WHERE subject_id=$1 ORDER BY resulting_generation DESC LIMIT 1",[journey])).rows;
      assert.deepEqual(effects,[{is_root:false}]);
    }
  });
  test("propagation: deleting an unused subject removes only its audit links",async()=>{
    const id=await subject("stop");await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Disposable stop')",[id]);
    await q("UPDATE v2_stops SET name='Renamed disposable stop' WHERE subject_id=$1",[id]);
    const event=(await q("SELECT change_id FROM v2_transport_change_subjects WHERE subject_id=$1",[id])).rows[0].change_id;
    await q("DELETE FROM v2_stops WHERE subject_id=$1",[id]);await q("DELETE FROM v2_jobs WHERE subject_id=$1",[id]);await q("DELETE FROM v2_subjects WHERE id=$1",[id]);
    assert.equal((await q("SELECT count(*) FROM v2_transport_change_subjects WHERE change_id=$1",[event])).rows[0].count,"0");
    assert.equal((await q("SELECT count(*) FROM v2_transport_changes WHERE id=$1",[event])).rows[0].count,"1");await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  for(const mode of ["frequency","on_demand"]) test(`propagation: ${mode} window moves invalidate old and new owners`,async()=>{
    const f=await transport(), a=await subject("service_plan"), b=await subject("service_plan");
    await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$3,1,$4),($2,$3,1,$4)",[a,b,f.pattern,mode]);
    const table=mode==="frequency"?"v2_frequency_windows":"v2_availability_windows";
    const before=await generations([a]);
    const w=(await q(mode==="frequency"?"INSERT INTO v2_frequency_windows(service_plan_subject_id,start_seconds,end_seconds,headway_seconds) VALUES($1,0,7200,1800) RETURNING id":"INSERT INTO v2_availability_windows(service_plan_subject_id,plan_mode,booking_note) VALUES($1,'on_demand','Ask at station') RETURNING id",[a])).rows[0].id;
    await advanced(before);const move=await generations([a,b]);await q(`UPDATE ${table} SET service_plan_subject_id=$1 WHERE id=$2`,[b,w]);await advanced(move);
    const remove=await generations([b]);await q(`DELETE FROM ${table} WHERE id=$1`,[w]);await advanced(remove);
  });
  test("propagation: a city change reaches observation-only references",async()=>{
    const a=await lead(context().user,"boarding.pickup",{cityId:context().origin,name:"Synthetic stop"});
    const extra=(await q("INSERT INTO cities(name,place_type) VALUES('Reference-only city','city') RETURNING id")).rows[0].id;
    const b=await report(a.id,"alighting.dropoff",{cityId:extra,name:"Dropoff"}); const before=await generations([a.id]);
    await q("UPDATE cities SET name='Renamed reference city' WHERE id=$1",[extra]);await advanced(before);
    assert.equal((await q("SELECT value FROM v2_observations WHERE id=$1",[b.observation])).rows[0].value.name,"Dropoff");
  });
  test("propagation: observation-only stop and operator references invalidate their subjects",async()=>{
    const f=await transport(),g=await transport();
    const a=await lead(context().user,"boarding.pickup",{stopId:g.stop});
    await report(f.route,"operator.identity",{id:g.operator});
    const before=await generations([a.id,f.route,f.pattern,f.plan,f.run]);
    await q("UPDATE v2_stops SET name='Referenced stop changed' WHERE subject_id=$1",[g.stop]);
    await q("UPDATE v2_operators SET display_name='Referenced operator changed' WHERE subject_id=$1",[g.operator]);await advanced(before);
  });
  test("propagation: observation-only calendar references reach original and resolved subjects",async()=>{
    const a=await lead(),f=await transport(),cal=await calendar();
    const o=await report(a.id,"departure.scheduled",{seconds:28800},context().user,{schemaVersion:"1.0",calendarId:cal,timezone:"Africa/Harare"});
    const l=await link(o,f.run,"same_service");await resolve(o,l);const before=await generations([a.id,f.run]);
    await q("UPDATE v2_calendars SET weekdays=31 WHERE id=$1",[cal]);await advanced(before);
    assert.equal(await effective(o.observation),a.id);await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("propagation: corridor endpoint changes reach leads and patterns",async()=>{
    const a=await lead(), f=await transport(), city=(await q("INSERT INTO cities(name,place_type) VALUES('New endpoint','city') RETURNING id")).rows[0].id;
    const before=await generations([a.id,f.pattern,f.plan,f.run]);await q("UPDATE v2_corridors SET destination_city_id=$1 WHERE id=$2",[city,context().corridor]);await advanced(before);
  });
  test("propagation: external-ID reassignment invalidates both subjects without copying the identifier",async()=>{
    const a=await lead(), b=await lead(); const w=(await q("INSERT INTO v2_external_ids(source_namespace,entity_kind,external_id,subject_id,import_version) VALUES('fixture','lead','PRIVATE-EXTERNAL-ID',$1,'1') RETURNING id",[a.id])).rows[0].id;
    const before=await generations([a.id,b.id]);await q("UPDATE v2_external_ids SET subject_id=$1 WHERE id=$2",[b.id,w]);await advanced(before);
    assert.ok(!JSON.stringify((await q("SELECT * FROM v2_transport_changes")).rows).includes("PRIVATE-EXTERNAL-ID"));
    const removed=await generations([b.id]);await q("DELETE FROM v2_external_ids WHERE id=$1",[w]);await advanced(removed);
  });
  test("propagation: legacy mapping changes preserve unresolved status and invalidate both subjects",async()=>{
    const a=await lead(),b=await lead(),legacy=(await q("SELECT id FROM journeys ORDER BY id LIMIT 1")).rows[0].id;
    await q("INSERT INTO v2_legacy_links(legacy_journey_id,subject_id,import_version) VALUES($1,$2,'1')",[legacy,a.id]);const before=await generations([a.id,b.id]);
    await q("UPDATE v2_legacy_links SET subject_id=$1 WHERE legacy_journey_id=$2 AND subject_id=$3",[b.id,legacy,a.id]);await advanced(before);
    assert.equal((await q("SELECT mapping_state FROM v2_legacy_links WHERE legacy_journey_id=$1 AND subject_id=$2",[legacy,b.id])).rows[0].mapping_state,"unresolved");
  });
  test("propagation: no-op edits and generation changes do not recurse or fabricate structural events",async()=>{
    const f=await transport(),n=await eventCount(),before=await generations(Object.values(f));
    await q("UPDATE v2_operators SET display_name=display_name WHERE subject_id=$1",[f.operator]);assert.deepEqual(await generations(Object.values(f)),before);
    await q("UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1",[f.run]);assert.equal(await eventCount(),n);
  });
  test("propagation: attribution erasure is not a service identity edit",async()=>{
    const a=await lead(),before=await generations([a.id]),n=await eventCount();
    await q("UPDATE v2_leads SET initial_contribution_id=NULL,attribution_erased=true WHERE subject_id=$1",[a.id]);
    assert.deepEqual(await generations([a.id]),before);assert.equal(await eventCount(),n);
    await q("DELETE FROM users WHERE id=$1",[context().user]);
    assert.equal((await q("SELECT attribution_erased FROM v2_leads WHERE subject_id=$1",[a.id])).rows[0].attribution_erased,true);
    assert.equal(await eventCount(),n);
  });
  test("propagation: parent edits invalidate reviewed identity, fall back the target and preserve reports",async()=>{
    const a=await lead(context().user,"departure.scheduled",{seconds:28800}),f=await transport(),l=await link(a,f.run,"same_service");await resolve(a,l);
    const original=(await q("SELECT * FROM v2_observations WHERE id=$1",[a.observation])).rows[0];const before=await generations([a.id,f.run]);
    await q("UPDATE v2_operators SET display_name='Updated parent identity' WHERE subject_id=$1",[f.operator]);
    await advanced(before);assert.equal(await effective(a.observation),a.id);
    assert.equal((await q("SELECT state FROM v2_association_candidates WHERE id=$1",[l.candidate])).rows[0].state,"obsolete");
    assert.equal((await q("SELECT invalidated FROM v2_association_decisions WHERE id=$1",[l.id])).rows[0].invalidated,true);
    assert.deepEqual((await q("SELECT * FROM v2_observations WHERE id=$1",[a.observation])).rows[0],original);
    await q("UPDATE v2_operators SET display_name='Target bus' WHERE subject_id=$1",[f.operator]);assert.equal(await effective(a.observation),a.id);
    await invalid(()=>q("SELECT v2_apply_association_decision($1)",[l.id]));await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("propagation: a pending candidate cannot apply after structural identity changes",async()=>{
    const a=await lead(),f=await transport(),l=await link(a,f.run,"same_service",[a.observation],false);
    await q("UPDATE v2_service_plans SET boarding_instructions='Changed' WHERE subject_id=$1",[f.plan]);
    assert.equal((await q("SELECT state FROM v2_association_candidates WHERE id=$1",[l.candidate])).rows[0].state,"obsolete");
    await invalid(()=>q("SELECT v2_apply_association_decision($1)",[l.id]),["23514","40001"]);
  });
  test("propagation: retirement of an operator invalidates downstream results",async()=>{
    const f=await transport(),a=await assessment(f.run),before=await generations([f.operator,f.route,f.pattern,f.plan,f.run]);
    await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[f.operator]);await advanced(before);
    assert.equal((await q("SELECT invalidated FROM v2_field_assessments WHERE id=$1",[a])).rows[0].invalidated,true);
    assert.equal((await state(f.run)).lifecycle,"active");
  });
  test("propagation: a changed service obsoletes an open question and asks the user to reconfirm",async()=>{
    const a=await lead(),s=await state(a.id),t=(await q("SELECT v2_prompt_put_task($1,'boarding.pickup','{}','pickup_place',$2) id",[a.id,s.input_generation])).rows[0].id;
    const i=(await q("SELECT v2_prompt_reserve($1,$2,ARRAY['knows_route'],'route_detail',NULL,$3) id",[context().user,randomUUID(),a.id])).rows[0].id;assert.ok(i);
    await q("UPDATE v2_leads SET reported_departure_seconds=32400 WHERE subject_id=$1",[a.id]);
    assert.equal((await q("SELECT state FROM v2_question_tasks WHERE id=$1",[t])).rows[0].state,"obsolete");
    assert.equal((await q("SELECT v2_prompt_read($1,$2) r",[context().user,i])).rows[0].r.status,"reconfirm_identity");
  });
  test("propagation: immutable change history records columns, never transport or account values",async()=>{
    const a=await lead();await q("UPDATE v2_leads SET operator_name='PRIVATE COMPANY LABEL' WHERE subject_id=$1",[a.id]);
    const e=(await q("SELECT c.* FROM v2_transport_changes c JOIN v2_transport_change_subjects s ON s.change_id=c.id WHERE s.subject_id=$1",[a.id])).rows[0];
    assert.deepEqual(e.changed_columns,["operator_name"]);assert.equal(e.source_table,"v2_leads");assert.ok(!JSON.stringify(e).includes("PRIVATE COMPANY LABEL"));assert.ok(!JSON.stringify(e).includes(context().user));
    await invalid(()=>q("UPDATE v2_transport_changes SET source_table='forged' WHERE id=$1",[e.id]));
    await invalid(()=>q("DELETE FROM v2_transport_changes WHERE id=$1",[e.id]));
    await invalid(()=>q("INSERT INTO v2_transport_changes(source_table,operation,changed_columns) VALUES('forged','UPDATE',ARRAY['name'])"));
    await invalid(()=>q("UPDATE v2_transport_change_subjects SET is_root=false WHERE change_id=$1",[e.id]));
    await q("DELETE FROM users WHERE id=$1",[context().user]);
    assert.equal((await q("SELECT count(*) FROM v2_transport_changes WHERE id=$1",[e.id])).rows[0].count,"1");
  });
  test("propagation: backend can read change history but cannot forge it or invoke owner helpers",async()=>{
    const f=await transport();await q("SET LOCAL ROLE mabhazi_api");
    await q("UPDATE v2_operators SET display_name='Backend structural edit' WHERE subject_id=$1",[f.operator]);
    assert.ok((await q("SELECT * FROM v2_transport_changes WHERE source_table='v2_operators'")).rowCount);
    await invalid(()=>q("DELETE FROM v2_transport_changes"),["42501"]);
    await invalid(()=>q("SELECT v2_transport_propagate($1,'forged','UPDATE',ARRAY['name'])",[[f.operator]]),["42501"]);
    await q("RESET ROLE");
    for(const role of ["anon","authenticated"]) {await q(`SET LOCAL ROLE ${role}`);await invalid(()=>q("SELECT * FROM v2_transport_changes"),["42501"]);await q("RESET ROLE");}
  });
  test("propagation: deferred structural failure rolls back invalidation, change log and queued jobs",async()=>{
    const f=await transport(),before=await generations(Object.values(f)),n=await eventCount(),jobs=(await q("SELECT count(*) FROM v2_jobs")).rows[0].count;
    await q("SAVEPOINT bad_structure");
    await q("UPDATE v2_stops SET parent_stop_id=subject_id WHERE subject_id=$1",[f.stop]).then(()=>q("SET CONSTRAINTS ALL IMMEDIATE")).then(()=>assert.fail("cycle committed"),e=>assert.equal(e.code,"23514"));
    await q("ROLLBACK TO SAVEPOINT bad_structure");await q("RELEASE SAVEPOINT bad_structure");
    assert.deepEqual(await generations(Object.values(f)),before);assert.equal(await eventCount(),n);assert.equal((await q("SELECT count(*) FROM v2_jobs")).rows[0].count,jobs);
  });
  for(const isolation of ["READ COMMITTED","REPEATABLE READ"]) test(`propagation: concurrent parent edit rejects stale assessment at ${isolation}`,{timeout:20_000},async()=>{
    const f=await transport(),s=await state(f.run),g=(await q("SELECT revision FROM v2_source_graph")).rows[0].revision;await q("COMMIT");
    const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'");await right.query("SELECT input_generation FROM v2_subjects WHERE id=$1",[f.run]);
      await left.query("UPDATE v2_operators SET display_name='Concurrent parent edit' WHERE subject_id=$1",[f.operator]);
      const result=right.query("SELECT v2_assess_field($1,'departure.scheduled',v2_assessment_hash($2),$2,$3,$4,$5,statement_timestamp(),gen_random_uuid())",[f.run,{schemaVersion:"1.0"},s.revision,s.input_generation,g]).then(()=>"unexpected_success",(e:{code:string})=>e.code);
      await left.query("COMMIT");assert.equal(await result,"40001");await right.query("ROLLBACK");
    } finally {await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
  });
}
