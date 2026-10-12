import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
type Context={db:pg.Client;connectionString:string;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerTransportCreationTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 async function invalid(action:()=>Promise<unknown>,codes=["23514"]){await q("SAVEPOINT invalid_creation");try{await assert.rejects(action,(e:unknown)=>{assert.ok(e instanceof Error&&"code"in e);assert.ok(codes.includes(String(e.code)),`${String(e.code)}: ${e.message}`);return true;});}finally{await q("ROLLBACK TO SAVEPOINT invalid_creation");await q("RELEASE SAVEPOINT invalid_creation");}}
 const state=async(id:string)=>(await q("SELECT * FROM v2_subjects WHERE id=$1",[id])).rows[0];
 const proposal=async(id:string)=>(await q("SELECT * FROM v2_transport_creations WHERE id=$1",[id])).rows[0];
 const read=async(id:string)=>(await q("SELECT v2_read_created_subject($1) r",[id])).rows[0].r;
 const snapshot=async(id:string)=>(await q("SELECT v2_transport_snapshot($1) r",[id])).rows[0].r;
 const roles=()=>q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING",[context().other]);
 async function lead(field="operator.reported",value?:unknown,owner=context().user){
  const id=randomUUID(),contribution=randomUUID();await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[id]);
  await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)",[contribution,owner,"a".repeat(64),id]);
  await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Named company',$3)",[id,context().corridor,contribution]);
  const observation=(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,$3,$4,'{}',v2_assessment_hash('{}'),v2_assessment_hash($4)) RETURNING id",[contribution,id,field,value??(field==="operator.reported"?{name:"Named company"}:{cityId:context().origin,name:"Named place",instructions:"Keep only in report"})])).rows[0].id as string;
  return{id,contribution,observation,owner};
 }
 type Lead=Awaited<ReturnType<typeof lead>>;
 const propose=async(f:Lead,kind="operator",request:string=randomUUID(),actor=context().other)=>(await q("SELECT v2_propose_transport_creation($1,$2,$3,$4,$5,$6) id",[actor,f.id,(await state(f.id)).revision,f.observation,kind,request])).rows[0].id as string;
 async function decide(id:string,action="accept",reverse:string|null=null,request:string=randomUUID(),actor=context().other){const p=await proposal(id),c=(await q("SELECT revision FROM v2_review_cases WHERE id=$1",[p.case_id])).rows[0];return(await q("SELECT v2_review_transport_creation($1,$2,$3,$4,$5,'identity_creation_reviewed','Private creation note',$6,$7) id",[actor,id,c.revision,(await state(p.source_subject_id)).revision,action,request,reverse])).rows[0].id as string;}
 const apply=async(id:string,review:string,request:string=randomUUID(),actor=context().other)=>(await q("SELECT v2_apply_transport_creation($1,$2,$3,$4) id",[actor,id,review,request])).rows[0].id as string;
 async function created(kind="operator",field=kind==="operator"?"operator.reported":"boarding.pickup") {await roles();const f=await lead(field),id=await propose(f,kind),p=await proposal(id),review=await decide(id),event=await apply(id,review);return{f,id,p,review,event,target:p.target_subject_id as string};}
 async function assessment(id:string,field:string){const s=await state(id),g=(await q("SELECT revision FROM v2_source_graph")).rows[0].revision;return(await q("SELECT v2_assess_field($1,$2,v2_assessment_hash('{}'),'{}',$3,$4,$5,statement_timestamp(),gen_random_uuid()) id",[id,field,s.revision,s.input_generation,g])).rows[0].id as string;}
 test("identity creation: proposal reserves an ID without registering a phantom or changing original lead",async()=>{
  await roles();const f=await lead(),before=await snapshot(f.id),id=await propose(f),p=await proposal(id);assert.equal(await read(p.target_subject_id),null);assert.equal((await q("SELECT count(*) FROM v2_subjects WHERE id=$1",[p.target_subject_id])).rows[0].count,"0");assert.deepEqual(await snapshot(f.id),before);assert.equal((await q("SELECT count(*) FROM v2_transport_creation_origins WHERE creation_id=$1",[id])).rows[0].count,"0");
 });
 test("identity creation: approved named operator gets real immutable origin and no affiliation or association",async()=>{
  const f=await created(),r=await read(f.target);assert.equal(r.status,"reviewed_origin");assert.equal(r.fieldKey,"operator.reported");assert.equal(r.snapshot.data.display_name,"Named company");assert.equal(r.snapshot.data.affiliation_status,"unverified");assert.equal(r.snapshot.data.country_code,null);assert.equal(r.observedFrom,null);
  const origin=(await q("SELECT * FROM v2_transport_creation_origins WHERE subject_id=$1",[f.target])).rows[0];assert.equal(origin.creation_id,f.id);assert.equal(origin.event_id,f.event);assert.equal(origin.review_id,f.review);assert.equal(origin.initial_revision,"1");assert.equal(origin.initial_generation,"1");assert.deepEqual(origin.snapshot,r.snapshot);assert.equal((await state(f.target)).revision,"1");
  assert.equal((await q("SELECT operator_subject_id,resolved_status FROM v2_leads WHERE subject_id=$1",[f.f.id])).rows[0].operator_subject_id,null);assert.equal((await q("SELECT count(*) FROM v2_association_links WHERE from_subject_id=$1 OR to_subject_id=$2",[f.f.id,f.target])).rows[0].count,"0");assert.ok(!JSON.stringify(r).includes(context().user));assert.ok(!JSON.stringify(r).includes("Private creation note"));await q("SET CONSTRAINTS ALL IMMEDIATE");
 });
 for(const field of ["boarding.pickup","alighting.dropoff"])test(`identity creation: ${field} produces named place without coordinates or invented parent`,async()=>{
  const f=await created("stop",field),r=await read(f.target);assert.equal(r.status,"reviewed_origin");assert.equal(r.fieldKey,field);assert.equal(r.snapshot.data.city_id,context().origin);assert.equal(r.snapshot.data.name,"Named place");assert.equal(r.snapshot.data.precision,"named_place");for(const k of ["latitude","longitude","parent_stop_id"])assert.equal(r.snapshot.data[k],null);assert.equal(r.snapshot.data.instructions,undefined);assert.equal((await q("SELECT value FROM v2_observations WHERE id=$1",[f.f.observation])).rows[0].value.instructions,"Keep only in report");await q("SET CONSTRAINTS ALL IMMEDIATE");
 });
 test("identity creation: identical proposal/apply receipts never create twice or revive reversal",async()=>{
  await roles();const f=await lead(),request=randomUUID(),id=await propose(f,"operator",request),p=await proposal(id);assert.equal(await propose(f,"operator",request),id);const review=await decide(id),applyRequest=randomUUID(),event=await apply(id,review,applyRequest);assert.equal(await apply(id,review,applyRequest),event);await decide(id,"reverse",review);assert.equal((await read(p.target_subject_id)).status,"stale");assert.equal(await apply(id,review,applyRequest),event);assert.equal((await read(p.target_subject_id)).status,"stale");assert.equal((await q("SELECT count(*) FROM v2_transport_creation_origins WHERE creation_id=$1",[id])).rows[0].count,"1");
 });
 test("identity creation: immediate review/assembly records actual final source epoch",async()=>{
  await roles();const f=await lead(),a=await assessment(f.id,"operator.reported");await q("SELECT v2_process_field_assessment($1)",[a]);const id=await propose(f),p=await proposal(id);await q("SET CONSTRAINTS ALL IMMEDIATE");const review=await decide(id),e=(await q("SELECT * FROM v2_transport_creation_events WHERE creation_id=$1 AND action='review'",[id])).rows[0],s=await state(f.id);assert.equal(e.source_revision,s.revision);assert.equal(e.source_generation,s.input_generation);assert.ok(BigInt(s.revision)>BigInt(p.expected_source_revision));await apply(id,review);assert.equal((await read(p.target_subject_id)).status,"reviewed_origin");
 });
 test("identity creation: a reused operation key with different kind/input/action conflicts",async()=>{
  await roles();const f=await lead(),key=randomUUID(),id=await propose(f,"operator",key);await invalid(()=>propose(f,"stop",key));const reviewKey=randomUUID(),review=await decide(id,"accept",null,reviewKey);await invalid(()=>decide(id,"reject",null,reviewKey));const applyKey=randomUUID();await apply(id,review,applyKey);await invalid(()=>apply(id,randomUUID(),applyKey));
 });
 test("identity creation: ordinary account or unsupported entity/field cannot invent resolved records",async()=>{
  const f=await lead();await invalid(()=>propose(f,"operator",randomUUID(),context().user),["42501"]);await roles();for(const kind of ["route","pattern","run","service_plan","stop"])await invalid(()=>propose(f,kind));const time=await lead("departure.reported",{time:"08:00",basis:"scheduled"});await invalid(()=>propose(time));
 });
 test("identity creation: selected existing IDs cannot be cloned into another operator/stop",async()=>{
  const op=await created(),place=await created("stop");const reported=await lead("operator.reported",{id:op.target}),pickup=await lead("boarding.pickup",{stopId:place.target});await invalid(()=>propose(reported));await invalid(()=>propose(pickup,"stop"));
 });
 test("identity creation: rejection and context request never register the desired identity",async()=>{
  await roles();for(const action of ["reject","needs_context"]){const f=await lead(),id=await propose(f),p=await proposal(id),review=await decide(id,action);await invalid(()=>apply(id,review));assert.equal(await read(p.target_subject_id),null);}
 });
 test("identity creation: dedicated case binding and exact reviewed evidence cannot be substituted",async()=>{
  await roles();const f=await lead(),g=await lead(),id=await propose(f),p=await proposal(id);await invalid(()=>q("UPDATE v2_review_cases SET subject_id=$1 WHERE id=$2",[g.id,p.case_id]));await invalid(()=>q("UPDATE v2_review_cases SET field_key='operator.reported',scope_key=$1 WHERE id=$2",["a".repeat(64),p.case_id]));
  await invalid(async()=>q("SELECT v2_record_review($1,$2,1,$3,'accept','wrong_proof',NULL,$4,'review/1',NULL)",[context().other,p.case_id,(await state(f.id)).revision,[g.observation]]));
  const ordinary=(await q("SELECT v2_open_review_case($1,$2,'identity',NULL,NULL) id",[context().other,f.id])).rows[0].id,review=(await q("SELECT v2_record_review($1,$2,1,$3,'accept','ordinary',NULL,$4,'review/1',NULL) id",[context().other,ordinary,(await state(f.id)).revision,[f.observation]])).rows[0].id;await invalid(()=>apply(id,review));
 });
 test("identity creation: delayed approval cannot ignore changed original lead structure",async()=>{
  await roles();const f=await lead(),id=await propose(f),p=await proposal(id);await q("UPDATE v2_leads SET reported_departure_seconds=32400 WHERE subject_id=$1",[f.id]);await invalid(()=>decide(id),["40001"]);assert.equal(await read(p.target_subject_id),null);
 });
 test("identity creation: delayed application rejects newer source revision and target-ID collision",async()=>{
  await roles();const f=await lead(),id=await propose(f),p=await proposal(id),review=await decide(id);await q("UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1",[f.id]);await invalid(()=>apply(id,review),["40001"]);
  const g=await lead(),second=await propose(g),sp=await proposal(second),sr=await decide(second);await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')",[sp.target_subject_id]);await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Already occupied')",[sp.target_subject_id]);await invalid(()=>apply(second,sr));assert.equal((await snapshot(sp.target_subject_id)).data.display_name,"Already occupied");assert.equal(await read(p.target_subject_id),null);
 });
 test("identity creation: inactive/withdrawn origin and revoked reviewer cannot apply stale approval",async()=>{
  await roles();const f=await lead(),id=await propose(f),review=await decide(id);await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)",[context().user,f.observation,randomUUID()]);await invalid(()=>apply(id,review));
  const g=await lead(),second=await propose(g),sr=await decide(second);await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture')",[context().user]);await q("SELECT v2_change_review_role($1,$2,'reviewer','revoke','test_revoke')",[context().user,context().other]);await invalid(()=>apply(second,sr));
 });
 test("identity creation: same spelling across distinct reports does not merge operator identities",async()=>{
  const a=await created(),b=await created();assert.notEqual(a.target,b.target);assert.equal((await snapshot(a.target)).data.display_name,(await snapshot(b.target)).data.display_name);assert.equal((await q("SELECT count(*) FROM v2_association_links WHERE from_subject_id=$1 OR to_subject_id=$1",[a.target])).rows[0].count,"0");
 });
 test("identity creation: one report cannot materialise repeated identities even under a fresh request",async()=>{
  const f=await created(),again=await propose(f.f),r=await decide(again);await invalid(()=>apply(again,r));assert.equal((await q("SELECT count(*) FROM v2_transport_creation_origins o JOIN v2_transport_creations p ON p.id=o.creation_id WHERE p.observation_id=$1",[f.f.observation])).rows[0].count,"1");
 });
 test("identity creation: reversal preserves shared identity and invalidates downstream interpretations",async()=>{
  const f=await created(),route=randomUUID();await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'route')",[route]);await q("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)",[route,f.target]);const a=await assessment(route,"operator.identity"),before=await state(route);await decide(f.id,"reverse",f.review);assert.equal((await read(f.target)).status,"stale");assert.equal((await state(f.target)).lifecycle,"active");assert.equal((await snapshot(route)).data.operator_subject_id,f.target);assert.ok(BigInt((await state(route)).input_generation)>BigInt(before.input_generation));assert.equal((await q("SELECT invalidated FROM v2_field_assessments WHERE id=$1",[a])).rows[0].invalidated,true);await invalid(()=>apply(f.id,f.review));await q("SET CONSTRAINTS ALL IMMEDIATE");
 });
 test("identity creation: original-source structural dependency reaches its created identity and never revives on value restoration",async()=>{
  const f=await created(),before=await state(f.target);await q("UPDATE v2_leads SET operator_name='Changed source label' WHERE subject_id=$1",[f.f.id]);assert.equal((await read(f.target)).status,"stale");assert.ok(BigInt((await state(f.target)).input_generation)>BigInt(before.input_generation));await q("UPDATE v2_leads SET operator_name='Named company' WHERE subject_id=$1",[f.f.id]);assert.equal((await read(f.target)).status,"stale");assert.equal((await snapshot(f.target)).data.display_name,"Named company");
 });
 test("identity creation: later target edits invalidate creation authority without undoing the newer projection",async()=>{
  const f=await created("stop");await q("UPDATE v2_stops SET name='Newer independent place edit' WHERE subject_id=$1",[f.target]);assert.equal((await read(f.target)).status,"stale");await decide(f.id,"reverse",f.review);assert.equal((await snapshot(f.target)).data.name,"Newer independent place edit");
 });
 test("identity creation: withdrawal removes origin authority and queues final-generation follow-up",async()=>{
  const f=await created("stop"),a=await assessment(f.target,"stop.location");await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)",[context().user,f.f.observation,randomUUID()]);assert.equal((await read(f.target)).status,"stale");assert.equal((await q("SELECT invalidated FROM v2_field_assessments WHERE id=$1",[a])).rows[0].invalidated,true);const s=await state(f.target);assert.equal((await q("SELECT max(requested_generation) g FROM v2_jobs WHERE subject_id=$1",[f.target])).rows[0].g,s.input_generation);
 });
 test("identity creation: erasing pending proof redacts private proposals and prevents receipt reuse",async()=>{
  await roles();const f=await lead(),key=randomUUID(),id=await propose(f,"operator",key),p=await proposal(id);await q("DELETE FROM v2_observations WHERE id=$1",[f.observation]);const erased=await proposal(id);assert.equal(erased.erased,true);for(const k of ["observation_id","source_snapshot","desired_snapshot","request_digest"])assert.equal(erased[k],null);await invalid(()=>q("SELECT v2_propose_transport_creation($1,$2,$3,$4,'operator',$5)",[context().other,f.id,p.expected_source_revision,f.observation,key]));assert.equal(await read(p.target_subject_id),null);
 });
 test("identity creation: deleting reviewed proof redacts origin and later inherited edit snapshots, preserving other evidence",async()=>{
  const f=await created("stop"),contribution=randomUUID();await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)",[contribution,context().other,"a".repeat(64),f.target]);
  const observation=(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'stop.location',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[contribution,f.target,{cityId:context().origin,name:"Independent newer name",precision:"named_place"}])).rows[0].id;
  const edit=(await q("SELECT v2_propose_transport_edit($1,$2,$3,$4,gen_random_uuid()) id",[context().other,f.target,(await state(f.target)).revision,observation])).rows[0].id,ep=(await q("SELECT * FROM v2_transport_edits WHERE id=$1",[edit])).rows[0];
  const review=(await q("SELECT v2_review_transport_edit($1,$2,1,$3,'accept','new_place',NULL,gen_random_uuid(),NULL) id",[context().other,edit,(await state(f.target)).revision])).rows[0].id;await q("SELECT v2_apply_transport_edit($1,$2,$3,gen_random_uuid())",[context().other,edit,review]);assert.equal(ep.before_snapshot.data.name,"Named place");await q("DELETE FROM v2_observations WHERE id=$1",[f.f.observation]);
  assert.equal((await q("SELECT snapshot FROM v2_transport_creation_origins WHERE subject_id=$1",[f.target])).rows[0].snapshot,null);assert.equal((await q("SELECT before_snapshot FROM v2_transport_edits WHERE id=$1",[edit])).rows[0].before_snapshot,null);assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1",[observation])).rows[0].count,"1");assert.equal((await read(f.target)).status,"stale");await q("SET CONSTRAINTS ALL IMMEDIATE");
 });
 test("identity creation: deleting only reviewer anonymizes actors/fingerprints but retains independently owned origin",async()=>{
  const f=await created();await q("DELETE FROM users WHERE id=$1",[context().other]);const p=await proposal(f.id);assert.equal(p.actor_user_id,null);assert.equal(p.request_digest,null);assert.equal(p.erased,false);assert.equal((await read(f.target)).status,"reviewed_origin");assert.equal((await q("SELECT snapshot FROM v2_transport_creation_origins WHERE subject_id=$1",[f.target])).rows[0].snapshot.data.display_name,"Named company");
 });
 test("identity creation: deleting reporter account redacts copied history and preserves anonymous shared identity",async()=>{
  const f=await created();await q("DELETE FROM users WHERE id=$1",[context().user]);assert.equal((await proposal(f.id)).erased,true);assert.equal((await read(f.target)).status,"stale");assert.equal((await state(f.target)).kind,"operator");assert.equal((await q("SELECT count(*) FROM v2_transport_creation_events WHERE creation_id=$1 AND request_digest IS NOT NULL",[f.id])).rows[0].count,"0");await q("SET CONSTRAINTS ALL IMMEDIATE");
 });
 test("identity creation: backend reads safe origin but cannot forge tables/call writers; clients get no access",async()=>{
  const f=await created();await q("SET LOCAL ROLE mabhazi_api");assert.equal((await read(f.target)).status,"reviewed_origin");for(const table of ["v2_transport_creations","v2_transport_creation_events","v2_transport_creation_origins","v2_transport_creation_heads"]){await q(`SELECT * FROM ${table}`);await invalid(()=>q(`DELETE FROM ${table}`),["42501"]);}await invalid(()=>apply(f.id,f.review),["42501"]);await invalid(()=>propose(f.f),["42501"]);await q("RESET ROLE");for(const role of ["anon","authenticated"]){await q(`SET LOCAL ROLE ${role}`);await invalid(()=>read(f.target),["42501"]);await invalid(()=>q("SELECT * FROM v2_transport_creation_origins"),["42501"]);await q("RESET ROLE");}
 });
 test("identity creation: raw origin/history/head forgery and caller rollback cannot leave registered ghosts",async()=>{
  const f=await created();await invalid(()=>q("UPDATE v2_transport_creation_origins SET snapshot=NULL,erased=true WHERE subject_id=$1",[f.target]));await invalid(()=>q("DELETE FROM v2_transport_creation_heads WHERE subject_id=$1",[f.target]));await invalid(()=>q("DELETE FROM v2_transport_creations WHERE id=$1",[f.id]));await invalid(()=>q("UPDATE v2_transport_creation_events SET projection_changed=false WHERE id=$1",[f.event]));
  const g=await lead(),id=await propose(g),p=await proposal(id),review=await decide(id);await q("SAVEPOINT cancelled_creation");await apply(id,review);await q("ROLLBACK TO SAVEPOINT cancelled_creation");await q("RELEASE SAVEPOINT cancelled_creation");assert.equal(await read(p.target_subject_id),null);assert.equal((await q("SELECT count(*) FROM v2_transport_creation_events WHERE creation_id=$1 AND action='apply'",[id])).rows[0].count,"0");assert.equal((await apply(id,review)).length,36);
 });
 for(const isolation of ["READ COMMITTED","REPEATABLE READ"])test(`identity creation: concurrent source edit blocks stale application at ${isolation}`,{timeout:20_000},async()=>{
  await roles();const f=await lead(),id=await propose(f),p=await proposal(id),review=await decide(id);await q("COMMIT");const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
  try{await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");await right.query("SELECT revision FROM v2_subjects WHERE id=$1",[f.id]);await left.query("UPDATE v2_leads SET reported_departure_seconds=32400 WHERE subject_id=$1",[f.id]);const pending=right.query("SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())",[context().other,id,review]).then(()=>"unexpected_success",(e:{code:string})=>e.code);await left.query("COMMIT");assert.equal(await pending,"40001");await right.query("ROLLBACK");assert.equal(await read(p.target_subject_id),null);
  }finally{await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
 });
}
