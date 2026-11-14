import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerTimetableCommandTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 async function invalid(action:()=>Promise<unknown>,codes=['23514']){
  await q('SAVEPOINT invalid_timetable_command');
  try{await assert.rejects(action,(e:unknown)=>{assert.ok(e instanceof Error&&'code'in e);assert.ok(codes.includes(String(e.code)),e.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_timetable_command');await q('RELEASE SAVEPOINT invalid_timetable_command');}
 }
 async function setup(){
  const c=context();await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture')",[c.other]);
  const day=(await q("SELECT (statement_timestamp() AT TIME ZONE 'Africa/Harare')::date::text AS checked_date")).rows[0].checked_date as string;
  return{actor:c.other,request:randomUUID(),p:{version:1,operator:'Command fixture '+randomUUID().slice(0,8),operatorRef:null as null|{id:string;revision:string},separateOperator:false,
   originCityId:c.origin,destinationCityId:c.destination,pickup:'Known command fixture boarding',dropoff:null as string|null,timezone:'Africa/Harare',weekdays:[1,3,5],
   validFrom:day,validUntil:day.slice(0,4)+'-12-31',source:{kind:'published_timetable',reference:'Synthetic test source only',checkedOn:day},
   departures:[{departure:'07:00',arrival:null as string|null,arrivalDay:0,fare:null as null|{amount:string;currency:string;kind:string}}]}};
 }
 type Fixture=Awaited<ReturnType<typeof setup>>;
 async function preview(f:Fixture){return(await q('SELECT v2_api_admin_timetable_preview($1,$2) r',[f.actor,f.p])).rows[0].r;}
 async function input(f:Fixture){const p=await preview(f);return{proposal:f.p,stateDigest:p.stateDigest,expiresAt:Date.now()+300000};}
 const apply=async(f:Fixture,b:unknown)=>(await q('SELECT v2_api_admin_timetable_action($1,$2,$3) r',[f.actor,f.request,b])).rows[0].r;
 async function saved(f:Fixture){return await apply(f,await input(f));}
 test('timetable command: all supplied departures assemble atomically with distinct source identities and independent reviews',async()=>{
  const f=await setup();f.p.departures.push({...f.p.departures[0],departure:'12:00'});const receipt=await saved(f);
  assert.equal(receipt.id,f.request);assert.equal(receipt.outcome,'approved');assert.equal(receipt.departureCount,2);
  const entries=(await q(`SELECT e.*,r.departure_seconds,r.arrival_seconds,l.intake_kind,l.reported_departure_seconds,c.payload
   FROM v2_admin_timetable_entries e JOIN v2_runs r ON r.subject_id=e.run_subject_id JOIN v2_leads l ON l.subject_id=e.source_subject_id
   JOIN v2_contributions c ON c.id=l.initial_contribution_id WHERE e.timetable_id=$1 ORDER BY e.ordinal`,[f.request])).rows;
  assert.equal(entries.length,2);assert.notEqual(entries[0].source_subject_id,entries[1].source_subject_id);
  assert.deepEqual(entries.map(e=>e.departure_seconds),[25200,43200]);
  assert.ok(entries.every(e=>e.arrival_seconds===null&&e.intake_kind==='staff'&&e.reported_departure_seconds===e.departure_seconds));
  assert.deepEqual(entries.map(e=>e.payload.target.newLead.departureTime),['07:00','12:00']);
  for(const e of receipt.entries){const properties=e.properties as Array<{field:string;reviewId:string}>;
   assert.equal(properties.length,8);assert.equal(new Set(properties.map(p=>p.reviewId)).size,8);
   assert.ok(!properties.some(p=>p.field.startsWith('fare.')||p.field==='arrival.scheduled'||p.field==='alighting.dropoff'));}
  assert.equal((await q('SELECT count(DISTINCT os.source_id) n FROM v2_observation_sources os JOIN v2_observations o ON o.id=os.observation_id JOIN v2_contributions c ON c.id=o.contribution_id WHERE c.payload->>\'timetableCommandId\'=$1',[f.request])).rows[0].n,'1');
 });
 test('timetable command: optional arrival retains explicit next-day seconds; free advertised fare has no invented conditions or validity',async()=>{
  const f=await setup();f.p.departures=[{departure:'23:30',arrival:'01:15',arrivalDay:1,fare:{amount:'0',currency:'USD',kind:'advertised'}}];f.p.dropoff='Known arrival place';
  const r=await saved(f),run=r.entries[0].runId;
  assert.equal((await q('SELECT arrival_seconds FROM v2_runs WHERE subject_id=$1',[run])).rows[0].arrival_seconds,90900);
  const fare=(await q("SELECT o.* FROM v2_admin_timetable_properties p JOIN v2_observations o ON o.id=p.observation_id WHERE p.run_subject_id=$1 AND p.field_key='fare.advertised'",[run])).rows[0];
  assert.deepEqual(fare.value,{amount:'0',currency:'USD'});assert.equal(fare.scope.passengerCategory,'unknown');assert.equal(fare.scope.ticketBasis,'unknown');
  assert.equal(fare.scope.timeBasis,'scheduled');assert.equal(fare.effective_from,null);assert.equal(fare.effective_to,null);
  assert.ok(!('sourceDate'in fare.scope)&&!('serviceDate'in fare.scope)&&!('quotationDate'in fare.scope));
  assert.deepEqual(fare.scope.segment,{kind:'city_pair',originCityId:f.p.originCityId,destinationCityId:f.p.destinationCityId});
 });
 test('timetable command: future literal timetables can be reviewed without pretending they operate today',async()=>{
  const f=await setup();const year=Number(f.p.validFrom.slice(0,4))+1;f.p.validFrom=year+'-01-01';f.p.validUntil=year+'-02-01';
  const r=await saved(f);assert.equal(r.departureCount,1);
  const row=(await q(`SELECT cal.start_date::text start_date,cal.end_date::text end_date,cal.weekdays,sp.timezone
   FROM v2_admin_timetable_entries e JOIN v2_runs r ON r.subject_id=e.run_subject_id JOIN v2_service_plans sp ON sp.subject_id=r.service_plan_subject_id
   JOIN v2_calendars cal ON cal.id=sp.calendar_id WHERE e.timetable_id=$1`,[f.request])).rows[0];
  assert.equal(row.start_date,f.p.validFrom);assert.equal(row.end_date,f.p.validUntil);assert.equal(row.weekdays,21);assert.equal(row.timezone,'Africa/Harare');
 });
 test('timetable command: exact replay returns original receipt after expiry with no duplicate native entities',async()=>{
  const f=await setup(),b=await input(f),first=await apply(f,b),count=(await q('SELECT count(*) n FROM v2_subjects')).rows[0].n;
  assert.deepEqual(await apply(f,{...b,expiresAt:1}),first);assert.equal((await q('SELECT count(*) n FROM v2_subjects')).rows[0].n,count);
  await invalid(()=>apply(f,{...b,proposal:{...f.p,pickup:'Changed'}}));
 });
 test('timetable command: an expired new request cannot start a write',async()=>{
  const f=await setup(),b=await input(f);await invalid(()=>apply(f,{...b,expiresAt:1}));
  assert.equal((await q('SELECT count(*) n FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0].n,'0');
 });
 test('timetable command: changed city state and overlapping timetable invalidate the preview',async()=>{
  const f=await setup(),b=await input(f);await q('UPDATE cities SET name=$2 WHERE id=$1',[f.p.originCityId,'Changed origin']);
  await invalid(()=>apply(f,b),['40001']);await saved(f);
  const next={...f,request:randomUUID()},p=await preview(next);assert.ok(p.duplicates.some((d:{kind:string})=>d.kind==='timetable'));
  await invalid(()=>apply(next,awaitInput(p,next)),['40001']);
  function awaitInput(state:{stateDigest:string},fixture:Fixture){return{proposal:fixture.p,stateDigest:state.stateDigest,expiresAt:Date.now()+300000};}
 });
 test('timetable command: existing operator reuse requires exact explicit identity and revision',async()=>{
  const f=await setup();await saved(f);
  const choices=(await q('SELECT v2_api_admin_timetable_operators($1,$2) r',[f.actor,f.p.operator])).rows[0].r as Array<{id:string;revision:string}>;
  assert.equal(choices.length,1);f.request=randomUUID();f.p.validFrom=(Number(f.p.validFrom.slice(0,4))+1)+'-01-01';f.p.validUntil=f.p.validFrom.slice(0,4)+'-12-31';
  assert.ok((await preview(f)).duplicates.some((d:{kind:string})=>d.kind==='operator'));
  f.p.operatorRef=choices[0];assert.equal((await preview(f)).duplicates.length,0);await saved(f);
  assert.equal((await q('SELECT count(*) n FROM v2_operators WHERE display_name=$1',[f.p.operator])).rows[0].n,'1');
  f.p.operatorRef={...choices[0],revision:String(Number(choices[0].revision)+1)};await invalid(()=>preview(f),['40001']);
 });
 test('timetable command: ordinary app accounts and revoked owners cannot preview, apply or recover private receipts',async()=>{
  const f=await setup(),b=await input(f);for(const actor of [context().user]){
   await invalid(()=>q('SELECT v2_api_admin_timetable_preview($1,$2)',[actor,f.p]),['42501']);
   await invalid(()=>q('SELECT v2_api_admin_timetable_action($1,$2,$3)',[actor,f.request,b]),['42501']);
   await invalid(()=>q('SELECT v2_api_admin_timetable_receipt($1,$2)',[actor,f.request]),['42501']);}
  await saved(f);await q('UPDATE v2_review_roles SET revoked_at=now() WHERE user_id=$1',[f.actor]);await invalid(()=>apply(f,b),['42501']);
 });
 test('timetable command: outer rollback removes the entire command and all transport components',async()=>{
  const f=await setup(),before=(await q('SELECT count(*) n FROM v2_subjects')).rows[0].n;await q('SAVEPOINT rollback_timetable');await saved(f);
  await q('ROLLBACK TO SAVEPOINT rollback_timetable');await q('RELEASE SAVEPOINT rollback_timetable');
  assert.equal((await q('SELECT count(*) n FROM v2_subjects')).rows[0].n,before);assert.equal((await q('SELECT v2_api_admin_timetable_receipt($1,$2) r',[f.actor,f.request])).rows[0].r.found,false);
 });
 test('timetable command: staff scaffolds and private source references stay absent from public and traveller discovery',async()=>{
  const f=await setup();await saved(f);
  const ids=(await q("SELECT original_subject_id FROM v2_contributions WHERE payload->>'timetableCommandId'=$1",[f.request])).rows.map(r=>r.original_subject_id);
  for(const view of ['v2_public_lead_reports','v2_public_reviewed_lead_reports'])assert.equal((await q('SELECT count(*) n FROM '+view+' WHERE subject_id=ANY($1::uuid[])',[ids])).rows[0].n,'0');
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE kind='normalise' AND subject_id=ANY($1::uuid[])",[ids])).rows[0].n,'0');
 });
 test('timetable command: source erasure leaves a value-free audit receipt and cannot be undone through replay',async()=>{
  const f=await setup(),b=await input(f),r=await apply(f,b),first=r.entries[0];
  const property=(await q("SELECT contribution_id FROM v2_admin_timetable_properties WHERE run_subject_id=$1 AND field_key='boarding.pickup'",[first.runId])).rows[0];
  await q('DELETE FROM v2_contributions WHERE id=$1',[property.contribution_id]);
  const receipt=(await q('SELECT v2_api_admin_timetable_receipt($1,$2) r',[f.actor,f.request])).rows[0].r;
  assert.ok(receipt.entries[0].properties.some((p:{sourceErased:boolean})=>p.sourceErased));
  assert.deepEqual(await apply(f,b),receipt);
 });
 test('timetable command: raw backend and public roles cannot invoke private importers or read command proposals',async()=>{
  const f=await setup(),b=await input(f);for(const role of ['mabhazi_api','anon','authenticated']){
   await q('SET LOCAL ROLE '+role);await invalid(()=>q('SELECT v2_api_admin_timetable_action($1,$2,$3)',[f.actor,f.request,b]),['42501']);
   await invalid(()=>q('SELECT * FROM v2_admin_timetables'),['42501']);await q('RESET ROLE');}
 });
}
