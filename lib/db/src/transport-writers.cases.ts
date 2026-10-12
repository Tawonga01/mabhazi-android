import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const key = "a".repeat(64);
export function registerWriterTests(context: () => Context) {
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
  const edit = async (id: string) => (await q("SELECT * FROM v2_transport_edits WHERE id=$1", [id])).rows[0];
  const snapshot = async (id: string) => (await q("SELECT v2_edit_snapshot($1) value", [id])).rows[0].value;
  const read = async (id: string) => (await q("SELECT v2_read_transport($1) value", [id])).rows[0].value;
  async function roles() {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
  }
  async function propose(r: Awaited<ReturnType<typeof report>>, request: string = randomUUID(), actor = context().other) {
    return (await q("SELECT v2_propose_transport_edit($1,$2,$3,$4,$5) id", [actor,r.id,(await state(r.id)).revision,r.observation,request])).rows[0].id as string;
  }
  async function decide(e: string, action = "accept", reverse: string | null = null, evidence?: string[]) {
    const p=await edit(e), c=(await q("SELECT revision FROM v2_review_cases WHERE id=$1",[p.case_id])).rows[0];
    return (await q("SELECT v2_record_review($1,$2,$3,$4,$5,'transport_observation_reviewed','Private reviewer note',$6,'review/1',$7) id",[context().other,p.case_id,c.revision,(await state(p.subject_id)).revision,action,evidence??(action==="reverse"?[]:[p.observation_id]),reverse])).rows[0].id as string;
  }
  async function apply(e: string, review: string, request: string = randomUUID(), actor=context().other) {
    return (await q("SELECT v2_apply_transport_edit($1,$2,$3,$4) id",[actor,e,review,request])).rows[0].id as string;
  }
  async function fixture() {
    await roles();const f=await transport(),r=await report(f.run,"departure.scheduled",{seconds:32400});
    const e=await propose(r);return {...f,r,e};
  }
  for(const field of ["departure.scheduled","arrival.scheduled"]) test(`writers: reviewed ${field} updates only its scheduled projection and preserves the report`,async()=>{
    await roles();const f=await transport(),r=await report(f.run,field,{seconds:36000});
    const original=(await q("SELECT * FROM v2_observations WHERE id=$1",[r.observation])).rows[0],before=await snapshot(f.run),e=await propose(r);
    assert.deepEqual(await snapshot(f.run),before);assert.equal((await read(f.run)).status,"unreviewed");
    const review=await decide(e),event=await apply(e,review),result=await read(f.run);
    assert.equal(result.status,"reviewed");assert.equal(result.snapshot.data[field==="departure.scheduled"?"departure_seconds":"arrival_seconds"],36000);
    assert.deepEqual((await q("SELECT * FROM v2_observations WHERE id=$1",[r.observation])).rows[0],original);
    const h=(await q("SELECT * FROM v2_transport_edit_events WHERE id=$1",[event])).rows[0];assert.equal(h.projection_changed,true);
    assert.equal(h.resulting_revision,(await state(f.run)).revision);assert.equal(h.resulting_generation,(await state(f.run)).input_generation);
    assert.ok(!JSON.stringify(result).includes("Private reviewer note"));assert.ok(!JSON.stringify(result).includes(context().user));await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("writers: route operator edits require exact identity evidence and propagate to descendants",async()=>{
    await roles();const f=await transport(),other=await transport(),r=await report(f.route,"operator.identity",{id:other.operator}),e=await propose(r);
    const before=await state(f.run),review=await decide(e);await apply(e,review);
    assert.equal((await snapshot(f.route)).data.operator_subject_id,other.operator);assert.equal((await read(f.route)).status,"reviewed");
    assert.ok(BigInt((await state(f.run)).input_generation)>BigInt(before.input_generation));assert.equal((await snapshot(f.pattern)).data.route_subject_id,f.route);
    await q("SET CONSTRAINTS ALL IMMEDIATE");await decide(e,"reverse",review);
    assert.equal((await snapshot(f.route)).data.operator_subject_id,f.operator);assert.equal((await read(f.route)).snapshot,null);
  });
  test("writers: stop location retains its declared precision and unknown coordinates",async()=>{
    await roles();const f=await transport(),r=await report(f.stop,"stop.location",{cityId:context().origin,name:"Reviewed boarding place",precision:"approximate",latitude:-17.825,longitude:31.033}),e=await propose(r);
    await apply(e,await decide(e));const result=await read(f.stop);assert.equal(result.status,"reviewed");assert.equal(result.snapshot.data.precision,"approximate");assert.equal(result.snapshot.data.latitude,-17.825);
    const named=await report(f.stop,"stop.location",{cityId:context().origin,name:"Named place only",precision:"named_place"}),next=await propose(named);
    await apply(next,await decide(next));assert.equal((await snapshot(f.stop)).data.latitude,null);assert.equal((await snapshot(f.stop)).data.longitude,null);await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("writers: pattern edits create a sealed reviewed version, preserve plans and reverse without rewriting history",async()=>{
    await roles();const f=await transport(),old=await snapshot(f.pattern);
    const r=await report(f.pattern,"pattern.stops",{stops:[{place:{stopId:f.stop},pickup:"request",dropoff:"forbidden"},{place:{stopId:f.stop},pickup:"unknown",dropoff:"allowed"},{place:{stopId:f.stop},pickup:"unknown",dropoff:"unknown"}],stopsComplete:false}),e=await propose(r);
    const review=await decide(e);await apply(e,review);const current=await snapshot(f.pattern);
    assert.equal(current.data.current_pattern_version,2);assert.equal(current.patternVersion.sealed,true);assert.equal(current.patternStops.length,3);assert.equal(current.patternStops[0].pickup,"request");
    assert.equal((await q("SELECT pattern_version FROM v2_service_plans WHERE subject_id=$1",[f.plan])).rows[0].pattern_version,1);
    assert.deepEqual((await q("SELECT edit_id,review_id FROM v2_pattern_version_origins WHERE pattern_subject_id=$1",[f.pattern])).rows,[{edit_id:e,review_id:review}]);
    await q("SET CONSTRAINTS ALL IMMEDIATE");await decide(e,"reverse",review);
    assert.deepEqual(await snapshot(f.pattern),old);
    assert.equal((await q("SELECT sealed FROM v2_pattern_versions WHERE pattern_subject_id=$1 AND version=2",[f.pattern])).rows[0].sealed,true);
    assert.equal((await q("SELECT count(*) FROM v2_pattern_stops WHERE pattern_subject_id=$1 AND pattern_version=2",[f.pattern])).rows[0].count,"3");
    assert.equal((await read(f.pattern)).status,"stale");
  });
  test("writers: proposal and application retries return receipts without repeated edits",async()=>{
    const f=await fixture(),p=await edit(f.e);assert.equal(await propose(f.r,p.request_id),f.e);
    const review=await decide(f.e),request=randomUUID(),event=await apply(f.e,review,request),s=await state(f.run);
    assert.equal(await apply(f.e,review,request),event);assert.deepEqual(await state(f.run),s);
    await decide(f.e,"reverse",review);const reversed=await state(f.run);
    assert.equal(await apply(f.e,review,request),event);assert.deepEqual(await state(f.run),reversed);assert.equal((await snapshot(f.run)).data.departure_seconds,28800);
  });
  test("writers: request reuse with different input conflicts",async()=>{
    const f=await fixture(),p=await edit(f.e),another=await report(f.run,"departure.scheduled",{seconds:34200});
    await invalid(()=>propose(another,p.request_id));const review=await decide(f.e),request=randomUUID();await apply(f.e,review,request);
    await invalid(()=>apply(f.e,randomUUID(),request));
  });
  test("writers: ordinary accounts and unsupported field kinds cannot propose canonical edits",async()=>{
    const f=await transport(),r=await report(f.run,"departure.scheduled",{seconds:32400});await invalid(()=>propose(r),["42501"]);
    await roles();const l=await lead();await invalid(()=>propose(l));
    const actual=await subject("actual_journey");await q("INSERT INTO v2_actual_journeys(subject_id) VALUES($1)",[actual]);
    await invalid(()=>propose({...(await report(actual,"departure.actual",{time:"09:00"})),id:actual}));
  });
  test("writers: no-op, wrong target, inactive subject and inactive evidence cannot create proposals",async()=>{
    await roles();const f=await transport(),same=await report(f.run,"departure.scheduled",{seconds:28800});await invalid(()=>propose(same));
    const r=await report(f.run,"departure.scheduled",{seconds:32400});await invalid(()=>propose({...r,id:f.route}));
    await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)",[context().user,r.observation,randomUUID()]);await invalid(()=>propose(r));
    await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[f.run]);await invalid(()=>propose(same));
  });
  test("writers: bounded dated schedules do not broaden into recurring times",async()=>{
    await roles();const f=await transport(),r=await report(f.run,"departure.scheduled",{seconds:32400},context().user,{schemaVersion:"1.0",serviceDate:"2026-10-12"});
    await invalid(()=>propose(r));await q("UPDATE v2_runs SET validity_from='2026-10-12',validity_to='2026-10-12' WHERE subject_id=$1",[f.run]);
    const e=await propose(r);await apply(e,await decide(e));assert.equal((await snapshot(f.run)).data.validity_from,"2026-10-12");
  });
  test("writers: effective periods and explicit timezone/calendar must fit the plan",async()=>{
    await roles();const f=await transport();
    for(const scope of [{schemaVersion:"1.0",effectiveFrom:"2026-10-12",effectiveTo:"2026-10-20"},{schemaVersion:"1.0",timezone:"Africa/Harare"}]) {
      const r=await report(f.run,"departure.scheduled",{seconds:32400},context().user,scope);await invalid(()=>propose(r));
    }
    const cal=(await q("INSERT INTO v2_calendars(timezone,coverage) VALUES('Africa/Harare','recurring') RETURNING id")).rows[0].id;
    const r=await report(f.run,"departure.scheduled",{seconds:32400},context().user,{schemaVersion:"1.0",calendarId:cal,timezone:"Africa/Harare"});await invalid(()=>propose(r));
    await q("UPDATE v2_service_plans SET calendar_id=$1,timezone='Africa/Harare' WHERE subject_id=$2",[cal,f.plan]);
    const e=await propose(r);await apply(e,await decide(e));
  });
  test("writers: unresolved pattern places and excess coordinate precision require further evidence resolution",async()=>{
    await roles();const f=await transport();
    const p=await report(f.pattern,"pattern.stops",{stops:[{place:{cityId:context().origin,name:"Unresolved stop"},pickup:"unknown",dropoff:"unknown"}],stopsComplete:false});await invalid(()=>propose(p));
    const s=await report(f.stop,"stop.location",{cityId:context().origin,name:"Exact input",precision:"approximate",latitude:-17.8251234,longitude:31.033});await invalid(()=>propose(s));
  });
  test("writers: approval must name the proposal's exact evidence and dedicated case",async()=>{
    const f=await fixture(),other=await report(f.run,"departure.scheduled",{seconds:34200});
    await invalid(()=>decide(f.e,"accept",null,[other.observation]),["40001"]);
    const p=await edit(f.e);await invalid(()=>q("UPDATE v2_review_cases SET kind='moderation' WHERE id=$1",[p.case_id]));
    await invalid(()=>q("UPDATE v2_review_cases SET field_key='departure.scheduled',scope_key=$2 WHERE id=$1",[p.case_id,key]));
    const c=(await q("SELECT v2_open_review_case($1,$2,'identity',NULL,NULL) id",[context().other,f.run])).rows[0].id;
    const unrelated=(await q("SELECT v2_record_review($1,$2,1,$3,'accept','fixture',NULL,$4,'review/1',NULL) id",[context().other,c,(await state(f.run)).revision,[f.r.observation]])).rows[0].id;
    await invalid(()=>apply(f.e,unrelated));
  });
  test("writers: rejection and requests for context never update the projection",async()=>{
    for(const action of ["reject","needs_context"]) {const f=await fixture(),before=await snapshot(f.run),r=await decide(f.e,action);await invalid(()=>apply(f.e,r));assert.deepEqual(await snapshot(f.run),before);}
  });
  test("writers: delayed approval and application reject structural changes",async()=>{
    const f=await fixture();await q("UPDATE v2_service_plans SET boarding_instructions='New bay' WHERE subject_id=$1",[f.plan]);
    await invalid(()=>decide(f.e),["40001"]);
    const e=await propose(f.r),review=await decide(e);await q("UPDATE v2_runs SET run_label='New identity context' WHERE subject_id=$1",[f.run]);
    await invalid(()=>apply(e,review),["40001"]);assert.equal((await snapshot(f.run)).data.departure_seconds,28800);
  });
  test("writers: a revoked reviewer cannot apply an old approval",async()=>{
    const f=await fixture(),r=await decide(f.e);await q("UPDATE v2_review_roles SET revoked_at=statement_timestamp(),reason_code='revoked_fixture' WHERE user_id=$1",[context().other]);
    await invalid(()=>apply(f.e,r));assert.equal((await snapshot(f.run)).data.departure_seconds,28800);
  });
  test("writers: parent edits make reviewed reads stale and do not revive after values change back",async()=>{
    const f=await fixture(),r=await decide(f.e);await apply(f.e,r);await q("UPDATE v2_operators SET display_name='Changed parent' WHERE subject_id=$1",[f.operator]);
    assert.deepEqual(await read(f.run),{status:"stale",snapshot:null});
    await q("UPDATE v2_operators SET display_name='Target bus' WHERE subject_id=$1",[f.operator]);assert.equal((await read(f.run)).status,"stale");
    const events=(await q("SELECT action FROM v2_transport_edit_events WHERE edit_id=$1 ORDER BY revision",[f.e])).rows.map(x=>x.action);assert.deepEqual(events,["apply","invalidate"]);
  });
  test("writers: withdrawing the reviewed report invalidates authority and downstream selections",async()=>{
    const f=await fixture();await apply(f.e,await decide(f.e));await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)",[context().user,f.r.observation,randomUUID()]);
    assert.equal((await read(f.run)).status,"stale");assert.equal((await q("SELECT count(*) FROM v2_transport_edit_heads WHERE subject_id=$1",[f.run])).rows[0].count,"0");
    const again=await state(f.run);await invalid(()=>apply(f.e,randomUUID()),["23514","40001"]);assert.deepEqual(await state(f.run),again);
  });
  test("writers: reversing an older edit cannot overwrite a later reviewed projection",async()=>{
    const f=await fixture(),first=await decide(f.e);await apply(f.e,first);
    const r=await report(f.run,"departure.scheduled",{seconds:34200}),e=await propose(r),next=await decide(e);await apply(e,next);
    assert.equal((await snapshot(f.run)).data.departure_seconds,34200);await decide(f.e,"reverse",first);
    assert.equal((await snapshot(f.run)).data.departure_seconds,34200);assert.equal((await read(f.run)).status,"reviewed");
    assert.equal((await q("SELECT projection_changed FROM v2_transport_edit_events WHERE edit_id=$1 AND action='reverse'",[f.e])).rows[0].projection_changed,false);
    await decide(e,"reverse",next);assert.equal((await snapshot(f.run)).data.departure_seconds,32400);assert.equal((await read(f.run)).status,"stale");
  });
  test("writers: deleting evidence redacts later copied snapshots but preserves independent observations",async()=>{
    const f=await fixture(),review=await decide(f.e),request=randomUUID();await apply(f.e,review,request);
    const surviving=await report(f.run,"arrival.scheduled",{seconds:40000},context().other),e=await propose(surviving);await apply(e,await decide(e));
    await q("DELETE FROM users WHERE id=$1",[context().user]);await q("SET CONSTRAINTS ALL IMMEDIATE");
    for(const id of [f.e,e]) {const p=await edit(id);assert.equal(p.erased,true);for(const k of ["observation_id","observation_revision","target_revision","before_snapshot","after_snapshot","observation_scope","request_digest"])assert.equal(p[k],null,k);}
    assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1",[surviving.observation])).rows[0].count,"1");assert.equal((await read(f.run)).snapshot,null);
    await invalid(()=>apply(f.e,review,request));assert.ok((await q("SELECT request_digest FROM v2_transport_edit_events WHERE edit_id=ANY($1)",[[f.e,e]])).rows.every(x=>x.request_digest===null));
  });
  test("writers: deleting only the reviewer clears actor fingerprints without losing independent transport evidence",async()=>{
    const f=await fixture(),review=await decide(f.e);await apply(f.e,review);await q("DELETE FROM users WHERE id=$1",[context().other]);
    await q("SET CONSTRAINTS ALL IMMEDIATE");const p=await edit(f.e);assert.equal(p.actor_user_id,null);assert.equal(p.request_digest,null);assert.equal(p.erased,false);
    const event=(await q("SELECT actor_user_id,request_digest FROM v2_transport_edit_events WHERE edit_id=$1 AND action='apply'",[f.e])).rows[0];assert.deepEqual(event,{actor_user_id:null,request_digest:null});
    assert.equal((await read(f.run)).status,"reviewed");assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1",[f.r.observation])).rows[0].count,"1");
  });
  test("writers: raw history/current-head forgery fails and the backend/client roles remain restricted",async()=>{
    const f=await fixture(),r=await decide(f.e),event=await apply(f.e,r);
    await invalid(()=>q("UPDATE v2_transport_edits SET after_snapshot='{}' WHERE id=$1",[f.e]));await invalid(()=>q("DELETE FROM v2_transport_edits WHERE id=$1",[f.e]));
    await invalid(()=>q("UPDATE v2_transport_edit_events SET projection_changed=false WHERE id=$1",[event]));
    await invalid(()=>q("DELETE FROM v2_transport_edit_heads WHERE subject_id=$1",[f.run]));
    await q("SET LOCAL ROLE mabhazi_api");assert.equal((await read(f.run)).status,"reviewed");
    for(const table of ["v2_transport_edits","v2_transport_edit_events","v2_transport_edit_heads","v2_pattern_version_origins"])await invalid(()=>q(`DELETE FROM ${table}`),["42501"]);
    await invalid(()=>apply(f.e,r),["42501"]);await q("RESET ROLE");
    for(const role of ["anon","authenticated"]) {await q(`SET LOCAL ROLE ${role}`);await invalid(()=>read(f.run),["42501"]);await invalid(()=>q("SELECT * FROM v2_transport_edits"),["42501"]);await q("RESET ROLE");}
  });
  test("writers: invalid run timing rolls back structure, approval application history and jobs",async()=>{
    await roles();const f=await transport();await q("UPDATE v2_runs SET arrival_seconds=33000 WHERE subject_id=$1",[f.run]);
    const r=await report(f.run,"departure.scheduled",{seconds:36000}),e=await propose(r),review=await decide(e),before=await snapshot(f.run),s=await state(f.run),jobs=(await q("SELECT count(*) FROM v2_jobs")).rows[0].count;
    await invalid(()=>apply(e,review));assert.deepEqual(await snapshot(f.run),before);assert.deepEqual(await state(f.run),s);
    assert.equal((await q("SELECT count(*) FROM v2_transport_edit_events WHERE edit_id=$1",[e])).rows[0].count,"0");assert.equal((await q("SELECT count(*) FROM v2_jobs")).rows[0].count,jobs);
  });
  test("writers: endpoint integrity failure leaves no published pattern version or origin",async()=>{
    await roles();const f=await transport(),a=await subject("stop"),b=await subject("stop");
    await q("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$3,'Wrong origin'),($2,$4,'Wrong destination')",[a,b,context().destination,context().origin]);
    const r=await report(f.pattern,"pattern.stops",{stops:[{place:{stopId:a},pickup:"allowed",dropoff:"unknown"},{place:{stopId:b},pickup:"unknown",dropoff:"allowed"}],stopsComplete:true}),e=await propose(r),review=await decide(e);
    await invalid(()=>apply(e,review));assert.equal((await snapshot(f.pattern)).data.current_pattern_version,1);
    assert.equal((await q("SELECT count(*) FROM v2_pattern_versions WHERE pattern_subject_id=$1",[f.pattern])).rows[0].count,"1");assert.equal((await q("SELECT count(*) FROM v2_pattern_version_origins WHERE edit_id=$1",[e])).rows[0].count,"0");
  });
  for(const isolation of ["READ COMMITTED","REPEATABLE READ"]) test(`writers: concurrent parent edit rejects delayed application at ${isolation}`,{timeout:20_000},async()=>{
    const f=await fixture(),review=await decide(f.e);await q("COMMIT");const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");await right.query("SELECT revision FROM v2_subjects WHERE id=$1",[f.run]);
      await left.query("UPDATE v2_operators SET display_name='Concurrent new parent' WHERE subject_id=$1",[f.operator]);
      const result=right.query("SELECT v2_apply_transport_edit($1,$2,$3,$4)",[context().other,f.e,review,randomUUID()]).then(()=>"unexpected_success",(e:{code:string})=>e.code);
      await left.query("COMMIT");assert.equal(await result,"40001");await right.query("ROLLBACK");
      assert.equal((await snapshot(f.run)).data.departure_seconds,28800);
    } finally {await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
  });
}
