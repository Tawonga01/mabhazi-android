import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerStaffTimetableTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 const read=async(id:string)=>(await q('SELECT v2_read_created_subject($1) r',[id])).rows[0].r;
 const current=async(id:string)=>(await q('SELECT v2_current_reviewed_creation($1) r',[id])).rows[0].r;
 async function invalid(action:()=>Promise<unknown>,codes=['23514']){
  await q('SAVEPOINT invalid_staff_timetable');
  try{await assert.rejects(action,(e:unknown)=>{assert.ok(e instanceof Error&&'code'in e);assert.ok(codes.includes(String(e.code)),e.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_staff_timetable');await q('RELEASE SAVEPOINT invalid_staff_timetable');}
 }
 function proposal(){const c=context();return{version:1,operator:'Staff assembly fixture',originCityId:c.origin,destinationCityId:c.destination,
  pickup:'Known fixture boarding place',dropoff:null,timezone:'Africa/Harare',weekdays:[1,3,5],validFrom:'2026-11-14',validUntil:'2026-12-14',
  source:{kind:'published_timetable',reference:'Synthetic fixture only',checkedOn:'2026-11-14'},departures:[{departure:'07:00',arrival:null,arrivalDay:0,fare:null}]};}
 async function setup(){
  const c=context();await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture')",[c.other]);
  // Document publication date is genuinely unknown: do not copy check date.
  const source=(await q("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','Synthetic fixture only') RETURNING id",[c.other])).rows[0].id as string;
  return{actor:c.other,command:randomUUID(),source,proposal:proposal()};
 }
 type Setup=Awaited<ReturnType<typeof setup>>;
 async function source(s:Setup,operator:unknown={name:s.proposal.operator}){
  return(await q('SELECT v2_timetable_source($1,$2,$3,$4,$5) r',[s.actor,s.command,s.proposal,operator,s.source])).rows[0].r as {subjectId:string;contributionId:string};
 }
 async function report(s:Setup,subject:string,field:string,value:unknown,scope:unknown={},contribution:string|null=null){
  return(await q('SELECT v2_timetable_observation($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[s.actor,subject,s.command,s.source,field,value,scope,s.proposal,contribution])).rows[0].id as string;
 }
 const create=async(s:Setup,source:string,observation:string,kind:string,parent:string|null=null)=>(await q('SELECT v2_timetable_create($1,$2,$3,$4,$5) id',[s.actor,source,observation,kind,parent])).rows[0].id as string;
 async function service(){
  const s=await setup(),opSource=await source(s),opObservation=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[opSource.contributionId])).rows[0].id,
   operator=await create(s,opSource.subjectId,opObservation,'operator'),f=await source(s,{id:operator}),identity=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[f.contributionId])).rows[0].id,
   route=await create(s,f.subjectId,identity,'route'),pickupObservation=await report(s,f.subjectId,'boarding.pickup',{cityId:s.proposal.originCityId,name:s.proposal.pickup},{},f.contributionId),
   stop=await create(s,f.subjectId,pickupObservation,'stop'),patternObservation=await report(s,f.subjectId,'pattern.stops',{stops:[{place:{stopId:stop},pickup:'allowed',dropoff:'unknown'}],stopsComplete:false},{},f.contributionId),
   pattern=await create(s,f.subjectId,patternObservation,'pattern',route),modeObservation=await report(s,f.subjectId,'service.mode',{mode:'fixed_time'},{},f.contributionId),
   plan=await create(s,f.subjectId,modeObservation,'service_plan',pattern);
  const calendarObservation=await report(s,plan,'service.calendar',{weekdays:s.proposal.weekdays,startDate:s.proposal.validFrom,endDate:s.proposal.validUntil,timezone:s.proposal.timezone}),
   calendarReview=(await q('SELECT v2_timetable_edit($1,$2,$3) id',[s.actor,plan,calendarObservation])).rows[0].id as string;
  return{s,opSource,operator,f,route,stop,pattern,plan,calendarObservation,calendarReview};
 }
 type Service=Awaited<ReturnType<typeof service>>;
 async function run(f:Service,scope:unknown={schemaVersion:'1.0',timezone:'Africa/Harare',calendarId:f.calendarObservation,effectiveFrom:'2026-11-14',effectiveTo:'2026-12-14'}){
  const o=await report(f.s,f.f.subjectId,'departure.scheduled',{seconds:25200},scope,f.f.contributionId);
  return{observation:o,id:await create(f.s,f.f.subjectId,o,'run',f.plan)};
 }
 test('staff timetable: source records remain private and carry explicit planned meaning and one shared source',async()=>{
  const s=await setup(),a=await source(s),b=await source(s);
  assert.equal((await q('SELECT intake_kind FROM v2_leads WHERE subject_id=$1',[a.subjectId])).rows[0].intake_kind,'staff');
  for(const view of ['v2_public_lead_reports','v2_public_reviewed_lead_reports'])assert.equal((await q('SELECT count(*) n FROM '+view+' WHERE subject_id=ANY($1::uuid[])',[[a.subjectId,b.subjectId]])).rows[0].n,'0');
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE kind='normalise' AND subject_id=ANY($1::uuid[])",[[a.subjectId,b.subjectId]])).rows[0].n,'0');
  const observations=(await q('SELECT o.*,os.source_id FROM v2_observations o JOIN v2_observation_sources os ON os.observation_id=o.id WHERE o.original_subject_id=ANY($1::uuid[])',[[a.subjectId,b.subjectId]])).rows;
  assert.equal(observations.length,4);assert.ok(observations.every(o=>o.source_id===s.source&&o.knowledge_basis==='observed_sign'));
  assert.ok(observations.filter(o=>o.field_key==='departure.reported').every(o=>o.value.basis==='scheduled'));
  assert.equal((await q('SELECT source_date FROM v2_sources WHERE id=$1',[s.source])).rows[0].source_date,null);
 });
 test('staff timetable: only named administrators can assemble sources and another account cannot supply the source',async()=>{
  const s=await setup();await invalid(()=>q('SELECT v2_timetable_source($1,$2,$3,$4,$5)',[context().user,s.command,s.proposal,{name:'Fixture'},s.source]),['42501']);
  const otherSource=(await q("INSERT INTO v2_sources(owner_user_id,kind) VALUES($1,'document') RETURNING id",[context().user])).rows[0].id;
  await invalid(()=>q('SELECT v2_timetable_source($1,$2,$3,$4,$5)',[s.actor,s.command,s.proposal,{name:'Fixture'},otherSource]));
 });
 test('staff timetable: current calendar proof permits an exact native run without changing strict origin history',async()=>{
  const f=await service();assert.equal((await read(f.plan)).status,'stale');assert.equal(await current(f.plan),true);
  const r=await run(f),result=await read(r.id);assert.equal(result.status,'reviewed_origin');assert.equal(result.snapshot.data.service_plan_subject_id,f.plan);
  assert.equal(result.snapshot.data.departure_seconds,25200);assert.equal(result.snapshot.data.arrival_seconds,null);
  assert.equal((await q('SELECT stops_complete FROM v2_pattern_versions WHERE pattern_subject_id=$1',[f.pattern])).rows[0].stops_complete,false);
  assert.equal((await q('SELECT count(*) n FROM v2_pattern_stops WHERE pattern_subject_id=$1',[f.pattern])).rows[0].n,'1');
  assert.equal((await q('SELECT affiliation_status FROM v2_operators WHERE subject_id=$1',[f.operator])).rows[0].affiliation_status,'unverified');
 });
 test('staff timetable: a timezone or calendar mismatch cannot inherit the reviewed parent',async()=>{
  const f=await service();await invalid(()=>run(f,{schemaVersion:'1.0',timezone:'Europe/Berlin',effectiveFrom:'2026-11-14',effectiveTo:'2026-12-14'}));
  const unrelated=(await q("INSERT INTO v2_calendars(timezone,coverage,weekdays) VALUES('Africa/Harare','recurring',127) RETURNING id")).rows[0].id;
  await invalid(()=>run(f,{schemaVersion:'1.0',timezone:'Africa/Harare',calendarId:unrelated,effectiveFrom:'2026-11-14',effectiveTo:'2026-12-14'}));
 });
 test('staff timetable: raw unreviewed or changed parent cannot be upgraded to reviewed by the helper',async()=>{
  const f=await service();await q("UPDATE v2_service_plans SET boarding_instructions='Unreviewed physical change' WHERE subject_id=$1",[f.plan]);
  assert.equal(await current(f.plan),false);await invalid(()=>run(f));
 });
 test('staff timetable: withdrawing calendar evidence makes created descendant proof stale immediately',async()=>{
  const f=await service(),r=await run(f);
  await q('DELETE FROM v2_observations WHERE id=$1',[f.calendarObservation]);assert.equal(await current(f.plan),false);assert.equal((await read(r.id)).status,'stale');
 });
 test('staff timetable: erasing the original operator proof invalidates the calendar-edited plan and its run',async()=>{
  const f=await service(),r=await run(f);await q("DELETE FROM v2_observations WHERE original_subject_id=$1 AND field_key='operator.reported'",[f.opSource.subjectId]);
  assert.equal(await current(f.plan),false);assert.equal((await read(r.id)).status,'stale');
 });
 test('staff timetable: private constructors and reviewed-parent helper stay denied to backend and public roles',async()=>{
  const s=await setup();
  for(const role of ['mabhazi_api','anon','authenticated']){
   await q('SET LOCAL ROLE '+role);
   await invalid(()=>q('SELECT v2_timetable_source($1,$2,$3,$4,$5)',[s.actor,s.command,s.proposal,{name:'Fixture'},s.source]),['42501']);
   await invalid(()=>q('SELECT v2_current_reviewed_creation(gen_random_uuid())'),['42501']);await q('RESET ROLE');
  }
 });
}
