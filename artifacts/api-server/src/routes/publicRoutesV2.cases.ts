import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type pg from 'pg';
import { GetV2SubjectResponse, SearchV2RoutesResponse, SubmitV2ActualJourneyResponse, ListV2RouteBlocksResponse } from '@workspace/api-zod';

type Context={admin:pg.Client;accounts:string[];tokens:string[];base:string};
export function registerPublicRouteTests(context:()=>Context){
 let cityIds:number[]|undefined;
 async function cities(){if(!cityIds)cityIds=(await context().admin.query("INSERT INTO cities(name,place_type) VALUES('Public origin fixture','city'),('Public destination fixture','city') RETURNING id")).rows.map(row=>row.id);return cityIds;}
 async function create(name='Public reported bus',time='08:00',reverse=false,account=0){
  const pair=await cities(),clientSubmissionId=randomUUID();
  const response=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+context().tokens[account],'X-Mabhazi-Account':context().accounts[account]},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId,entrySurface:'contribute_tab',target:{newLead:{originCityId:pair[reverse?1:0],destinationCityId:pair[reverse?0:1],operator:{name},departureTime:time}},observations:[]})});
  assert.equal(response.status,200);return {...await response.json() as {subjectId:string;contributionId:string},clientSubmissionId};
 }
 async function get(path:string,blocked?:unknown,account:number|null=null){const response=await fetch(context().base+'/v2'+path,{headers:{...(blocked===undefined?{}:{'X-Mabhazi-Blocked-Contributors':typeof blocked==='string'?blocked:JSON.stringify(blocked)}),...(account===null?{}:{Authorization:'Bearer '+context().tokens[account],'X-Mabhazi-Account':context().accounts[account]})}});return{status:response.status,value:await response.json(),headers:response.headers};}
 async function search(query=''){const pair=await cities();return get('/search?originCityId='+pair[0]+'&destinationCityId='+pair[1]+query);}
 async function observation(id:string,field='departure.reported'){return(await context().admin.query('SELECT id,scope_key,value,scope FROM v2_observations WHERE original_subject_id=$1 AND field_key=$2',[id,field])).rows[0];}
 async function hiddenReview(subjectId:string,observationId:string){
  const db=context().admin,actor=context().accounts[1];
  await db.query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING",[actor]);
  const reviewCase=(await db.query("SELECT v2_open_review_case($1,$2,'moderation',NULL,NULL) id",[actor,subjectId])).rows[0].id;
  const expected=(await db.query('SELECT revision FROM v2_review_cases WHERE id=$1',[reviewCase])).rows[0].revision;
  const revision=(await db.query('SELECT revision FROM v2_subjects WHERE id=$1',[subjectId])).rows[0].revision;
  await db.query("SELECT v2_record_review($1,$2,$3,$4,'hide','public_fixture',NULL,$5,'review/1',NULL)",[actor,reviewCase,expected,revision,[observationId]]);
 }
 test('public route read: guest receives typed reported fields, never private identity, selected fare or countdown',async()=>{
  const saved=await create(),result=await get('/subjects/'+saved.subjectId);assert.equal(result.status,200);
  const subject=GetV2SubjectResponse.parse(result.value).subject;
  assert.deepEqual(Object.keys((result.value as {subject:object}).subject).sort(),['kind','subjectId','revision','origin','destination','operatorReport','reportedTime','publicationStatus','timedDepartureEligible','contributionTargetEligible','missingDetails'].sort());
  assert.equal(subject.kind,'lead');assert.equal(subject.publicationStatus,'details_needed');assert.equal(subject.timedDepartureEligible,false);assert.equal(subject.contributionTargetEligible,true);
  assert.equal(subject.reportedTime.value,'08:00');assert.equal(subject.reportedTime.basis,'unspecified');assert.equal(subject.reportedTime.observedDate,null);assert.equal(subject.reportedTime.freshness,'unknown');
  assert.equal(subject.operatorReport.value,'Public reported bus');assert.equal(subject.operatorReport.observedDate,null);
  const raw=JSON.stringify(result.value);for(const privateValue of [...context().accounts,saved.contributionId,saved.clientSubmissionId])assert.ok(!raw.includes(privateValue));
  for(const key of ['price','nextDeparture','confidenceScore','payload','sources','ownerId'])assert.ok(!raw.includes('"'+key+'"'));
  assert.equal(result.headers.get('cache-control'),'no-store');assert.ok(result.headers.get('vary')?.includes('X-Mabhazi-Blocked-Contributors'));
  assert.ok(SearchV2RoutesResponse.parse((await search()).value).items.some(row=>row.subjectId===saved.subjectId));
 });
 test('public route read: company, time and direction preserve distinct lead identities with no legacy mapping',async()=>{
  const one=await create('Same corridor A'),two=await create('Same corridor B'),later=await create('Same corridor A','14:00'),reverse=await create('Same corridor A','08:00',true);
  const items=SearchV2RoutesResponse.parse((await search()).value).items;
  for(const saved of [one,two,later])assert.ok(items.some(row=>row.subjectId===saved.subjectId));assert.ok(!items.some(row=>row.subjectId===reverse.subjectId));
  assert.equal(items.find(row=>row.subjectId===later.subjectId)?.reportedTime.value,'14:00');assert.equal(new Set([one,two,later,reverse].map(row=>row.subjectId)).size,4);
  assert.equal((await get('/subjects/1')).status,400);
 });
 test('public route read: bounded safety context excludes blocked authors without disclosing them or pretending absence',async()=>{
  const saved=await create('Blocked public report'),pair=await cities(),blocked=[context().accounts[0]];
  const result=await get('/search?originCityId='+pair[0]+'&destinationCityId='+pair[1],blocked);assert.equal(result.status,200);
  const page=SearchV2RoutesResponse.parse(result.value);assert.equal(page.hasHiddenResults,true);assert.ok(!page.items.some(row=>row.subjectId===saved.subjectId));assert.ok(!JSON.stringify(result.value).includes(blocked[0]));
  assert.deepEqual(await get('/subjects/'+saved.subjectId,blocked).then(r=>({status:r.status,value:r.value})),await get('/subjects/'+randomUUID(),blocked).then(r=>({status:r.status,value:r.value})));
  for(const value of ['{bad','{}','null','[1]',JSON.stringify(Array(201).fill('x')),JSON.stringify(['x'.repeat(201)]),JSON.stringify(['bad\nID'])])assert.equal((await get('/subjects/'+saved.subjectId,value)).status,400);
 });
 test('public route read: withdrawal and moderation hide core reports without exposing the initial payload',async()=>{
  const withdrawn=await create('Withdrawn public report'),hidden=await create('Hidden public report');
  const first=await observation(withdrawn.subjectId);await context().admin.query('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().accounts[0],first.id,randomUUID()]);
  await hiddenReview(hidden.subjectId,(await observation(hidden.subjectId,'operator.reported')).id);
  for(const id of [withdrawn.subjectId,hidden.subjectId])assert.equal((await get('/subjects/'+id)).status,404);
  const items=SearchV2RoutesResponse.parse((await search()).value).items;assert.ok(!items.some(row=>[withdrawn.subjectId,hidden.subjectId].includes(row.subjectId)));
 });
 test('public route read: correction and retirement never revive original values or guess a replacement',async()=>{
  const corrected=await create('Corrected public report'),retired=await create('Retired public report');const original=await observation(corrected.subjectId);
  await context().admin.query(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,supersedes_id)
   SELECT contribution_id,original_subject_id,field_key,'{"time":"09:00","basis":"unspecified"}',scope,scope_key,value_key,id FROM v2_observations WHERE id=$1`,[original.id]);
  await context().admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[retired.subjectId]);
  for(const id of [corrected.subjectId,retired.subjectId])assert.equal((await get('/subjects/'+id)).status,404);
 });
 test('public route read: live revision changes and contribution/account erasure remove current public access',async()=>{
  const saved=await create('Erased public report'),first=GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject;
  await context().admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[saved.subjectId]);
  assert.equal(GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject.revision,first.revision+1);
  await context().admin.query('DELETE FROM v2_contributions WHERE id=$1',[saved.contributionId]);assert.equal((await get('/subjects/'+saved.subjectId)).status,404);
  const actor=randomUUID(),token=randomBytes(32).toString('hex'),account=context().accounts.length;
  context().accounts.push(actor);context().tokens.push(token);
  await context().admin.query("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',now())",[actor]);
  await context().admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:actor},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  const other=await create('Account erased report','08:00',false,account);assert.equal((await get('/subjects/'+other.subjectId)).status,200);
  await context().admin.query('DELETE FROM users WHERE id=$1',[actor]);assert.equal((await get('/subjects/'+other.subjectId)).status,404);

 });
 test('public route read: reviewed reassignment hides the original lead without fabricating a service link',async()=>{
  const a=await create('Assignment bus'),b=await create('Assignment bus'),db=context().admin,o=await observation(a.subjectId),actor=context().accounts[1];
  const state=async(id:string)=>(await db.query('SELECT revision,kind FROM v2_subjects WHERE id=$1',[id])).rows[0];
  await db.query('BEGIN');try{
  const sa=await state(a.subjectId),sb=await state(b.subjectId);
  const candidate=(await db.query(`INSERT INTO v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,rule_version,source_revision,target_revision)
   VALUES($1,'lead',$2,'lead','duplicate_of',$3,ARRAY['identity_fixture'],'association/1',$4,$5) RETURNING id`,[a.subjectId,b.subjectId,'b'.repeat(64),sa.revision,sb.revision])).rows[0].id;
  await db.query('INSERT INTO v2_candidate_evidence VALUES($1,$2)',[candidate,o.id]);
  await db.query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING",[actor]);
  const reviewCase=(await db.query("SELECT v2_open_review_case($1,$2,'identity',NULL,NULL) id",[actor,a.subjectId])).rows[0].id;
  await db.query('UPDATE v2_review_cases SET candidate_id=$1 WHERE id=$2',[candidate,reviewCase]);
  const cr=(await db.query('SELECT revision FROM v2_review_cases WHERE id=$1',[reviewCase])).rows[0].revision;
  const review=(await db.query("SELECT v2_record_review($1,$2,$3,$4,'accept','reviewed_identity',NULL,$5,'review/1',NULL) id",[actor,reviewCase,cr,(await state(a.subjectId)).revision,[o.id]])).rows[0].id;
  const decision=randomUUID();await db.query("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'association')",[decision]);
  await db.query(`INSERT INTO v2_association_decisions(id,candidate_id,action,actor_kind,reviewer_decision_id,reason_code,policy_version,expected_from_revision,expected_to_revision,expected_candidate_revision)
   VALUES($1,$2,'accept','reviewer',$3,'reviewed_identity','association/1',$4,$5,1)`,[decision,candidate,review,(await state(a.subjectId)).revision,(await state(b.subjectId)).revision]);
  await db.query('SELECT v2_apply_association_decision($1)',[decision]);
  const target=(await db.query('SELECT revision FROM v2_observation_targets WHERE observation_id=$1',[o.id])).rows[0];
  const os=(await db.query('SELECT revision FROM v2_observation_states WHERE observation_id=$1',[o.id])).rows[0];
  await db.query('SELECT v2_resolve_observation_target($1,$2,$3,$4,$5,$6)',[o.id,decision,target.revision,os.revision,(await state(a.subjectId)).revision,(await state(b.subjectId)).revision]);
  assert.ok((await db.query('SELECT assignment_id FROM v2_observation_targets WHERE observation_id=$1',[o.id])).rows[0].assignment_id);
  await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
  assert.equal((await get('/subjects/'+a.subjectId)).status,404);assert.equal(GetV2SubjectResponse.parse((await get('/subjects/'+b.subjectId)).value).subject.kind,'lead');
 });
 test('public route read: a withheld core decision prevents re-exposing its original value',async()=>{
  const saved=await create('Withheld public report'),db=context().admin,o=await observation(saved.subjectId),id=randomUUID();
  const state=(await db.query('SELECT revision,input_generation FROM v2_subjects WHERE id=$1',[saved.subjectId])).rows[0];
  await db.query('BEGIN');try{
  await db.query("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')",[id]);
  await db.query(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
   VALUES($1,$2,'departure.reported',$3,$4,1,$5,$6,$7,'reported','none','unknown','withheld',ARRAY['reported_evidence'],'evidence/1',$8)`,[id,saved.subjectId,o.scope_key,o.scope,state.revision,state.input_generation,o.value,'a'.repeat(64)]);
  await db.query("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')",[id,o.id]);
  await db.query('SELECT v2_apply_field_decision($1)',[id]);
  await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
  assert.equal((await get('/subjects/'+saved.subjectId)).status,404);
 });
 test('public route read: stable bounded pages, strict query and hidden/deleted cursor rejection',async()=>{
  for(let i=0;i<23;i++)await create('Page public '+i,'10:00',false,3);
  const seen=new Set<string>();let cursor:string|undefined;do{const result=await search(cursor?'&cursor='+cursor:'');assert.equal(result.status,200);const page=SearchV2RoutesResponse.parse(result.value);assert.ok(page.items.length<=20);for(const row of page.items){assert.ok(!seen.has(row.subjectId));seen.add(row.subjectId);}cursor=page.nextCursor;}while(cursor);assert.ok(seen.size>=23);
  const first=SearchV2RoutesResponse.parse((await search()).value);assert.ok(first.nextCursor);await context().admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[first.nextCursor]);assert.equal((await search('&cursor='+first.nextCursor)).status,400);
  for(const query of ['&owner=x','&originCityId[]=1','&cursor=x','&cursor[]=x','&originCityId=1.5'])assert.equal((await search(query)).status,400);
  const pair=await cities();assert.equal((await get('/search?originCityId='+pair[0]+'&destinationCityId='+pair[0])).status,400);assert.equal((await get('/search?originCityId=999999998&destinationCityId=999999999')).status,422);assert.equal((await get('/subjects/'+randomUUID()+'?evidence=true')).status,400);
 });
 test('public route read: public identity does not bypass the own-lead-only write facade',async()=>{
  const saved=await create('Read only public report'),subject=GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject;
  const response=await fetch(context().base+'/v2/actual-journeys',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+context().tokens[1],'X-Mabhazi-Account':context().accounts[1]},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newActualJourney:{intendedSubject:{kind:'lead',id:subject.subjectId,expectedRevision:subject.revision}}},observations:[{fieldKey:'operator.reported',value:{name:'Observed bus'},scope:{}}]})});
  assert.equal(response.status,404);assert.equal((await response.json() as {code:string}).code,'TARGET_NOT_FOUND');
 });
 test('public route read: pausing intake closes public discovery but retains private receipt/history recovery',async()=>{
  const saved=await create('Paused public report');delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
  try{assert.equal((await search()).status,503);assert.equal((await get('/subjects/'+saved.subjectId)).status,503);
   const headers={Authorization:'Bearer '+context().tokens[0],'X-Mabhazi-Account':context().accounts[0]};
   for(const path of ['/my-routes','/receipts/'+saved.clientSubmissionId])assert.equal((await fetch(context().base+'/v2'+path,{headers})).status,200);
  }finally{process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';}
 });
 async function action(path:string,body:unknown,account=1,method='POST',extra:Record<string,string>={}){
  const response=await fetch(context().base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+context().tokens[account],'X-Mabhazi-Account':context().accounts[account],...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,value:await response.json()};
 }
 function actual(subjectId:string,revision:number,key=randomUUID()){return{schemaVersion:'1.0',clientSubmissionId:key,entrySurface:'route_detail',target:{newActualJourney:{intendedSubject:{kind:'lead',id:subjectId,expectedRevision:revision}}},observations:[{fieldKey:'operator.reported',value:{name:'Observed contextual bus'},scope:{}}]};}
 test('public context: another public account saves scoped evidence against the selected current lead and replays once',async()=>{
  const saved=await create('Public context bus'),subject=GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject,input=actual(saved.subjectId,subject.revision);
  const result=await action('/v2/actual-journeys',input);assert.equal(result.status,200);assert.equal(SubmitV2ActualJourneyResponse.parse((await action('/v2/actual-journeys',input)).value).contributionId,SubmitV2ActualJourneyResponse.parse(result.value).contributionId);
  const stored=(await context().admin.query('SELECT payload FROM v2_contributions WHERE id=$1',[SubmitV2ActualJourneyResponse.parse(result.value).contributionId])).rows[0].payload;
  assert.equal(stored.target.newActualJourney.intendedSubject.id,saved.subjectId);assert.equal(stored.entrySurface,'route_detail');assert.equal(stored.observations.length,1);assert.equal(stored.actualContext?.knowledgeBasis,'unprovided');assert.ok(!stored.target.newActualJourney.reportedServiceDate);
  await context().admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[saved.subjectId]);
  assert.equal(SubmitV2ActualJourneyResponse.parse((await action('/v2/actual-journeys',input)).value).contributionId,SubmitV2ActualJourneyResponse.parse(result.value).contributionId);
  assert.equal((await action('/v2/actual-journeys',actual(saved.subjectId,subject.revision))).status,404);
 });
 test('public context: late revision, withdrawn target and device blocks reject fresh intake without changing own-only surfaces',async()=>{
  const saved=await create('Changing public bus'),subject=GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject;
  await context().admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[saved.subjectId]);assert.equal((await action('/v2/actual-journeys',actual(saved.subjectId,subject.revision))).status,409);
  const input=actual(saved.subjectId,subject.revision+1);assert.equal((await action('/v2/actual-journeys',input,1,'POST',{'X-Mabhazi-Blocked-Contributors':JSON.stringify([context().accounts[0]])})).status,404);
  assert.equal((await action('/v2/actual-journeys',{...input,entrySurface:'contribute_tab'})).status,404);
  const o=await observation(saved.subjectId);await context().admin.query('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().accounts[0],o.id,randomUUID()]);assert.equal((await action('/v2/actual-journeys',input)).status,404);
 });
 test('public context: account blocks hide all this author’s route reports, remain private, unblock by own reference and erase with the author',async()=>{
  const saved=await create('Blocked account route'),sibling=await create('Blocked sibling route');
  assert.equal((await action('/v2/subjects/'+saved.subjectId+'/safety',{action:'block'})).status,200);assert.equal((await action('/v2/subjects/'+saved.subjectId+'/safety',{action:'block'})).status,200);
  for(const id of [saved.subjectId,sibling.subjectId]){assert.equal((await get('/subjects/'+id,[],1)).status,404);assert.equal((await get('/subjects/'+id,[],0)).status,200);}
  const list=await get('/blocked-route-reporters',undefined,1);assert.equal(list.status,200);assert.equal(ListV2RouteBlocksResponse.parse(list.value).blocks.length,1);const row=ListV2RouteBlocksResponse.parse(list.value).blocks[0];assert.deepEqual(Object.keys(row).sort(),['blockedAt','id']);assert.ok(!JSON.stringify(list.value).includes(context().accounts[0]));
  assert.equal(ListV2RouteBlocksResponse.parse((await get('/blocked-route-reporters',undefined,0)).value).blocks.length,0);
  await action('/v2/blocked-route-reporters/'+row.id,undefined,0,'DELETE');assert.equal((await get('/subjects/'+saved.subjectId,[],1)).status,404);
  await action('/v2/blocked-route-reporters/'+row.id,undefined,1,'DELETE');assert.equal((await get('/subjects/'+saved.subjectId,[],1)).status,200);
  const actor=randomUUID(),token=randomBytes(32).toString('hex'),account=context().accounts.length;context().accounts.push(actor);context().tokens.push(token);
  await context().admin.query("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',now())",[actor]);await context().admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:actor},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  const erased=await create('Erase blocked author','08:00',false,account);assert.equal((await action('/v2/subjects/'+erased.subjectId+'/safety',{action:'block'})).status,200);assert.equal(ListV2RouteBlocksResponse.parse((await get('/blocked-route-reporters',undefined,1)).value).blocks.length,1);await context().admin.query('DELETE FROM users WHERE id=$1',[actor]);assert.equal(ListV2RouteBlocksResponse.parse((await get('/blocked-route-reporters',undefined,1)).value).blocks.length,0);

 });
 test('public context: report and block remain available without Terms; admin-only hide is audited and blocks new target use',async()=>{
  const saved=await create('Moderated public context'),subject=GetV2SubjectResponse.parse((await get('/subjects/'+saved.subjectId)).value).subject;
  await context().admin.query('UPDATE users SET terms_accepted_at=NULL WHERE id=$1',[context().accounts[1]]);
  try{
   const body={action:'report',reason:'inaccurate'};assert.equal((await action('/v2/subjects/'+saved.subjectId+'/safety',body)).status,200);assert.equal((await action('/v2/subjects/'+saved.subjectId+'/safety',body)).status,200);
   const rows=(await context().admin.query("SELECT id FROM abuse_reports WHERE target_type='transport_subject' AND target_id=$1 AND reporter_id=$2",[saved.subjectId,context().accounts[1]])).rows;assert.equal(rows.length,1);
   assert.equal((await action('/v2/actual-journeys',actual(saved.subjectId,subject.revision))).status,428);
   assert.equal((await action('/admin/abuse-reports/'+rows[0].id,{action:'remove_route'},1,'PATCH')).status,401);
   const moderated=await action('/admin/abuse-reports/'+rows[0].id,{action:'remove_route',notes:'Synthetic public moderation'},1,'PATCH',{'X-Admin-Secret':process.env.ADMIN_SECRET!});assert.equal(moderated.status,200);
   assert.equal((await get('/subjects/'+saved.subjectId)).status,404);assert.equal((await context().admin.query('SELECT count(*) FROM v2_public_lead_hides WHERE subject_id=$1',[saved.subjectId])).rows[0].count,'1');
  }finally{await context().admin.query('UPDATE users SET terms_accepted_at=now() WHERE id=$1',[context().accounts[1]]);}
  assert.equal((await action('/v2/actual-journeys',actual(saved.subjectId,subject.revision))).status,404);
 });
 test('public context: account/safety assertions fail closed and raw hosted clients cannot call restricted functions',async()=>{
  const saved=await create('Permission public route');
  assert.equal((await action('/v2/subjects/'+saved.subjectId+'/safety',{action:'block'},1,'POST',{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  const mismatch=await fetch(context().base+'/v2/subjects/'+saved.subjectId,{headers:{'X-Mabhazi-Account':context().accounts[1]}});assert.equal(mismatch.status,401);
  const db=context().admin;await db.query('SET ROLE mabhazi_api');try{await assert.rejects(db.query('INSERT INTO v2_route_report_blocks(blocker_id,blocked_user_id) VALUES($1,$2)',[context().accounts[1],context().accounts[0]]),e=>(e as {code:string}).code==='42501');}finally{await db.query('RESET ROLE');}
  for(const role of ['anon','authenticated']){if(!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rows.length)await db.query('CREATE ROLE '+role);await db.query('SET ROLE '+role);try{await assert.rejects(db.query('SELECT * FROM v2_public_lead_reports'),e=>(e as {code:string}).code==='42501');await assert.rejects(db.query('SELECT v2_api_route_report_action($1,$2,$3,NULL)',[context().accounts[1],saved.subjectId,'block']),e=>(e as {code:string}).code==='42501');}finally{await db.query('RESET ROLE');}}
 });
 test('public context: text discovery is literal and returns real city/subject identities, never generated matches',async()=>{
  const saved=await create('Literal lookup bus');const result=await get('/search?fromCity=Public%20origin&toCity=Public%20destination');assert.equal(result.status,200);const items=SearchV2RoutesResponse.parse(result.value).items;assert.ok(items.length>0);assert.ok(items.every(row=>row.origin.id===cityIds![0]&&row.destination.id===cityIds![1]));assert.equal(SearchV2RoutesResponse.parse((await get('/search?fromCity=%25')).value).items.length,0);assert.equal((await get('/search')).status,200);
 });

 test('public context: browser preflight permits only the existing trusted origin and declared safety header',async()=>{
  const response=await fetch(context().base+'/v2/actual-journeys',{method:'OPTIONS',headers:{Origin:'https://mabhazi.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type,Authorization,X-Mabhazi-Account,X-Mabhazi-Blocked-Contributors'}});assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'https://mabhazi.com');assert.ok(response.headers.get('access-control-allow-headers')?.toLowerCase().includes('x-mabhazi-blocked-contributors'));
  const denied=await fetch(context().base+'/v2/actual-journeys',{method:'OPTIONS',headers:{Origin:'https://untrusted.invalid','Access-Control-Request-Method':'POST'}});assert.equal(denied.headers.get('access-control-allow-origin'),null);
 });

}
