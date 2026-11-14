import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerReviewedCalendarTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 const state=async(id:string)=>(await q('SELECT * FROM v2_subjects WHERE id=$1',[id])).rows[0];
 const calendar=(extra:Record<string,unknown>={})=>({weekdays:[1,3,5],startDate:'2026-11-14',endDate:'2026-12-14',timezone:'Africa/Harare',...extra});
 async function invalid(action:()=>Promise<unknown>,codes=['23514']){
  await q('SAVEPOINT invalid_calendar');
  try{await assert.rejects(action,(e:unknown)=>{assert.ok(e instanceof Error&&'code'in e);assert.ok(codes.includes(String(e.code)),e.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_calendar');await q('RELEASE SAVEPOINT invalid_calendar');}
 }
 async function fixture(period?:{from:string;to:string}){
  const c=context(),operator=randomUUID(),route=randomUUID(),pattern=randomUUID(),plan=randomUUID();
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING",[c.other]);
  await q('SET CONSTRAINTS public.v2_subject_subtype,public.v2_current_pattern_version DEFERRED');
  for(const [id,kind] of [[operator,'operator'],[route,'route'],[pattern,'pattern'],[plan,'service_plan']])await q('INSERT INTO v2_subjects(id,kind) VALUES($1,$2)',[id,kind]);
  await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Calendar writer fixture')",[operator]);
  await q('INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)',[route,operator]);
  await q('INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)',[pattern,route,c.corridor]);
  await q('INSERT INTO v2_pattern_versions(pattern_subject_id,version,stops_complete,sealed) VALUES($1,1,false,true)',[pattern]);
  await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode,effective_from,effective_to) VALUES($1,$2,1,'fixed_time',$3,$4)",[plan,pattern,period?.from??null,period?.to??null]);
  await q('SET CONSTRAINTS public.v2_subject_subtype,public.v2_current_pattern_version IMMEDIATE');
  return{operator,route,pattern,plan};
 }
 async function report(plan:string,value:unknown=calendar()){
  const contribution=(await q("INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,gen_random_uuid(),'1.0','reviewer_context',$2,'{}',$3) RETURNING id",[context().user,'a'.repeat(64),plan])).rows[0].id;
  return(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from) VALUES($1,$2,'service.calendar',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3),'observed_sign','2026-11-14') RETURNING id",[contribution,plan,value])).rows[0].id as string;
 }
 async function proposal(plan:string,observation:string,key=randomUUID()){
  return(await q('SELECT v2_propose_transport_edit($1,$2,$3,$4,$5) id',[context().other,plan,(await state(plan)).revision,observation,key])).rows[0].id as string;
 }
 async function decide(edit:string,operation='accept',reverses:string|null=null){
  const e=(await q('SELECT * FROM v2_transport_edits WHERE id=$1',[edit])).rows[0],c=(await q('SELECT * FROM v2_review_cases WHERE id=$1',[e.case_id])).rows[0];
  return(await q("SELECT v2_review_transport_edit($1,$2,$3,$4,$5,'calendar_source_checked',NULL,gen_random_uuid(),$6) id",[context().other,edit,c.revision,(await state(e.subject_id)).revision,operation,reverses])).rows[0].id as string;
 }
 const apply=async(edit:string,review:string,key=randomUUID())=>(await q('SELECT v2_apply_transport_edit($1,$2,$3,$4) id',[context().other,edit,review,key])).rows[0].id;
 const read=async(plan:string)=>(await q('SELECT v2_read_transport($1) r',[plan])).rows[0].r;
 test('calendar writer: creates only the exact reviewed bounded calendar; optional transport facts remain unknown',async()=>{
  const f=await fixture(),o=await report(f.plan),p=await proposal(f.plan,o);
  assert.equal((await q('SELECT count(*) n FROM v2_calendars WHERE id=$1',[o])).rows[0].n,'0');
  const review=await decide(p);await apply(p,review);const result=await read(f.plan);
  assert.equal(result.status,'reviewed');assert.equal(result.fieldKey,'service.calendar');assert.equal(result.snapshot.data.calendar_id,o);
  assert.equal(result.snapshot.data.timezone,'Africa/Harare');assert.equal(result.snapshot.calendar.weekdays,21);
  assert.equal(result.snapshot.calendar.start_date,'2026-11-14');assert.equal(result.snapshot.calendar.end_date,'2026-12-14');
  assert.equal((await q('SELECT count(*) n FROM v2_runs WHERE service_plan_subject_id=$1',[f.plan])).rows[0].n,'0');
 });
 test('calendar writer: future literal review does not backdate an assessment or claim public departure eligibility',async()=>{
  const f=await fixture(),o=await report(f.plan,calendar({startDate:'2099-01-01',endDate:'2099-02-01'})),p=await proposal(f.plan,o),review=await decide(p);
  await apply(p,review);assert.equal((await read(f.plan)).snapshot.calendar.start_date,'2099-01-01');
  assert.equal((await q('SELECT count(*) n FROM v2_field_assessments WHERE subject_id=$1',[f.plan])).rows[0].n,'0');
  assert.equal((await q('SELECT count(*) n FROM v2_runs WHERE service_plan_subject_id=$1',[f.plan])).rows[0].n,'0');
 });
 for(const value of [calendar({weekdays:null}),calendar({timezone:undefined}),calendar({endDate:undefined}),{dates:['2026-11-14'],timezone:'Africa/Harare'},calendar({exceptions:[{date:'2026-11-18',action:'remove'}]})])
  test('calendar writer: partial or richer calendar is held without dropping source meaning '+JSON.stringify(value),async()=>{
   const f=await fixture(),o=await report(f.plan,value);await invalid(()=>proposal(f.plan,o));
   assert.equal((await q('SELECT calendar_id FROM v2_service_plans WHERE subject_id=$1',[f.plan])).rows[0].calendar_id,null);
  });
 test('calendar writer: rejects broader source validity than the parent plan',async()=>{
  const f=await fixture({from:'2026-11-20',to:'2026-12-01'}),o=await report(f.plan);await invalid(()=>proposal(f.plan,o));
 });
 test('calendar writer: refuses an unchecked calendar change when dependent runs already exist',async()=>{
  const f=await fixture(),o=await report(f.plan),run=randomUUID();
  await q('SET CONSTRAINTS public.v2_subject_subtype DEFERRED');await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'run')",[run]);
  await q('INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,25200)',[run,f.plan,f.pattern]);
  await q('SET CONSTRAINTS public.v2_subject_subtype IMMEDIATE');await invalid(()=>proposal(f.plan,o));
 });
 test('calendar writer: exact receipt replay creates one calendar and reversal restores the unknown state',async()=>{
  const f=await fixture(),o=await report(f.plan),p=await proposal(f.plan,o),r=await decide(p),key=randomUUID(),event=await apply(p,r,key);
  assert.equal(await apply(p,r,key),event);assert.equal((await q('SELECT count(*) n FROM v2_calendars WHERE id=$1',[o])).rows[0].n,'1');
  await decide(p,'reverse',r);assert.equal((await q('SELECT calendar_id FROM v2_service_plans WHERE subject_id=$1',[f.plan])).rows[0].calendar_id,null);
  assert.equal((await q('SELECT value FROM v2_observations WHERE id=$1',[o])).rows[0].value.timezone,'Africa/Harare');
  assert.notEqual((await read(f.plan)).status,'reviewed');
 });
 test('calendar writer: a changed calendar payload cannot remain an exact reviewed projection',async()=>{
  const f=await fixture(),o=await report(f.plan),p=await proposal(f.plan,o),r=await decide(p);await apply(p,r);
  await q('UPDATE v2_calendars SET weekdays=127 WHERE id=$1',[o]);assert.notEqual((await read(f.plan)).status,'reviewed');
 });
 test('calendar writer: commit checks runs introduced after the review and leaves the calendar unapplied',async()=>{
  const f=await fixture(),o=await report(f.plan),p=await proposal(f.plan,o),r=await decide(p),run=randomUUID();
  await q('SET CONSTRAINTS public.v2_subject_subtype DEFERRED');await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'run')",[run]);
  await q('INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,25200)',[run,f.plan,f.pattern]);
  await q('SET CONSTRAINTS public.v2_subject_subtype IMMEDIATE');await invalid(()=>apply(p,r),['23514','40001']);
  assert.equal((await q('SELECT calendar_id FROM v2_service_plans WHERE subject_id=$1',[f.plan])).rows[0].calendar_id,null);
  assert.equal((await q('SELECT count(*) n FROM v2_calendars WHERE id=$1',[o])).rows[0].n,'0');
 });
 test('calendar writer: evidence erasure removes reviewed access and redacts its copied snapshots',async()=>{
  const f=await fixture(),o=await report(f.plan),p=await proposal(f.plan,o),r=await decide(p);await apply(p,r);
  await q('DELETE FROM v2_observations WHERE id=$1',[o]);assert.notEqual((await read(f.plan)).status,'reviewed');
  const erased=(await q('SELECT erased,before_snapshot,after_snapshot FROM v2_transport_edits WHERE id=$1',[p])).rows[0];
  assert.equal(erased.erased,true);assert.equal(erased.before_snapshot,null);assert.equal(erased.after_snapshot,null);
 });
 test('calendar writer: raw writers stay denied to backend and public app roles',async()=>{
  const f=await fixture(),o=await report(f.plan);
  for(const role of ['mabhazi_api','anon','authenticated']){
   await q('SET LOCAL ROLE '+role);await invalid(()=>q('SELECT v2_edit_after($1,$2)',[f.plan,o]),['42501']);
   await invalid(()=>q('SELECT v2_write_edit_snapshot($1,$2,gen_random_uuid(),gen_random_uuid())',[f.plan,{}]),['42501']);await q('RESET ROLE');
  }
 });
}
