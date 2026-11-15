import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
import {createTimetablePreview,type TimetableProposal} from '../lib/adminTimetable';
type Context={admin:pg.Client;base:string;accounts:string[];tokens:string[];cities:number[]};
export function registerAdminTimetableApiTests(context:()=>Context){
 const owner=randomUUID(),token=randomBytes(32).toString('hex');
 const q=(sql:string,args:unknown[]=[])=>context().admin.query(sql,args);
 const facades=['v2_api_admin_timetable_preview(varchar,jsonb)','v2_api_admin_timetable_action(varchar,uuid,jsonb)',
  'v2_api_admin_timetable_receipt(varchar,uuid)','v2_api_admin_timetable_operators(varchar,text)',
  'v2_api_admin_timetable_records(varchar,uuid)','v2_api_admin_timetable_command(varchar,uuid,jsonb)','v2_api_admin_timetable_command_receipt(varchar,uuid)'];
 // Test-only grants in isolated CI PostgreSQL. No migration grants these rights.
 async function enabled<T>(fn:()=>Promise<T>,grant=true){
  const a=process.env.NAMED_ADMIN_CONSOLE_ENABLED,b=process.env.NAMED_ADMIN_TIMETABLES_ENABLED,c=process.env.REVIEWED_TIMETABLES_ENABLED;
  process.env.REVIEWED_TIMETABLES_ENABLED='true';process.env.NAMED_ADMIN_CONSOLE_ENABLED='true';process.env.NAMED_ADMIN_TIMETABLES_ENABLED='true';
  try{if(grant)for(const f of facades)await q('GRANT EXECUTE ON FUNCTION public.'+f+' TO mabhazi_api');return await fn();}
  finally{if(grant)for(const f of facades)await q('REVOKE ALL ON FUNCTION public.'+f+' FROM mabhazi_api');
   if(c===undefined)delete process.env.REVIEWED_TIMETABLES_ENABLED;else process.env.REVIEWED_TIMETABLES_ENABLED=c;
   if(a===undefined)delete process.env.NAMED_ADMIN_CONSOLE_ENABLED;else process.env.NAMED_ADMIN_CONSOLE_ENABLED=a;
   if(b===undefined)delete process.env.NAMED_ADMIN_TIMETABLES_ENABLED;else process.env.NAMED_ADMIN_TIMETABLES_ENABLED=b;}
 }
 async function call(path:string,body?:unknown,extra:Record<string,string>={},sid:string|null=token){
  const r=await fetch(context().base+'/admin-console/timetables'+path,{method:body===undefined?'GET':'POST',headers:{
   ...(sid?{Authorization:'Bearer '+sid}:{}),'X-Mabhazi-Account':owner,Origin:'https://api.mabhazi.com','Content-Type':'application/json',...extra},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,value:await r.json() as any,headers:r.headers};
 }
 async function proposal():Promise<TimetableProposal>{const c=context(),day=(await q("SELECT (statement_timestamp() AT TIME ZONE 'Africa/Harare')::date::text AS checked_date")).rows[0].checked_date;
  return{version:1,operator:'Private API timetable '+randomUUID().slice(0,8),operatorRef:null,separateOperator:false,
   originCityId:c.cities[0],destinationCityId:c.cities[1],pickup:'API timetable boarding',dropoff:null,timezone:'Africa/Harare',weekdays:[1,2,3,4,5],
   validFrom:day,validUntil:day.slice(0,4)+'-12-31',source:{kind:'operator_confirmation',reference:'Synthetic isolated API fixture',checkedOn:day},
   departures:[{departure:'06:00',arrival:null,arrivalDay:0,fare:null},{departure:'13:30',arrival:null,arrivalDay:0,fare:null}]};
 }
 test('timetable API: named authority, feature flag and all four executable facades are required independently',async()=>{
  await q('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Timetable fixture owner']);
  await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:owner},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);
  await enabled(async()=>{assert.equal((await call('/state')).status,503);},false);
  await enabled(async()=>{const r=await call('/state');assert.equal(r.status,200);assert.deepEqual(r.value,{available:true});assert.match(r.headers.get('cache-control')??'',/no-store/);});
  await enabled(async()=>{await q('REVOKE ALL ON FUNCTION public.'+facades[3]+' FROM mabhazi_api');assert.equal((await call('/state')).status,503);});
 });
 test('timetable API: guest, ordinary user, changed account, cross-origin and actor-injected bodies cannot create commands',async()=>enabled(async()=>{
  const p=await proposal(),before=(await q('SELECT count(*) n FROM v2_admin_timetables')).rows[0].n;
  assert.equal((await call('/preview',p,{},null)).status,401);
  assert.equal((await call('/preview',p,{},context().tokens[0])).status,403);
  assert.equal((await call('/preview',p,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/preview',p,{Origin:'https://other.example'})).status,403);
  assert.equal((await call('/preview',{...p,actor:owner})).status,422);
  assert.equal((await q('SELECT count(*) n FROM v2_admin_timetables')).rows[0].n,before);
 }));
 test('timetable API: two concurrent exact approvals commit once and receipts recover the original two departures',async()=>enabled(async()=>{
  const p=await proposal(),review=await call('/preview',p);assert.equal(review.status,200);assert.equal(review.value.writable,true);
  assert.deepEqual(review.value.proposal,p);const body={clientRequestId:randomUUID(),previewToken:review.value.previewToken};
  const [a,b]=await Promise.all([call('/actions',body),call('/actions',body)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.value,b.value);
  assert.equal(a.value.id,body.clientRequestId);assert.equal(a.value.departureCount,2);assert.equal(a.value.outcome,'approved');
  assert.equal((await q('SELECT count(*) n FROM v2_admin_timetable_entries WHERE timetable_id=$1',[body.clientRequestId])).rows[0].n,'2');
  assert.deepEqual((await call('/receipts/'+body.clientRequestId)).value,a.value);
  const duplicate=await call('/preview',p);assert.equal(duplicate.status,200);assert.equal(duplicate.value.writable,false);assert.ok(duplicate.value.duplicates.some((d:any)=>d.kind==='timetable'));
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:duplicate.value.previewToken})).status,409);
  const raw=JSON.parse(Buffer.from(review.value.previewToken.split('.')[0],'base64url').toString('utf8'));
  const expired=createTimetablePreview(p,owner,raw.stateDigest,process.env.ADMIN_SECRET!,Date.now()-300001);
  const replay=await call('/actions',{...body,previewToken:expired});assert.equal(replay.status,200);assert.deepEqual(replay.value,a.value);
 }));
 test('timetable API: stale previews, duplicate departures, unknown optional values and unsafe keys remain explicit',async()=>enabled(async()=>{
  const p=await proposal();p.originCityId=(await q("INSERT INTO cities(name,place_type) VALUES('Isolated timetable preview city','city') RETURNING id")).rows[0].id;
  const review=await call('/preview',p);assert.equal(review.status,200);
  await q('UPDATE cities SET name=name||$2 WHERE id=$1',[p.originCityId,' timetable change']);
  const stale=await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken});assert.equal(stale.status,409);assert.equal(stale.value.code,'PREVIEW_CHANGED');
  assert.equal((await call('/preview',{...p,weekdays:[]})).status,422);
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken,actor:owner})).status,422);
  assert.equal((await call('/operators?q=x&extra=1')).status,400);
  await q('DELETE FROM cities WHERE id=$1',[p.originCityId]);
 }));
 test('timetable API: revoked owner cannot use an intact signed preview or recover private receipts',async()=>enabled(async()=>{
  const p=await proposal(),review=await call('/preview',p);assert.equal(review.status,200);
  await q('UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=user_id WHERE user_id=$1 AND revoked_at IS NULL',[owner]);
  try{assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken})).status,403);
   assert.equal((await call('/receipts/'+randomUUID())).status,403);}
  finally{await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_regrant')",[owner]);}
 }));

 async function publicCall(url:string,body?:unknown,extra:Record<string,string>={},actor:number|null=null){
  const r=await fetch(context().base+'/v2'+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Mabhazi-Route-Display':'reviewed-timetable/1',Origin:'https://api.mabhazi.com',
  ...(actor===null?{}:{Authorization:'Bearer '+context().tokens[actor],'X-Mabhazi-Account':context().accounts[actor]}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:r.status,value:await r.json() as any};
 }
 test('timetable public HTTP: new display exposes approved price, pickup, arrival and explicit calendar; old display withholds',async()=>enabled(async()=>{
  const p=await proposal();p.operator+=' public';p.departures=[{departure:'07:00',arrival:'09:15',arrivalDay:0,fare:{amount:'18.00',currency:'USD',kind:'advertised'}}];p.dropoff='Known API arrival';p.weekdays=[1,2,3,4,5,6,7];
  const review=await call('/preview',p),r=await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken});assert.equal(r.status,200);
  const subject=(await q('SELECT source_subject_id id FROM v2_admin_timetable_entries WHERE timetable_id=$1',[r.value.id])).rows[0].id;
  const result=await publicCall('/search?operator='+encodeURIComponent(p.operator));assert.equal(result.status,200);assert.equal(result.value.items.length,1);
  const item=result.value.items[0];assert.equal(item.subjectId,subject);assert.equal(item.publicationStatus,'reviewed_timetable');assert.equal(item.timedDepartureEligible,true);assert.equal(item.contributionTargetEligible,true);
  assert.equal(item.timetable.arrivalSeconds,33300);assert.equal(item.cardDetails.fare.amount,'18');assert.equal(item.cardDetails.pickup.name,p.pickup);assert.equal(item.cardDetails.dropoff.name,p.dropoff);
  assert.equal(item.cardDetails.fare.freshness,'fresh');assert.deepEqual(item.missingDetails,[]);assert.ok(!JSON.stringify(result.value).includes(owner));
  assert.equal((await publicCall('/subjects/'+subject)).value.subject.subjectId,subject);
  assert.equal((await publicCall('/search?operator='+encodeURIComponent(p.operator),undefined,{'X-Mabhazi-Route-Display':'reviewed-core/1'})).value.items.length,0);
  const board=await publicCall('/departure-board?originKey=city:'+p.originCityId);assert.equal(board.status,200);
  const entry=board.value.entries.find((e:any)=>e.subjectId===subject);assert.equal(entry.countdownEligible,true);assert.equal(entry.scheduleTimezone,'Africa/Harare');assert.ok(entry.nextDepartureAt);assert.equal(entry.pickupPoint,p.pickup);
  assert.equal((await publicCall('/subjects/'+subject+'/fares')).value.items[0].amount,'18');assert.equal((await publicCall('/subjects/'+subject+'/places')).value.items.find((x:any)=>x.kind==='pickup').name,p.pickup);
  const caps=await publicCall('/capabilities');assert.equal(caps.value.reviewedTimetablesEnabled,true);
 }));
 test('timetable public HTTP: ordinary Google account saves pickup and recovers receipt on the same real source alias',async()=>enabled(async()=>{
  const p=await proposal();p.operator+=' traveller';p.departures=p.departures.slice(0,1);const review=await call('/preview',p),r=await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken});assert.equal(r.status,200);
  const subject=(await q('SELECT source_subject_id id FROM v2_admin_timetable_entries WHERE timetable_id=$1',[r.value.id])).rows[0].id;
  const c=await publicCall('/subjects/'+subject+'/contribution-context',undefined,{},0);assert.equal(c.status,200);assert.equal(c.value.operatorName,p.operator);
  const body={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{existing:{subjectId:subject,expectedRevision:c.value.revision,identityKey:c.value.identityKey}},observations:[{fieldKey:'boarding.pickup',value:{cityId:p.originCityId,name:'Traveller endpoint'},scope:{},knowledgeBasis:'observed_sign'}]};
  const saved=await publicCall('/route-observations',body,{},0);assert.equal(saved.status,200);assert.equal(saved.value.saveStatus,'saved');
  const replay=await publicCall('/route-observations',body,{},0);assert.equal(replay.value.contributionId,saved.value.contributionId);assert.equal(replay.value.replayed,true);
  assert.equal((await publicCall('/subjects/'+subject)).status,200);
  assert.equal((await publicCall('/subjects/'+subject+'/places/'+(await publicCall('/subjects/'+subject)).value.subject.cardDetails.pickup.id+'/safety',{action:'report',reason:'inaccurate'},{},0)).status,200);
  assert.equal((await call('/state',undefined,{},context().tokens[0])).status,403);
 }));
 test('timetable public HTTP: readiness requires all adapters; paused timetable display does not break old community reads',async()=>enabled(async()=>{
  await q('REVOKE ALL ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) FROM mabhazi_api');
  try{assert.equal((await publicCall('/capabilities')).value.reviewedTimetablesEnabled,false);assert.equal((await call('/state')).status,503);assert.equal((await publicCall('/search')).status,200);}
  finally{await q('GRANT EXECUTE ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) TO mabhazi_api');}
 }));

 test('timetable management HTTP: named owner withdraws only price with exact receipt recovery and ordinary users remain denied',async()=>enabled(async()=>{
  const p=await proposal();p.operator+=' management';p.departures=[{departure:'10:00',arrival:null,arrivalDay:0,fare:{amount:'15',currency:'USD',kind:'advertised'}}];
  const review=await call('/preview',p),r=await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken});assert.equal(r.status,200);
  const records=await call('/records');assert.equal(records.status,200);const record=records.value.items.find((x:any)=>x.timetableId===r.value.id);assert.ok(record);
  const property=record.properties.find((x:any)=>x.field==='fare.advertised'),body={clientRequestId:randomUUID(),input:{routeId:record.routeId,revision:record.revision,operation:'withdraw',reason:'incorrect_information',expiresAt:Date.now()+300000,field:property.field,reviewId:property.reviewId,caseRevision:property.caseRevision,subjectRevision:property.subjectRevision,impactDigest:property.impactDigest}};
  assert.equal((await call('/records',undefined,{},context().tokens[0])).status,403);
  const done=await call('/commands',body);assert.equal(done.status,200);assert.equal(done.value.outcome,'withdrawn');assert.deepEqual((await call('/commands',body)).value,done.value);
  assert.deepEqual((await call('/commands/'+body.clientRequestId)).value,done.value);
  const read=await publicCall('/subjects/'+record.routeId);assert.equal(read.status,200);assert.equal(read.value.subject.cardDetails.fare,undefined);assert.equal(read.value.subject.cardDetails.pickup.name,p.pickup);
 }));
 test('timetable replacement HTTP: each matching record is explicitly chosen and its removal shares the import transaction',async()=>enabled(async()=>{
  const p=await proposal();p.operator+=' replacement';p.departures=p.departures.slice(0,1);const original=await call('/preview',p),saved=await call('/actions',{clientRequestId:randomUUID(),previewToken:original.value.previewToken});assert.equal(saved.status,200);
  const lookup=await call('/operators?q='+encodeURIComponent(p.operator)),operator=lookup.value.operators.find((x:any)=>x.name===p.operator);p.operatorRef={id:operator.id,revision:operator.revision};
  const duplicates=await call('/preview',p);assert.equal(duplicates.value.writable,false);const match=duplicates.value.duplicates.find((x:any)=>x.kind==='timetable');assert.ok(match);
  const replacement={...p,replacements:[{kind:match.kind,id:match.id,revision:match.revision}]},next=await call('/preview',replacement);assert.equal(next.value.writable,true);assert.equal(next.value.replacements.length,1);
  const result=await call('/actions',{clientRequestId:randomUUID(),previewToken:next.value.previewToken});assert.equal(result.status,200);assert.equal(result.value.replacedRecords.length,1);
  const records=(await call('/records')).value.items;assert.ok(records.find((x:any)=>x.timetableId===saved.value.id).removalId);assert.equal(records.find((x:any)=>x.timetableId===result.value.id).publiclyAvailable,true);
 }));
}
