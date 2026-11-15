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
 async function diagnosis(run:string){return(await q(`SELECT jsonb_agg(jsonb_build_object('subject',s.id,'kind',s.kind,'current',v2_current_reviewed_creation(s.id),
  'strict',v2_read_created_subject(s.id),'edit',v2_read_transport(s.id),'origin',to_jsonb(o),'creationEvidence',v2_creation_evidence_live(o.creation_id),
  'dependenciesLive',v2_creation_dependencies_live(o.creation_id),
  'dependencies',(SELECT jsonb_agg(jsonb_build_object('expected',to_jsonb(d),'liveRevision',a.revision,'liveGeneration',a.input_generation,'current',v2_current_reviewed_creation(a.id))) FROM v2_transport_creation_dependencies d JOIN v2_subjects a ON a.id=d.subject_id WHERE d.creation_id=o.creation_id),
  'changes',(SELECT jsonb_agg(jsonb_build_object('table',c.source_table,'columns',c.changed_columns,'change',c.id,'epochs',to_jsonb(cs))) FROM v2_transport_change_subjects cs JOIN v2_transport_changes c ON c.id=cs.change_id WHERE cs.subject_id=s.id))) r
  FROM v2_subjects s JOIN v2_transport_creation_origins o ON o.subject_id=s.id
  WHERE s.id=$1 OR s.id=(SELECT service_plan_subject_id FROM v2_runs WHERE subject_id=$1)`,[run])).rows[0].r;}

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
  f.p.operatorRef={id:choices[0].id,revision:choices[0].revision};assert.equal((await preview(f)).duplicates.length,0);await saved(f);
  assert.equal((await q('SELECT count(*) n FROM v2_operators WHERE display_name=$1',[f.p.operator])).rows[0].n,'1');
  f.p.operatorRef={id:choices[0].id,revision:String(Number(choices[0].revision)+1)};await invalid(()=>preview(f),['40001']);
 });
 test('timetable command: ordinary app accounts and revoked owners cannot preview, apply or recover private receipts',async()=>{
  const f=await setup(),b=await input(f);for(const actor of [context().user]){
   await invalid(()=>q('SELECT v2_api_admin_timetable_preview($1,$2)',[actor,f.p]),['42501']);
   await invalid(()=>q('SELECT v2_api_admin_timetable_action($1,$2,$3)',[actor,f.request,b]),['42501']);
   await invalid(()=>q('SELECT v2_api_admin_timetable_receipt($1,$2)',[actor,f.request]),['42501']);}
  await saved(f);await q('UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=user_id WHERE user_id=$1',[f.actor]);await invalid(()=>apply(f,b),['42501']);
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
  assert.equal(receipt.sourceErased,true);await invalid(()=>apply(f,b));
  const command=(await q('SELECT proposal,request_digest,erased FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0];
  assert.equal(command.proposal,null);assert.equal(command.request_digest,null);assert.equal(command.erased,true);
 });
 test('timetable command: all exact property proofs are current after optional arrival and fare assembly',async()=>{
  const f=await setup();f.p.departures[0].arrival='10:00';f.p.departures[0].fare={amount:'18',currency:'USD',kind:'quoted'};
  const r=await saved(f),run=r.entries[0].runId;
  assert.equal((await q('SELECT v2_read_created_subject($1) r',[run])).rows[0].r.status,'stale');
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,true,JSON.stringify(await diagnosis(run)));
  const proofs=(await q('SELECT field_key,v2_timetable_property_current(run_subject_id,field_key) current FROM v2_admin_timetable_properties WHERE run_subject_id=$1',[run])).rows;
  assert.equal(proofs.length,10);assert.ok(proofs.every(p=>p.current),JSON.stringify(proofs));
 });
 test('timetable command: an unreviewed run change cannot inherit the arrival review',async()=>{
  const f=await setup();f.p.departures[0].arrival='10:00';const r=await saved(f),run=r.entries[0].runId;
  await q('UPDATE v2_runs SET departure_seconds=departure_seconds+60 WHERE subject_id=$1',[run]);
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,false);
  assert.equal((await q("SELECT v2_timetable_property_current($1,'arrival.scheduled') r",[run])).rows[0].r,false);
 });
 test('timetable command: reversing only a fare keeps the independent boarding and schedule approvals',async()=>{
  const f=await setup();f.p.departures[0].fare={amount:'18',currency:'USD',kind:'quoted'};const r=await saved(f),run=r.entries[0].runId;
  const p=(await q("SELECT p.*,c.revision case_revision,s.revision subject_revision FROM v2_admin_timetable_properties p JOIN v2_review_decisions d ON d.id=p.review_id JOIN v2_review_cases c ON c.id=d.case_id JOIN v2_subjects s ON s.id=p.subject_id WHERE run_subject_id=$1 AND p.field_key='fare.quoted'",[run])).rows[0];
  await q('SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision DEFERRED');
  await q("SELECT v2_record_review($1,$2,$3,$4,'reverse','decision_incorrect',NULL,ARRAY[]::uuid[],'timetable-import/1',$5)",[f.actor,p.writer_id,p.case_revision,p.subject_revision,p.review_id]);
  await q('SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision IMMEDIATE');
  assert.equal((await q("SELECT v2_timetable_property_current($1,'fare.quoted') r",[run])).rows[0].r,false);
  assert.equal((await q("SELECT v2_timetable_property_current($1,'boarding.pickup') r",[run])).rows[0].r,true);
  assert.equal((await q("SELECT v2_timetable_property_current($1,'departure.scheduled') r",[run])).rows[0].r,true,JSON.stringify(await diagnosis(run)));
 });
 test('timetable command: account erasure scrubs proposal copies and leaves no reviewed transport proof',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId;await q('DELETE FROM users WHERE id=$1',[f.actor]);
  const command=(await q('SELECT actor_user_id,proposal,request_digest,erased FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0];
  assert.equal(command.actor_user_id,null);assert.equal(command.proposal,null);assert.equal(command.request_digest,null);assert.equal(command.erased,true);
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,false);
  assert.equal((await q("SELECT v2_timetable_property_current($1,'boarding.pickup') r",[run])).rows[0].r,false);
 });
 test('timetable command: malformed days and paid fare cannot enter the privileged writer',async()=>{
  const f=await setup();assert.equal((await q('SELECT v2_timetable_proposal_valid($1) r',[{...f.p,weekdays:null}])).rows[0].r,false);
  assert.equal((await q('SELECT v2_timetable_proposal_valid($1) r',[{...f.p,departures:[{...f.p.departures[0],fare:{amount:'12',currency:'USD',kind:'paid'}}]}])).rows[0].r,false);
  await invalid(()=>q('SELECT v2_api_admin_timetable_preview($1,$2)',[f.actor,{...f.p,weekdays:[]}]));
 });
 test('timetable command: an extra citation to the same document preserves unchanged parent epochs and native proof',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId;
  const parent=(await q('SELECT service_plan_subject_id FROM v2_runs WHERE subject_id=$1',[run])).rows[0].service_plan_subject_id;
  const before=(await q('SELECT revision,input_generation FROM v2_subjects WHERE id=$1',[parent])).rows[0];
  const source=(await q("SELECT os.source_id FROM v2_admin_timetable_properties p JOIN v2_observation_sources os ON os.observation_id=p.observation_id WHERE p.run_subject_id=$1 AND p.field_key='departure.scheduled'",[run])).rows[0].source_id;
  const graph=(await q('SELECT revision FROM v2_source_graph WHERE id')).rows[0].revision;
  const extra=(await q('SELECT v2_timetable_source($1,$2,$3,$4,$5) r',[f.actor,randomUUID(),f.p,{name:f.p.operator},source])).rows[0].r;
  assert.deepEqual((await q('SELECT revision,input_generation FROM v2_subjects WHERE id=$1',[parent])).rows[0],before);
  assert.ok(BigInt((await q('SELECT revision FROM v2_source_graph WHERE id')).rows[0].revision)>BigInt(graph));
  assert.ok(BigInt((await q('SELECT input_generation FROM v2_subjects WHERE id=$1',[extra.subjectId])).rows[0].input_generation)>1n);
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,true);
 });
 test('timetable command: source-only erasure redacts copied proposal and invalidates all dependent timetable proof',async()=>{
  const f=await setup(),b=await input(f),r=await apply(f,b),run=r.entries[0].runId;
  const source=(await q("SELECT os.source_id FROM v2_admin_timetable_properties p JOIN v2_observation_sources os ON os.observation_id=p.observation_id WHERE p.run_subject_id=$1 AND p.field_key='departure.scheduled'",[run])).rows[0].source_id;
  await q('DELETE FROM v2_sources WHERE id=$1',[source]);
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,false);
  assert.equal((await q('SELECT proposal FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0].proposal,null);
  assert.equal((await q("SELECT v2_timetable_property_current($1,'boarding.pickup') r",[run])).rows[0].r,false);
  await invalid(()=>apply(f,b));
 });
 const discovery=async(subject:string,at:string|null=null)=>(await q(at?'SELECT v2_timetable_discovery($1,$2::timestamptz) r':'SELECT v2_timetable_discovery($1) r',at?[subject,at]:[subject])).rows[0].r;
 const alias=async(run:string)=>(await q('SELECT source_subject_id FROM v2_admin_timetable_entries WHERE run_subject_id=$1',[run])).rows[0].source_subject_id as string;
 async function reverseProperty(f:Fixture,run:string,field:string){
  const p=(await q('SELECT p.*,c.revision case_revision,s.revision subject_revision FROM v2_admin_timetable_properties p JOIN v2_review_cases c ON c.id=p.writer_id JOIN v2_subjects s ON s.id=p.subject_id WHERE p.run_subject_id=$1 AND p.field_key=$2',[run,field])).rows[0];
  await q('SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision DEFERRED');
  await q("SELECT v2_record_review($1,$2,$3,$4,'reverse','decision_incorrect',NULL,ARRAY[]::uuid[],'timetable-import/1',$5)",[f.actor,p.writer_id,p.case_revision,p.subject_revision,p.review_id]);
  await q('SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision IMMEDIATE');
 }
 async function visibility(f:Fixture,subject:string,operation='remove',removalId:string|null=null){
  const revision=(await q('SELECT revision::text r FROM v2_subjects WHERE id=$1',[subject])).rows[0].r;
  return(await q('SELECT v2_api_admin_route_action($1,$2,$3) r',[f.actor,randomUUID(),{routeId:subject,revision,operation,reason:operation==='remove'?'inaccurate':'record_rechecked',removalId,expiresAt:Date.now()+300000}])).rows[0].r;
 }
 test('timetable discovery: only a registered real source lead exposes reviewed native context and genuine unknowns',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId,subject=await alias(run),d=await discovery(subject);
  assert.ok(d);assert.equal(d.subjectId,subject);assert.equal(d.runId,run);assert.equal(d.provenance,'reviewed_timetable');
  assert.equal(d.origin.id,f.p.originCityId);assert.equal(d.destination.id,f.p.destinationCityId);assert.equal(d.operator.name,f.p.operator);
  assert.equal(d.departureSeconds,25200);assert.equal(d.arrivalSeconds,null);assert.equal(d.dropoff,null);assert.equal(d.pickup.name,f.p.pickup);
  assert.equal(d.calendar.weekdays,21);assert.equal(d.calendar.timezone,'Africa/Harare');assert.ok(!d.approvedFacts.some((p:{field:string})=>p.field.startsWith('fare.')));
  assert.ok(!JSON.stringify(d).includes(f.p.source.reference));assert.ok(!JSON.stringify(d).includes(f.actor));assert.equal(await discovery(run),null);
 });
 test('timetable discovery: reviewed overnight arrival and zero advertised fare retain actual scope and observation date',async()=>{
  const f=await setup();f.p.departures=[{departure:'23:30',arrival:'01:15',arrivalDay:1,fare:{amount:'0',currency:'USD',kind:'advertised'}}];
  const r=await saved(f),d=await discovery(await alias(r.entries[0].runId));assert.ok(d);assert.equal(d.arrivalSeconds,90900);
  const fare=d.approvedFacts.find((p:{field:string})=>p.field==='fare.advertised');assert.deepEqual(fare.value,{amount:'0',currency:'USD'});
  assert.equal(fare.scope.passengerCategory,'unknown');assert.equal(fare.scope.ticketBasis,'unknown');assert.equal(fare.observedDate,f.p.source.checkedOn);
 });
 test('timetable discovery: a future window stays unavailable today and expires at its actual local end',async()=>{
  const f=await setup(),dates=(await q('SELECT ($1::date+2)::text start,($1::date+5)::text finish',[f.p.validFrom])).rows[0];f.p.validFrom=dates.start;f.p.validUntil=dates.finish;
  const r=await saved(f),subject=await alias(r.entries[0].runId);assert.equal(await discovery(subject),null);
  assert.ok(await discovery(subject,f.p.validFrom+'T12:00:00+02:00'));
  const after=(await q('SELECT ($1::date+1)::text d',[f.p.validUntil])).rows[0].d;assert.equal(await discovery(subject,after+'T00:00:00+02:00'),null);
 });
 test('timetable discovery: critical schedule follows existing evidence-policy recheck boundary rather than approval time',async()=>{
  const f=await setup(),h=(await q('SELECT p.schedule_days FROM v2_evidence_policy_state s JOIN v2_evidence_policies p ON p.version=s.version WHERE s.id')).rows[0].schedule_days;
  f.p.validUntil=(await q('SELECT ($1::date+$2::integer+3)::text d',[f.p.validFrom,h])).rows[0].d;
  const r=await saved(f),subject=await alias(r.entries[0].runId),times=(await q("SELECT (v2_assessment_day_end($1::date,$2::integer,'Africa/Harare')-interval '1 millisecond')::text before,v2_assessment_day_end($1::date,$2::integer,'Africa/Harare')::text due",[f.p.source.checkedOn,h])).rows[0];
  assert.ok(await discovery(subject,times.before));assert.equal(await discovery(subject,times.due),null);
 });
 test('timetable discovery: a fare-only reversal removes its card fact while preserving the exact boarding and clock',async()=>{
  const f=await setup();f.p.departures[0].fare={amount:'18',currency:'USD',kind:'quoted'};const r=await saved(f),run=r.entries[0].runId,subject=await alias(run);
  assert.ok((await discovery(subject)).approvedFacts.some((p:{field:string})=>p.field==='fare.quoted'));
  await reverseProperty(f,run,'fare.quoted');const d=await discovery(subject);assert.ok(d);assert.equal(d.departureSeconds,25200);assert.equal(d.pickup.name,f.p.pickup);
  assert.ok(!d.approvedFacts.some((p:{field:string})=>p.field==='fare.quoted'));
 });
 test('timetable discovery: withdrawing required boarding evidence suppresses the unsafe timed record',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId,subject=await alias(run);assert.ok(await discovery(subject));
  await reverseProperty(f,run,'boarding.pickup');assert.equal(await discovery(subject),null);
 });
 test('timetable discovery: removal and restore preserve originals and re-evaluate real eligibility',async()=>{
  const f=await setup(),r=await saved(f),subject=await alias(r.entries[0].runId),original=(await q('SELECT proposal FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0].proposal;
  const removed=await visibility(f,subject);assert.equal(removed.outcome,'removed');assert.equal(await discovery(subject),null);
  assert.equal((await visibility(f,subject,'restore',removed.id)).outcome,'restored');
  const present=await discovery(subject);if(!present){const diag=(await q("SELECT jsonb_build_object('command',(SELECT to_jsonb(t)-'proposal' FROM v2_admin_timetables t WHERE id=$1),'lead',(SELECT to_jsonb(l) FROM v2_leads l WHERE subject_id=$2),'removals',(SELECT jsonb_agg(to_jsonb(a)) FROM v2_admin_active_route_removals a WHERE route_subject_id=$2),'properties',(SELECT jsonb_agg(jsonb_build_array(field_key,v2_timetable_property_current(run_subject_id,field_key))) FROM v2_admin_timetable_properties WHERE run_subject_id=$3)) r",[f.request,subject,r.entries[0].runId])).rows[0].r;assert.ok(present,JSON.stringify({state:diag,native:await diagnosis(r.entries[0].runId)}));}
  assert.deepEqual((await q('SELECT proposal FROM v2_admin_timetables WHERE id=$1',[f.request])).rows[0].proposal,original);
 });
 test('timetable discovery: native structural changes advance the real source alias revision and keep a bounded provenance cycle',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId,subject=await alias(run),before=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[subject])).rows[0].revision;
  const dependent=(await q('SELECT v2_transport_dependents(ARRAY[$1::uuid]) ids',[run])).rows[0].ids as string[];
  assert.deepEqual(new Set(dependent),new Set([run,subject]));
  await q('UPDATE v2_runs SET departure_seconds=departure_seconds+60 WHERE subject_id=$1',[run]);
  assert.ok(BigInt((await q('SELECT revision FROM v2_subjects WHERE id=$1',[subject])).rows[0].revision)>BigInt(before));assert.equal(await discovery(subject),null);
 });
 test('timetable discovery: restore never revives a genuinely changed native schedule',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId,subject=await alias(run),removed=await visibility(f,subject);
  await q('UPDATE v2_runs SET departure_seconds=departure_seconds+60 WHERE subject_id=$1',[run]);
  assert.equal((await visibility(f,subject,'restore',removed.id)).outcome,'restored');assert.equal(await discovery(subject),null);
  assert.equal((await q('SELECT v2_current_reviewed_creation($1) r',[run])).rows[0].r,false);
 });
 test('timetable discovery: restoring an administrator removal cannot clear an independent safety hide',async()=>{
  const f=await setup(),r=await saved(f),subject=await alias(r.entries[0].runId),removed=await visibility(f,subject);
  const report=(await q("INSERT INTO abuse_reports(reporter_id,target_type,target_id,reason) VALUES($1,'transport_subject',$2,'unsafe') RETURNING id",[context().user,subject])).rows[0].id;
  await q('INSERT INTO v2_public_lead_hides(subject_id,report_id) VALUES($1,$2)',[subject,report]);
  assert.equal((await visibility(f,subject,'restore',removed.id)).outcome,'restored');assert.equal(await discovery(subject),null);
 });
 test('timetable discovery: current critical conflicts suppress output without manufacturing a selected timetable',async()=>{
  const f=await setup(),r=await saved(f),run=r.entries[0].runId,subject=await alias(run);
  const scope=(await q("SELECT o.scope_key FROM v2_admin_timetable_properties p JOIN v2_observations o ON o.id=p.observation_id WHERE p.run_subject_id=$1 AND p.field_key='departure.scheduled'",[run])).rows[0].scope_key;
  await q("SELECT v2_open_review_case($1,$2,'conflict','departure.scheduled',$3)",[f.actor,subject,scope]);assert.equal(await discovery(subject),null);
 });
 test('timetable discovery: changing the presentation core cannot display an old native schedule under a new route',async()=>{
  const f=await setup(),r=await saved(f),subject=await alias(r.entries[0].runId);await q('UPDATE v2_leads SET reported_departure_seconds=reported_departure_seconds+60 WHERE subject_id=$1',[subject]);
  assert.equal(await discovery(subject),null);
 });
 test('timetable discovery: raw roles cannot call the private projection or remove an unregistered staff scaffold',async()=>{
  const f=await setup(),r=await saved(f),subject=await alias(r.entries[0].runId);
  const scaffold=(await q("SELECT original_subject_id FROM v2_contributions WHERE payload->>'timetableCommandId'=$1 AND original_subject_id<>$2 AND original_subject_id IN(SELECT subject_id FROM v2_leads) LIMIT 1",[f.request,subject])).rows[0].original_subject_id;
  assert.equal(await discovery(scaffold),null);assert.equal((await visibility(f,scaffold)).outcome,'unavailable');
  for(const role of ['mabhazi_api','anon','authenticated']){await q('SET LOCAL ROLE '+role);await invalid(()=>q('SELECT v2_timetable_discovery($1)',[subject]),['42501']);await q('RESET ROLE');}
 });
 test('timetable command: raw backend and public roles cannot invoke private importers or read command proposals',async()=>{
  const f=await setup(),b=await input(f);for(const role of ['mabhazi_api','anon','authenticated']){
   await q('SET LOCAL ROLE '+role);await invalid(()=>q('SELECT v2_api_admin_timetable_action($1,$2,$3)',[f.actor,f.request,b]),['42501']);
   await invalid(()=>q('SELECT * FROM v2_admin_timetables'),['42501']);await q('RESET ROLE');}
 });
}
