import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type pg from 'pg';
import { GetV2SubjectResponse, SearchV2RoutesResponse } from '@workspace/api-zod';

type Context={admin:pg.Client;accounts:string[];tokens:string[];base:string};
export function registerPublicRouteTests(context:()=>Context){
 let cityIds:number[]|undefined;
 async function cities(){if(!cityIds)cityIds=(await context().admin.query("INSERT INTO cities(name,place_type) VALUES('Public origin fixture','city'),('Public destination fixture','city') RETURNING id")).rows.map(row=>row.id);return cityIds;}
 async function create(name='Public reported bus',time='08:00',reverse=false,account=0){
  const pair=await cities(),clientSubmissionId=randomUUID();
  const response=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+context().tokens[account],'X-Mabhazi-Account':context().accounts[account]},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId,entrySurface:'contribute_tab',target:{newLead:{originCityId:pair[reverse?1:0],destinationCityId:pair[reverse?0:1],operator:{name},departureTime:time}},observations:[]})});
  assert.equal(response.status,200);return {...await response.json() as {subjectId:string;contributionId:string},clientSubmissionId};
 }
 async function get(path:string,blocked?:unknown){const response=await fetch(context().base+'/v2'+path,{headers:blocked===undefined?{}:{'X-Mabhazi-Blocked-Contributors':typeof blocked==='string'?blocked:JSON.stringify(blocked)}});return{status:response.status,value:await response.json(),headers:response.headers};}
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
  assert.equal(subject.kind,'lead');assert.equal(subject.publicationStatus,'details_needed');assert.equal(subject.timedDepartureEligible,false);assert.equal(subject.contributionTargetEligible,false);
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
  const actor=randomUUID(),token=randomUUID(),account=context().accounts.length;
  context().accounts.push(actor);context().tokens.push(token);
  await context().admin.query("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',now())",[actor]);
  await context().admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:actor},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  const other=await create('Account erased report','08:00',false,account);assert.equal((await get('/subjects/'+other.subjectId)).status,200);
  await context().admin.query('DELETE FROM users WHERE id=$1',[actor]);assert.equal((await get('/subjects/'+other.subjectId)).status,404);

 });
 test('public route read: reviewed reassignment hides the original lead without fabricating a service link',async()=>{
  const a=await create('Assignment bus'),b=await create('Assignment bus'),db=context().admin,o=await observation(a.subjectId),actor=context().accounts[1];
  const state=async(id:string)=>(await db.query('SELECT revision,kind FROM v2_subjects WHERE id=$1',[id])).rows[0];
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
  assert.equal((await get('/subjects/'+a.subjectId)).status,404);assert.equal(GetV2SubjectResponse.parse((await get('/subjects/'+b.subjectId)).value).subject.kind,'lead');
 });
 test('public route read: a withheld core decision prevents re-exposing its original value',async()=>{
  const saved=await create('Withheld public report'),db=context().admin,o=await observation(saved.subjectId),id=randomUUID();
  const state=(await db.query('SELECT revision,input_generation FROM v2_subjects WHERE id=$1',[saved.subjectId])).rows[0];
  await db.query("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')",[id]);
  await db.query(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
   VALUES($1,$2,'departure.reported',$3,$4,1,$5,$6,$7,'reported','none','unknown','withheld',ARRAY['reported_evidence'],'evidence/1',$8)`,[id,saved.subjectId,o.scope_key,o.scope,state.revision,state.input_generation,o.value,'a'.repeat(64)]);
  await db.query("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')",[id,o.id]);
  await db.query('SELECT v2_apply_field_decision($1)',[id]);assert.equal((await get('/subjects/'+saved.subjectId)).status,404);
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
}
