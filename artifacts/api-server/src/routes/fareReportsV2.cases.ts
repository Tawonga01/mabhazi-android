import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
import type {infer as Infer} from 'zod';
import {ListV2FareReportsResponse,GetV2SubjectResponse,ListV2RouteBlocksResponse,SubmitV2ActualJourneyResponse} from '@workspace/api-zod';
type HttpPayload=Infer<typeof ListV2FareReportsResponse>&Infer<typeof GetV2SubjectResponse>&Infer<typeof ListV2RouteBlocksResponse>&Infer<typeof SubmitV2ActualJourneyResponse>;
type Context={admin:pg.Client;accounts:string[];tokens:string[];cities:number[];base:string};
export function registerFareReportTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().admin.query(sql,args);
 let safetyAccount=-1;
 // Initialise only when this suite reaches its first HTTP request. Global test
 // before hooks can overlap the parent's loop over its account array.
 let safetySetup:Promise<void>|undefined;
 function ensureSafetyActor(){return safetySetup??=(async()=>{const actor=randomUUID(),token=randomBytes(32).toString('hex');await q('INSERT INTO users(id) VALUES($1)',[actor]);await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:actor},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);safetyAccount=context().accounts.length;context().accounts.push(actor);context().tokens.push(token);})();}

 async function http(path:string,body?:unknown,account:number|null=null,extra:Record<string,string>={},method=body===undefined?'GET':'POST'){
  await ensureSafetyActor();
  const response=await fetch(context().base+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(account===null?{}:{Authorization:'Bearer '+context().tokens[account],'X-Mabhazi-Account':context().accounts[account]}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,value:await response.json() as HttpPayload,headers:response.headers};
 }
 const date=async()=>(await q("SELECT to_char((statement_timestamp()-interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD') d")).rows[0].d as string;
 async function lead(name='Fare boundary bus',time='07:00',reverse=false){
  const pair=context().cities,r=await http('/v2/contributions',{schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:pair[reverse?1:0],destinationCityId:pair[reverse?0:1],departureTime:time,operator:{name}}},observations:[]},0);assert.equal(r.status,200);return r.value as {subjectId:string;contributionId:string};
 }
 async function submit(route:string,{amount='25.00',currency='USD',kind='paid',owner=1,scope={},company,observedDate}: {amount?:string;currency?:string;kind?:string;owner?:number;scope?:Record<string,unknown>;company?:string;observedDate?:string}={}){
  const revision=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[route])).rows[0].revision;
  const input={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{newActualJourney:{intendedSubject:{id:route,kind:'lead',expectedRevision:Number(revision)}}},observations:[{fieldKey:'fare.'+kind,value:{amount,currency},scope:{schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:context().cities[0],destinationCityId:context().cities[1]},passengerCategory:'adult',ticketBasis:'one_way',...(kind==='paid'?{serviceDate:await date()}:kind==='quoted'?{quotationDate:await date()}:{sourceDate:await date()}),...scope},...(observedDate?{observedDate}:{})},...(company?[{fieldKey:'operator.reported',value:{name:company},scope:{}}]:[])],actualContext:{knowledgeBasis:kind==='paid'?'travelled':'observed_sign'}};
  const r=await http('/v2/actual-journeys',input,owner);assert.equal(r.status,200,JSON.stringify(r.value));return {...r.value,input} as {subjectId:string;contributionId:string;input:typeof input};
 }
 async function assess(...ids:string[]){
  await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND NOT(subject_id=ANY($1::uuid[]))",[ids]);
  // Consumer ticks are bounded; stale generations may need several real ticks.
  for(let tick=0;tick<20;tick++){
   for(const kind of ['normalise','associate','assess']){const r=(await q('SELECT v2_worker_drain_'+kind+'(20) r')).rows[0].r;assert.equal(r.failedAttempts,0,JSON.stringify(r));}
   const due=(await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=ANY($1::uuid[]) AND ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1')) OR (kind='assess' AND policy_version='evidence/1')) AND state='pending' AND available_at<=clock_timestamp()",[ids])).rows[0].n;if(due==='0')return;
  }
  assert.fail('Selected fixture jobs did not settle within20 bounded ticks');
 }
 const get=(route:string,account:number|null=null,extra:Record<string,string>={},cursor?:string)=>http('/v2/subjects/'+route+'/fares'+(cursor?'?cursor='+cursor:''),undefined,account,extra);
 async function ready(options:Parameters<typeof submit>[1]={}){const l=await lead(),a=await submit(l.subjectId,options);await assess(l.subjectId,a.subjectId);return {l,a,page:ListV2FareReportsResponse.parse((await get(l.subjectId)).value)};}
 test('fare reports: real assessed paid fare is dated, canonical decimal, opaque and backward compatible',async()=>{
  const {l,a,page}=await ready();assert.equal(page.items.length,1);const item=page.items[0]!;
  assert.equal(item.amount,'25');assert.equal(item.currency,'USD');assert.equal(item.kind,'paid');assert.equal(item.scope.serviceDate,await date());assert.equal(item.temporalClass,'historical');assert.equal(item.status,'reported');assert.equal(item.freshness,'unknown');assert.equal(item.canBlock,false);
  const obs=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='fare.paid'",[a.contributionId])).rows[0].id;assert.notEqual(item.id,obs);
  const raw=JSON.stringify(page);for(const privateValue of [...context().accounts,obs,a.contributionId,a.subjectId,a.input.clientSubmissionId])assert.ok(!raw.includes(privateValue));for(const key of ['contributors','confidence','sources','payload','selectedValue','price','nextDeparture'])assert.ok(!raw.includes('"'+key+'"'));
  const detail=(await http('/v2/subjects/'+l.subjectId)).value.subject;assert.equal(detail.publicationStatus,'details_needed');assert.equal(detail.timedDepartureEligible,false);assert.equal('fares' in detail,false);assert.equal('price' in detail,false);
  const r=await get(l.subjectId);assert.equal(r.headers.get('cache-control'),'no-store');for(const name of ['Authorization','Cookie','X-Mabhazi-Blocked-Contributors','X-Mabhazi-Account'])assert.ok(r.headers.get('vary')?.includes(name));
 });
 test('fare reports: currency, price type, date, passenger and ticket conditions never collapse',async()=>{
  const l=await lead(),items=[];for(const opts of [{amount:'0',currency:'USD'},{amount:'25',currency:'ZAR'},{kind:'quoted'},{kind:'advertised'},{scope:{passengerCategory:'child'}},{scope:{ticketBasis:'return'}}])items.push(await submit(l.subjectId,opts));await assess(l.subjectId,...items.map(r=>r.subjectId));
  const page=ListV2FareReportsResponse.parse((await get(l.subjectId)).value);assert.equal(page.items.length,6,JSON.stringify((await q('SELECT field_key,scope,evidence_included,field_read FROM v2_fare_report_context WHERE route_subject_id=$1',[l.subjectId])).rows));assert.ok(page.items.some(r=>r.amount==='0'&&r.currency==='USD'));assert.deepEqual(new Set(page.items.map(r=>r.kind)),new Set(['paid','quoted','advertised']));assert.ok(page.items.some(r=>r.scope.ticketBasis==='return'));assert.ok(page.items.some(r=>r.scope.passengerCategory==='child'));
 });
 test('fare reports: one account repeating the exact scoped report has one latest presentation, originals remain',async()=>{
  const l=await lead(),a=await submit(l.subjectId),b=await submit(l.subjectId,{amount:'30'});await assess(l.subjectId,a.subjectId,b.subjectId);const page=ListV2FareReportsResponse.parse((await get(l.subjectId)).value);assert.equal(page.items.length,1);assert.equal(page.items[0]!.amount,'30');assert.equal((await q("SELECT count(*) n FROM v2_observations WHERE original_subject_id=ANY($1::uuid[]) AND field_key='fare.paid'",[[a.subjectId,b.subjectId]])).rows[0].n,'2');
 });
 test('fare reports: route identity is exact across same corridor, company, clock and direction',async()=>{
  const {l,page}=await ready(),other=await lead('Different company'),later=await lead('Fare boundary bus','14:00'),reverse=await lead('Fare boundary bus','07:00',true);
  for(const r of [other,later,reverse]){const result=await get(r.subjectId);assert.equal(result.status,200);assert.equal(result.value.items.length,0);assert.equal((await http('/v2/subjects/'+r.subjectId+'/fares/'+page.items[0]!.id+'/safety',{action:'report',reason:'inaccurate'},safetyAccount)).status,404);}assert.equal((await get(l.subjectId)).value.items.length,1);
 });
 test('fare reports: different explicit segment and known different company remain independent evidence',async()=>{
  const l=await lead(),a=await submit(l.subjectId,{scope:{segment:{kind:'city_pair',originCityId:context().cities[1],destinationCityId:context().cities[0]}}}),b=await submit(l.subjectId,{company:'Other known operator'});await assess(l.subjectId,a.subjectId,b.subjectId);assert.equal((await get(l.subjectId)).value.items.length,0);
 });
 test('fare reports: future dates and stale assessment stay pending without exposing an amount',async()=>{
  const tomorrow=(await q("SELECT to_char(statement_timestamp()+interval '2 days','YYYY-MM-DD') d")).rows[0].d,l=await lead(),a=await submit(l.subjectId,{scope:{serviceDate:tomorrow}});await assess(l.subjectId,a.subjectId);let result=await get(l.subjectId);assert.equal(result.value.items.length,0);assert.equal(result.value.hasPendingReports,true);
  const b=await submit(l.subjectId);await assess(l.subjectId,a.subjectId,b.subjectId);assert.equal((await get(l.subjectId)).value.items.length,1);await q('UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=$1',[b.subjectId]);result=await get(l.subjectId);assert.equal(result.value.items.length,0);assert.equal(result.value.hasPendingReports,true);
 });
 test('fare reports: withdrawal and contribution erasure cannot revive cached amounts',async()=>{
  const {l,a,page}=await ready(),o=(await q("SELECT id FROM v2_observations WHERE original_subject_id=$1 AND field_key='fare.paid'",[a.subjectId])).rows[0].id;
  await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().accounts[1],o,randomUUID()]);assert.equal((await get(l.subjectId)).value.items.length,0);assert.equal((await http('/v2/subjects/'+l.subjectId+'/fares/'+page.items[0]!.id+'/safety',{action:'report',reason:'spam'},safetyAccount)).status,404);
  const b=await submit(l.subjectId);await assess(l.subjectId,b.subjectId);await q('DELETE FROM v2_contributions WHERE id=$1',[b.contributionId]);assert.equal((await get(l.subjectId)).value.items.length,0);
 });
 test('fare reports: changed source evidence invalidates the current read until reassessed without claiming independent confirmation',async()=>{
  const {l,a}=await ready(),o=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1",[a.contributionId])).rows[0].id;
  const source=(await q("INSERT INTO v2_sources(owner_user_id,kind,source_date,private_reference) VALUES($1,'document',$2,'private fare source') RETURNING id",[context().accounts[1],await date()])).rows[0].id;
  await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')",[o,source]);assert.equal((await get(l.subjectId)).value.items.length,0);
  await assess(l.subjectId,a.subjectId);const page=ListV2FareReportsResponse.parse((await get(l.subjectId)).value);assert.equal(page.items.length,1);assert.equal(page.items[0]!.status,'reported');assert.ok(!JSON.stringify(page).includes(source));
  await q('DELETE FROM v2_sources WHERE id=$1',[source]);assert.equal((await get(l.subjectId)).value.items.length,0);await assess(l.subjectId,a.subjectId);assert.equal((await get(l.subjectId)).value.items.length,1);
 });
 test('fare reports: both authors’ device and account blocks apply, with private unblock and no Terms gate',async()=>{
  const {l,page}=await ready(),id=page.items[0]!.id;
  const device=await get(l.subjectId,null,{'X-Mabhazi-Blocked-Contributors':JSON.stringify([context().accounts[1]])});assert.equal(device.value.items.length,0);assert.equal(device.value.hasHiddenResults,true);assert.equal((await get(l.subjectId,null,{'X-Mabhazi-Blocked-Contributors':JSON.stringify([context().accounts[0]])})).status,404);
  const path='/v2/subjects/'+l.subjectId+'/fares/'+id+'/safety';assert.equal((await http(path,{action:'block'},safetyAccount)).status,200);assert.equal((await http(path,{action:'block'},safetyAccount)).status,200);const blocked=await get(l.subjectId,safetyAccount);assert.equal(blocked.value.items.length,0);assert.equal(blocked.value.hasHiddenResults,true);assert.equal((await get(l.subjectId,0)).value.items.length,1);
  const list=await http('/v2/blocked-route-reporters',undefined,safetyAccount);assert.ok(!JSON.stringify(list.value).includes(context().accounts[1]));const ref=list.value.blocks[0].id;
  assert.equal((await http('/v2/blocked-route-reporters/'+ref,undefined,safetyAccount,{},'DELETE')).status,200);assert.equal((await get(l.subjectId,safetyAccount)).value.items.length,1);assert.equal((await http(path,{action:'block'},1)).status,422);
 });
 test('fare reports: report deduplicates, authenticated admin hides only that fare and preserves originals',async()=>{
  const {l,a,page}=await ready(),id=page.items[0]!.id,path='/v2/subjects/'+l.subjectId+'/fares/'+id+'/safety';for(let i=0;i<2;i++)assert.equal((await http(path,{action:'report',reason:'inaccurate'},safetyAccount)).status,200);
  const rows=(await q("SELECT id FROM abuse_reports WHERE target_type='fare_report' AND target_id=$1 AND reporter_id=$2",[id,context().accounts[safetyAccount]])).rows;assert.equal(rows.length,1);
  assert.equal((await http('/admin/abuse-reports/'+rows[0].id,{action:'remove_content'},safetyAccount,{},'PATCH')).status,401);
  const hidden=await http('/admin/abuse-reports/'+rows[0].id,{action:'remove_content',notes:'Synthetic fare moderation'},safetyAccount,{'X-Admin-Secret':process.env.ADMIN_SECRET!},'PATCH');assert.equal(hidden.status,200,JSON.stringify(hidden.value));assert.equal((await get(l.subjectId)).value.items.length,0);assert.equal((await http('/v2/subjects/'+l.subjectId)).status,200);assert.equal((await q('SELECT count(*) n FROM v2_observations WHERE contribution_id=$1',[a.contributionId])).rows[0].n,'1');assert.equal((await q('SELECT count(*) n FROM v2_public_fare_hides WHERE fare_ref=$1',[id])).rows[0].n,'1');
 });
 test('fare reports: malformed context/account/origin/query and unauthorised safety fail closed',async()=>{
  const {l,page}=await ready(),path='/v2/subjects/'+l.subjectId+'/fares/'+page.items[0]!.id+'/safety';assert.equal((await http(path,{action:'block'})).status,401);assert.equal((await http(path,{action:'block'},safetyAccount,{'X-Mabhazi-Account':context().accounts[0]})).status,409);assert.equal((await http(path,{action:'block'},safetyAccount,{Origin:'https://untrusted.invalid'})).status,403);assert.equal((await http(path,{action:'report'},safetyAccount)).status,422);
  assert.equal((await get(l.subjectId,null,{'X-Mabhazi-Account':context().accounts[0]})).status,401);assert.equal((await get(l.subjectId,safetyAccount,{'X-Mabhazi-Blocked-Contributors':'{}'})).status,400);for(const query of ['?cursor[]=x','?extra=true','?cursor=bad'])assert.equal((await http('/v2/subjects/'+l.subjectId+'/fares'+query)).status,400);assert.equal((await get(randomUUID())).status,404);
  delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;try{assert.equal((await get(l.subjectId)).status,503);}finally{process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';}
 });
 test('fare reports: bounded pages use opaque live cursors and a removed cursor forces refresh',async()=>{
  const l=await lead(),saved=[];for(let i=0;i<22;i++)saved.push(await submit(l.subjectId,{scope:{passengerCategory:'other',passengerLabel:'Fare passenger '+i}}));await assess(l.subjectId,...saved.map(r=>r.subjectId));await assess(l.subjectId,...saved.map(r=>r.subjectId));
  // Each bounded tick claims at most20 actuals; a second tick drains the remainder.
  const first=ListV2FareReportsResponse.parse((await get(l.subjectId)).value);assert.equal(first.items.length,20);assert.ok(first.nextCursor);const next=ListV2FareReportsResponse.parse((await get(l.subjectId,null,{},first.nextCursor)).value);assert.equal(next.items.length,2);assert.equal(next.nextCursor,undefined);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,22);
  const obs=(await q('SELECT observation_id FROM v2_public_fare_refs WHERE id=$1',[first.nextCursor])).rows[0].observation_id;await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().accounts[1],obs,randomUUID()]);assert.equal((await get(l.subjectId,null,{},first.nextCursor)).status,400);
 });
 test('fare reports: account erasure removes a different fare author without removing the route report',async()=>{
  const account=context().accounts.length,actor=randomUUID(),token=randomBytes(32).toString('hex');context().accounts.push(actor);context().tokens.push(token);
  await q("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',now())",[actor]);await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:actor},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  const {l,page}=await ready({owner:account});assert.equal(page.items.length,1);await q('DELETE FROM users WHERE id=$1',[actor]);assert.equal((await get(l.subjectId)).value.items.length,0);assert.equal((await http('/v2/subjects/'+l.subjectId)).status,200);
 });
 test('fare reports: backend is read-only, hosted clients and raw trigger helpers stay denied',async()=>{
  const db=context().admin;await q('SET ROLE mabhazi_api');try{await assert.rejects(q('INSERT INTO v2_public_fare_refs(observation_id) VALUES(gen_random_uuid())'),e=>(e as {code:string}).code==='42501');assert.equal((await q("SELECT has_function_privilege(current_user,'v2_fare_reference_created()','EXECUTE') p")).rows[0].p,false);}finally{await q('RESET ROLE');}
  for(const role of ['anon','authenticated']){if(!(await q('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rows.length)await q('CREATE ROLE '+role);await db.query('SET ROLE '+role);try{await assert.rejects(q('SELECT * FROM v2_fare_report_context'),e=>(e as {code:string}).code==='42501');await assert.rejects(q('SELECT v2_api_fare_report_action(NULL,NULL,NULL,NULL,NULL,NULL)'),e=>(e as {code:string}).code==='42501');}finally{await q('RESET ROLE');}}
 });
}
