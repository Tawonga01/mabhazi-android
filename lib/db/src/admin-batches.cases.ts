import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerAdminBatchTests(context:()=>Context){
 const q=(text:string,values:unknown[]=[])=>context().db.query(text,values);
 const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
 async function fixture(){
  const {user,other,corridor,origin,destination}=context(),subject=randomUUID(),contribution=randomUUID();
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture') ON CONFLICT DO NOTHING",[other]);
  await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[subject]);
  await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
   VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,$4,$5)`,[contribution,user,'a'.repeat(64),{target:{newLead:{originCityId:origin,destinationCityId:destination,operator:{name:'Batch fixture'},departureTime:'08:00'}}},subject]);
  await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Batch fixture',$3)",[subject,corridor,contribution]);
  for(const [field,value] of [['operator.reported',{name:'Batch fixture'}],['departure.reported',{time:'08:00',basis:'scheduled'}]] as const){
   const o=(await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
    VALUES($1,$2,$3,$4,'{}',v2_assessment_hash('{}'),v2_assessment_hash($4::jsonb),'observed_sign',$5) RETURNING id`,[contribution,subject,field,value,day])).rows[0].id;
   const source=(await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,'firsthand',$2) RETURNING id",[user,day])).rows[0].id;
   await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')",[o,source]);
  }
  for(const field of ['operator.reported','departure.reported']){
   const s=(await q('SELECT revision,input_generation FROM v2_subjects WHERE id=$1',[subject])).rows[0];
   const assessment=(await q("SELECT v2_assess_field($1,$2,v2_assessment_hash('{}'),'{}',$3,$4,(SELECT revision FROM v2_source_graph WHERE id),statement_timestamp(),$5) id",[subject,field,s.revision,s.input_generation,randomUUID()])).rows[0].id;
   await q('SELECT v2_process_field_assessment($1)',[assessment]);
  }
  return {subject,contribution};
 }
 type Fixture=Awaited<ReturnType<typeof fixture>>;
 async function item(f:Fixture,field='operator.reported'){
  const s=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[f.subject])).rows[0];
  const core=field.startsWith('route.');
  const o=core?null:(await q(`SELECT o.id,s.revision observation_revision,t.revision target_revision,d.assessment_id
   FROM v2_observations o JOIN v2_observation_states s ON s.observation_id=o.id JOIN v2_observation_targets t ON t.observation_id=o.id
   LEFT JOIN v2_current_fields cf ON cf.subject_id=o.original_subject_id AND cf.field_key=o.field_key AND cf.scope_key=o.scope_key
   LEFT JOIN v2_field_decisions d ON d.id=cf.field_decision_id WHERE o.contribution_id=$1 AND o.field_key=$2`,[f.contribution,field])).rows[0];
  return {routeId:f.subject,subjectId:f.subject,contributionId:f.contribution,observationId:o?.id??null,fieldKey:field,
   subjectRevision:String(s.revision),observationRevision:o?String(o.observation_revision):null,targetRevision:o?String(o.target_revision):null,
   assessmentId:o?.assessment_id??null,caseRevision:'0'};
 }
 const apply=async(items:unknown[],request=randomUUID(),operation='approve',reason='reports_reviewed')=>(await q('SELECT v2_api_admin_property_batch($1,$2,$3) r',[context().other,request,{operation,reason,items}])).rows[0].r;
 async function invalid(sql:string,values:unknown[],codes=['23514']){
  await q('SAVEPOINT invalid_admin_batch');
  try{await assert.rejects(q(sql,values),(error:unknown)=>{assert.ok(error instanceof Error&&'code' in error);assert.ok(codes.includes(String(error.code)),String(error.code)+': '+error.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_admin_batch');await q('RELEASE SAVEPOINT invalid_admin_batch');}
 }
 test('admin batches: restricted backend can call only fenced facades and cannot forge history',async()=>{
  const f=await fixture(),i=await item(f);await q('SET LOCAL ROLE mabhazi_api');
  await invalid('SELECT v2_admin_require($1)',[context().other],['42501']);
  for(const table of ['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads'])await invalid('DELETE FROM '+table,[],['42501']);
  const r=await apply([i]);assert.equal(r.items[0].outcome,'approved');await q('RESET ROLE');
 });
 test('admin batches: ordinary account, reviewer-only, revoked and missing actors fail closed',async()=>{
  const f=await fixture(),i=await item(f),body={operation:'approve',reason:'reports_reviewed',items:[i]};
  for(const actor of [null,context().user,randomUUID()])await invalid('SELECT v2_api_admin_property_batch($1,$2,$3)',[actor,randomUUID(),body],['42501']);
  await q("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL",[context().other]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture')",[context().other]);
  await invalid('SELECT v2_api_admin_property_batch($1,$2,$3)',[context().other,randomUUID(),body],['42501']);
 });
 test('admin batches: one observed property uses existing review resolution and preserves original values',async()=>{
  const f=await fixture(),i=await item(f),before=(await q('SELECT value,scope FROM v2_observations WHERE id=$1',[i.observationId])).rows[0];
  const r=await apply([i]);assert.equal(r.items[0].outcome,'approved');
  assert.deepEqual((await q('SELECT value,scope FROM v2_observations WHERE id=$1',[i.observationId])).rows[0],before);
  const d=(await q('SELECT * FROM v2_field_resolutions WHERE review_id=$1',[r.items[0].reviewId])).rows[0];assert.equal(d.chosen_observation_id,i.observationId);
  assert.equal((await q("SELECT count(*) FROM v2_review_decisions WHERE case_id IN(SELECT case_id FROM v2_field_review_threads WHERE subject_id=$1 AND field_key='departure.reported')",[f.subject])).rows[0].count,'0');
 });
 test('admin batches: endpoint assertions have independent source-bound review threads, without invented observations',async()=>{
  const f=await fixture(),before=(await q('SELECT count(*) FROM v2_observations')).rows[0].count;
  const r=await apply([await item(f,'route.origin'),await item(f,'route.destination')]);
  assert.deepEqual(r.items.map((x:any)=>x.outcome),['approved','approved']);
  assert.equal((await q('SELECT count(*) FROM v2_observations')).rows[0].count,before);
  assert.equal((await q('SELECT count(*) FROM v2_admin_core_threads WHERE route_subject_id=$1',[f.subject])).rows[0].count,'2');
 });
 test('admin batches: exact request replay returns one receipt, changed body conflicts',async()=>{
  const f=await fixture(),i=await item(f),request=randomUUID(),a=await apply([i],request),b=await apply([i],request);
  assert.deepEqual(a,b);assert.equal((await q('SELECT count(*) FROM v2_admin_batch_items WHERE batch_id=$1',[request])).rows[0].count,'1');
  await invalid('SELECT v2_api_admin_property_batch($1,$2,$3)',[context().other,request,{operation:'approve',reason:'evidence_checked',items:[i]}]);
 });
 test('admin batches: stale second tab has an explicit unchanged outcome rather than a duplicate decision',async()=>{
  const f=await fixture(),i=await item(f);await apply([i]);
  const r=await apply([i]);assert.equal(r.items[0].outcome,'changed');assert.equal(r.items[0].reviewId,null);
 });
 test('admin batches: valid independent items proceed while a stale item stays pending',async()=>{
  const a=await fixture(),b=await fixture(),one=await item(a),two=await item(b);
  await q('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[a.subject]);
  const r=await apply([one,two]);assert.deepEqual(r.items.map((x:any)=>x.outcome),['changed','approved']);
 });
 test('admin batches: duplicate or empty selections create no batch and cannot hide a second influence',async()=>{
  const f=await fixture(),i=await item(f);
  for(const items of [[],[i,i]])await invalid('SELECT v2_api_admin_property_batch($1,$2,$3)',[context().other,randomUUID(),{operation:'approve',reason:'reports_reviewed',items}]);
 });
 test('admin batches: reversal appends history and preserves a separately reviewed property',async()=>{
  const f=await fixture(),r=await apply([await item(f)]),receipt=JSON.stringify(r);
  await apply([await item(f,'route.origin')]);
  const reviewId=r.items[0].reviewId,c=(await q('SELECT c.* FROM v2_review_cases c JOIN v2_review_decisions d ON d.case_id=c.id WHERE d.id=$1',[reviewId])).rows[0];
  const reverse={...await item(f),reviewId,caseRevision:String(c.revision)};
  assert.equal((await apply([reverse],randomUUID(),'reverse','decision_incorrect')).items[0].outcome,'reversed');
  assert.equal(JSON.stringify((await q('SELECT v2_api_admin_batch_receipt($1,$2) r',[context().other,r.id])).rows[0].r),receipt);
  assert.equal((await q("SELECT c.state FROM v2_admin_core_threads t JOIN v2_review_cases c ON c.id=t.case_id WHERE t.route_subject_id=$1 AND t.field_key='route.origin'",[f.subject])).rows[0].state,'resolved');
 });
 test('admin batches: source deletion redacts receipt references and cannot restore erased evidence',async()=>{
  const f=await fixture(),i=await item(f),r=await apply([i]);await q('DELETE FROM v2_contributions WHERE id=$1',[f.contribution]);
  const receipt=(await q('SELECT v2_api_admin_batch_receipt($1,$2) r',[context().other,r.id])).rows[0].r;
  assert.equal(receipt.items[0].observationId,null);assert.equal(receipt.items[0].detail,'erased');
  const fresh=await apply([i]);assert.equal(fresh.items[0].outcome,'changed');assert.equal(fresh.items[0].observationId,null);
 });
 test('admin batches: reviewer erasure redacts actor and request digest without rewriting child decisions',async()=>{
  const f=await fixture(),r=await apply([await item(f)]),actor=context().other;
  await q('DELETE FROM users WHERE id=$1',[actor]);
  const b=(await q('SELECT * FROM v2_admin_batches WHERE id=$1',[r.id])).rows[0];assert.equal(b.actor_user_id,null);assert.equal(b.request_digest,null);
  assert.equal((await q('SELECT actor_erased FROM v2_review_decisions WHERE id=$1',[r.items[0].reviewId])).rows[0].actor_erased,true);
 });
 test('admin batches: history is append-only even for a direct owner connection',async()=>{
  const f=await fixture(),r=await apply([await item(f)]);
  await invalid("UPDATE v2_admin_batches SET reason_code='evidence_changed' WHERE id=$1",[r.id]);
  await invalid("DELETE FROM v2_admin_batch_items WHERE batch_id=$1",[r.id]);
 });
 test('admin batches: 100 explicit reports share one receipt with independent endpoint decisions',async()=>{
  const items=[];for(let n=0;n<100;n++){const f=await fixture();items.push(await item(f,'route.origin'));}
  const r=await apply(items);assert.equal(r.items.length,100);assert.ok(r.items.every((x:any)=>x.outcome==='approved'));
  assert.equal(new Set(r.items.map((x:any)=>x.reviewId)).size,100);
 });
 test('admin batches: an old reversal preserves a newer review of the same property',async()=>{
  const f=await fixture(),first=await apply([await item(f,'route.origin')]);
  const revision=async()=>(await q("SELECT c.revision FROM v2_admin_core_threads t JOIN v2_review_cases c ON c.id=t.case_id WHERE t.route_subject_id=$1 AND t.field_key='route.origin'",[f.subject])).rows[0].revision;
  await apply([{...await item(f,'route.origin'),caseRevision:String(await revision()),reviewId:first.items[0].reviewId}],randomUUID(),'reverse','decision_incorrect');
  const newer=await apply([{...await item(f,'route.origin'),caseRevision:String(await revision())}]);assert.equal(newer.items[0].outcome,'approved');
  const old=await apply([{...await item(f,'route.origin'),caseRevision:String(await revision()),reviewId:first.items[0].reviewId}],randomUUID(),'reverse','decision_incorrect');
  assert.equal(old.items[0].outcome,'newer_decision_kept');assert.equal(old.items[0].reviewId,null);
 });
}
