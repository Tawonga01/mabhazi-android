import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;connectionString:string;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerAssessmentWorkerTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 const claim=async()=>(await q('SELECT to_jsonb(v2_worker_claim_assess()) w')).rows[0].w;
 const finish=async(w:Record<string,unknown>)=>(await q('SELECT v2_worker_finish_assess($1,$2) r',[w.id,w.lease_token])).rows[0].r;
 const counts=async(id:string)=>(await q(`SELECT (SELECT count(*) FROM v2_field_assessments WHERE subject_id=$1) assessments,
  (SELECT count(*) FROM v2_field_decisions WHERE subject_id=$1) decisions,(SELECT revision FROM v2_subjects WHERE id=$1) revision`,[id])).rows[0];
 const today=async()=>(await q("SELECT to_char((statement_timestamp()-interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD') d")).rows[0].d as string;
 async function fresh(){
  await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=clock_timestamp() WHERE id=$1",[context().user]);
  const body={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:context().origin,destinationCityId:context().destination,departureTime:'07:00',operator:{name:'Assessment test operator'}}},observations:[]};
  return (await q('SELECT v2_api_submit_minimum_lead($1,$2,$3) r',[context().user,'2026-09-12',body])).rows[0].r;
 }
 async function add(id:string,field='fare.quoted',value:unknown={amount:'25.00',currency:'USD'},scope:unknown={},owner=context().user,basis='unprovided',date:string|null=null,source?:string){
  const c=(await q("INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,gen_random_uuid(),'1.0','route_detail',repeat('a',64),'{}',$2) RETURNING id",[owner,id])).rows[0].id;
  const o=(await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
   VALUES($1,$2,$3,$4,$5,v2_assessment_hash($5),v2_assessment_hash($4),$6,$7) RETURNING id`,[c,id,field,value,scope,basis,date])).rows[0].id;
  if(source)await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')",[o,source]);
  return o as string;
 }
 const scope=async(extra:Record<string,unknown>={})=>({schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:context().origin,destinationCityId:context().destination},passengerCategory:'adult',ticketBasis:'one_way',paymentMethod:'cash',luggageIncluded:true,timeBasis:'scheduled',quotationDate:await today(),...extra});
 async function enqueue(id:string){
  await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='assess' AND state='pending'");
  return (await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) SELECT 'assess',id,input_generation,'evidence/1',gen_random_uuid() FROM v2_subjects WHERE id=$1 RETURNING *",[id])).rows[0];
 }
 const read=async(id:string,field:string,s:unknown={})=>(await q('SELECT v2_read_field($1,$2,v2_assessment_hash($3)) r',[id,field,s])).rows[0].r;
 async function denied(action:()=>Promise<unknown>,code='42501'){
  await q('SAVEPOINT invalid_assessment_worker');try{await assert.rejects(action,(e:unknown)=>e instanceof Error&&'code'in e&&e.code===code);}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_assessment_worker');await q('RELEASE SAVEPOINT invalid_assessment_worker');}
 }
 test('assessment worker: real intake through normalisation and association reaches provisional scoped fields',async()=>{
  const r=await fresh();await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE subject_id<>$1 AND state='pending'",[r.subjectId]);
  await q('SELECT v2_worker_drain_normalise(20)');await q('SELECT v2_worker_drain_associate(20)');
  const run=(await q('SELECT v2_worker_drain_assess(20) r')).rows[0].r;assert.ok(run.done>=1);assert.equal(run.failedAttempts,0);
  assert.equal((await read(r.subjectId,'operator.reported')).value.name,'Assessment test operator');
  const time=await read(r.subjectId,'departure.reported');assert.equal(time.value.time,'07:00');assert.equal(time.publication,'provisional');assert.equal(time.freshness,'unknown');assert.equal(time.support,'reported');
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='refresh_tasks'",[r.subjectId])).rows[0].n,'1');
  assert.equal((await q('SELECT count(*) n FROM v2_public_lead_reports WHERE subject_id=$1',[r.subjectId])).rows[0].n,'1');
  assert.equal((await q('SELECT initial_response FROM v2_receipts WHERE contribution_id=$1',[r.contributionId])).rows[0].initial_response.publicationStatus,'pending');
 });
 test('assessment worker: duplicate jobs reuse current assessments, decisions and subject revision',async()=>{
  const r=await fresh();await enqueue(r.subjectId);await finish(await claim());const before=await counts(r.subjectId);
  await enqueue(r.subjectId);await finish(await claim());assert.deepEqual(await counts(r.subjectId),before);
  // A later evidence-time boundary can require new tasks at the same generation.
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='refresh_tasks'",[r.subjectId])).rows[0].n,'2');
 });
 test('assessment worker: same-account repeats cannot manufacture fare corroboration',async()=>{
  const r=await fresh(),s=await scope();for(let i=0;i<3;i++)await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s);
  await enqueue(r.subjectId);await finish(await claim());const f=await read(r.subjectId,'fare.quoted',s);
  assert.equal(f.value.amount,'25');assert.equal(f.support,'reported');assert.equal(f.candidates[0].contributors,1);assert.equal(f.freshness,'current');
  assert.ok(!JSON.stringify(f).includes('witnesses'));assert.equal(f.publication,'provisional');
 });
 test('assessment worker: one field update preserves the fare evidence date instead of refreshing it',async()=>{
  const r=await fresh(),s=await scope({quotationDate:'2020-01-01'});await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s,context().user,'observed_sign','2020-01-01');
  await enqueue(r.subjectId);await finish(await claim());const before=await read(r.subjectId,'fare.quoted',s);assert.equal(before.freshness,'recheck_due');
  await add(r.subjectId,'boarding.pickup',{cityId:context().origin,name:'New pickup'},{});await enqueue(r.subjectId);await finish(await claim());
  const after=await read(r.subjectId,'fare.quoted',s);assert.equal(after.freshness,'recheck_due');assert.equal(after.candidates[0].newestDate,before.candidates[0].newestDate);
 });
 test('assessment worker: conflicting current quotes open one managed case and withhold selection',async()=>{
  const r=await fresh(),s=await scope(),d=await today();for(const [owner,amount]of [[context().user,'25.00'],[context().other,'30.00']])await add(r.subjectId,'fare.quoted',{amount,currency:'USD'},s,owner,'observed_sign',d);
  await enqueue(r.subjectId);await finish(await claim());const f=await read(r.subjectId,'fare.quoted',s);assert.equal(f.dispute,'open');assert.equal(f.value,null);assert.equal(f.publication,'withheld');assert.equal(f.candidates.length,2);
  await enqueue(r.subjectId);await finish(await claim());assert.equal((await q('SELECT count(*) n FROM v2_field_review_threads WHERE subject_id=$1',[r.subjectId])).rows[0].n,'1');
 });
 test('assessment worker: different currency, passenger or date contexts remain separate',async()=>{
  const r=await fresh(),a=await scope(),b=await scope({passengerCategory:'child'}),c=await scope({quotationDate:'2020-01-01'});
  await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},a);await add(r.subjectId,'fare.quoted',{amount:'20.00',currency:'ZAR'},a);await add(r.subjectId,'fare.quoted',{amount:'10.00',currency:'USD'},b);await add(r.subjectId,'fare.quoted',{amount:'5.00',currency:'USD'},c);
  await enqueue(r.subjectId);await finish(await claim());const f=await read(r.subjectId,'fare.quoted',a);assert.equal(f.dispute,'none');assert.equal(f.value,null);assert.equal(f.candidates.length,2);assert.equal((await read(r.subjectId,'fare.quoted',b)).value.amount,'10');
 });
 test('assessment worker: paid fare stays historical and does not select a current route price',async()=>{
  const beforeOther=(await q("SELECT count(*) n FROM v2_current_fields WHERE field_key LIKE 'fare.%'")).rows[0].n;
  const id=(await q("INSERT INTO v2_subjects(kind) VALUES('actual_journey') RETURNING id")).rows[0].id;await q('INSERT INTO v2_actual_journeys(subject_id) VALUES($1)',[id]);
  const s=await scope({timeBasis:'actual',quotationDate:undefined,serviceDate:'2020-01-01'});await add(id,'fare.paid',{amount:'0.00',currency:'USD'},s,context().user,'travelled','2020-01-01');
  await enqueue(id);assert.equal(await finish(await claim()),'done');const f=await read(id,'fare.paid',s);assert.equal(f.value.amount,'0');assert.equal(f.freshness,'unknown');assert.equal(f.candidates[0].temporalClass,'historical');assert.equal(f.support,'reported');
  assert.equal((await q('SELECT count(*) n FROM v2_current_fields WHERE subject_id<>$1 AND field_key LIKE \'fare.%\'',[id])).rows[0].n,beforeOther);
 });
 test('assessment worker: large scope sets continue without exhausting the failure budget',async()=>{
  const r=await fresh();for(let i=0;i<21;i++)await add(r.subjectId,'fare.quoted',{amount:String(i)+'.00',currency:'USD'},await scope({passengerCategory:'other',passengerLabel:'Category '+i}));
  const job=await enqueue(r.subjectId);let w=await claim();assert.equal(await finish(w),'continued');let j=(await q('SELECT * FROM v2_jobs WHERE id=$1',[job.id])).rows[0];assert.equal(j.max_attempts,9);assert.equal(j.attempt,1);
  w=await claim();assert.equal(await finish(w),'continued');w=await claim();assert.equal(await finish(w),'done');assert.equal((await counts(r.subjectId)).assessments,'23');
 });
 test('assessment worker: wrong tokens and expired leases cannot renew, fail or commit',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();assert.equal(await finish({...w,lease_token:randomUUID()}),'lease_lost');
  await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);assert.equal(await finish(w),'lease_lost');
  assert.equal((await q('SELECT v2_worker_heartbeat_assess($1,$2) r',[w.id,w.lease_token])).rows[0].r,false);assert.equal((await q("SELECT v2_worker_fail_assess($1,$2,'processing_error') r",[w.id,w.lease_token])).rows[0].r,false);assert.equal((await counts(r.subjectId)).assessments,'0');
 });
 test('assessment worker: a crashed committed claim is reclaimed with a fresh fenced token',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const old=await claim();await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);const newer=await claim();assert.equal(newer.id,old.id);assert.notEqual(newer.lease_token,old.lease_token);assert.equal(await finish(old),'lease_lost');assert.equal(await finish(newer),'done');assert.equal(newer.attempt,2);
 });
 test('assessment worker: rollback after field effects preserves recoverable lease and no downstream acknowledgement',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q('SAVEPOINT interrupted_assessment');await finish(w);await q('ROLLBACK TO SAVEPOINT interrupted_assessment');await q('RELEASE SAVEPOINT interrupted_assessment');
  assert.equal((await counts(r.subjectId)).assessments,'0');assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[w.id])).rows[0].n,'0');assert.equal(await finish(w),'done');assert.equal(await finish(w),'lease_lost');
 });
 test('assessment worker: expiry during a field write rolls back all effects', {timeout:10000},async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q("CREATE FUNCTION assessment_slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1);RETURN NEW;END;$$");await q('CREATE TRIGGER assessment_slow BEFORE INSERT ON v2_field_decisions FOR EACH ROW EXECUTE FUNCTION assessment_slow_insert()');await q("UPDATE v2_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1",[w.id]);
  await denied(()=>finish(w),'40001');assert.equal((await counts(r.subjectId)).assessments,'0');assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[w.id])).rows[0].n,'0');
 });
 test('assessment worker: generation changes supersede old work and process the current input',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q('UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1',[r.subjectId]);assert.equal(await finish(w),'superseded');assert.equal((await counts(r.subjectId)).assessments,'0');assert.equal(await finish(await claim()),'done');
 });
 test('assessment worker: retired subjects never produce fields or resurrect normalised reports',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[r.subjectId]);assert.equal(await finish(w),'superseded');assert.equal((await counts(r.subjectId)).assessments,'0');
 });
 test('assessment worker: withdrawal invalidates reads immediately and recomputes without the old fare',async()=>{
  const r=await fresh(),s=await scope();const o=await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s);await enqueue(r.subjectId);await finish(await claim());
  await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().user,o,randomUUID()]);assert.equal((await read(r.subjectId,'fare.quoted',s)).status,'recheck_required');assert.equal((await q('SELECT v2_worker_drain_assess(20) r')).rows[0].r.failedAttempts,0);const f=await read(r.subjectId,'fare.quoted',s);assert.equal(f.value,null);assert.deepEqual(f.candidates,[]);
 });
 test('assessment worker: account erasure redacts copied results and fences the old lease',async()=>{
  const r=await fresh();await enqueue(r.subjectId);await finish(await claim());await enqueue(r.subjectId);const w=await claim();await q('SET LOCAL ROLE mabhazi_api');await q('DELETE FROM users WHERE id=$1',[context().user]);await q('RESET ROLE');
  assert.equal((await read(r.subjectId,'departure.reported')).status,'recheck_required');assert.ok(['lease_lost','superseded'].includes(await finish(w)));assert.equal((await q('SELECT count(*) n FROM v2_field_assessments WHERE subject_id=$1 AND NOT erased',[r.subjectId])).rows[0].n,'0');await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('assessment worker: unsupported policies and future jobs remain untouched',async()=>{
  const r=await fresh();await enqueue(r.subjectId);await q("UPDATE v2_jobs SET policy_version='evidence/unsupported' WHERE subject_id=$1 AND kind='assess'",[r.subjectId]);assert.equal(await claim(),null);
  await enqueue(r.subjectId);await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE subject_id=$1 AND kind='assess'",[r.subjectId]);assert.equal(await claim(),null);
 });
 test('assessment worker: eight failures are visible and owner retry preserves lifetime attempts',async()=>{
  const r=await fresh(),j=await enqueue(r.subjectId);for(let i=0;i<8;i++){const w=await claim();await q('SELECT v2_worker_fail_assess($1,$2,$3)',[w.id,w.lease_token,'private://not-recorded']);await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[j.id]);}
  assert.equal(await claim(),null);const h=(await q('SELECT v2_worker_health() h')).rows[0].h;assert.ok(h.failedJobs.some((x:{id:string})=>x.id===j.id));assert.equal(h.assess.failed,1);assert.ok(!JSON.stringify(h).includes('private://'));
  assert.equal((await q('SELECT v2_worker_retry_assess($1) r',[j.id])).rows[0].r,true);const w=await claim();assert.equal(w.attempt,9);assert.equal(await finish(w),'done');
 });
 test('assessment worker: backend can only use fenced entry points, with no evaluator or retry authority',async()=>{
  const r=await fresh();await enqueue(r.subjectId);await q('SET LOCAL ROLE mabhazi_api');assert.equal((await q('SELECT v2_worker_drain_assess(1) r')).rows[0].r.done,1);
  await denied(()=>q('SELECT v2_worker_retry_assess(gen_random_uuid())'));await denied(()=>q('SELECT v2_worker_assessment_scopes($1)',[r.subjectId]));await denied(()=>q('SELECT v2_process_field_assessment(gen_random_uuid())'));await denied(()=>q("UPDATE v2_jobs SET state='done' WHERE subject_id=$1",[r.subjectId]));await q('RESET ROLE');
 });
 test('assessment worker: hosted clients and PUBLIC cannot invoke the security-definer worker',async()=>{
  for(const role of ['anon','authenticated']){
   if(!(await q('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)continue;
   const p=(await q("SELECT has_function_privilege($1,'public.v2_worker_drain_assess(integer)','EXECUTE') allowed",[role])).rows[0];assert.equal(p.allowed,false);
  }
  assert.equal((await q("SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) acl WHERE p.oid='public.v2_worker_drain_assess(integer)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') allowed")).rows[0].allowed,false);
 });
 test('assessment worker: shared documents do not corroborate, while independent dated source footprints can',async()=>{
  const r=await fresh(),s=await scope(),d=await today();const shared=(await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,'document',$2) RETURNING id",[context().user,d])).rows[0].id;
  const copied=(await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,'document',$2) RETURNING id",[context().other,d])).rows[0].id;
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING",[context().other]);
  const sourceCase=(await q('SELECT v2_open_source_case($1,$2,$3) id',[context().other,shared,copied])).rows[0].id;
  await q("SELECT v2_review_sources($1,$2,1,(SELECT revision FROM v2_source_graph WHERE id),'same_origin','source_inspected',NULL,$3,'source/1',NULL)",[context().other,sourceCase,randomUUID()]);
  await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s,context().user,'observed_sign',d,shared);await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s,context().other,'observed_sign',d,copied);
  await enqueue(r.subjectId);await finish(await claim());let f=await read(r.subjectId,'fare.quoted',s);assert.equal(f.support,'reported');assert.equal(f.candidates[0].contributors,2);
  const independent=(await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,'document',$2) RETURNING id",[context().other,d])).rows[0].id;await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s,context().other,'observed_sign',d,independent);
  await enqueue(r.subjectId);await finish(await claim());f=await read(r.subjectId,'fare.quoted',s);assert.equal(f.support,'corroborated');assert.equal(f.publication,'provisional');assert.equal(f.candidates[0].contributors,2);
  await q('DELETE FROM v2_sources WHERE id=$1',[independent]);assert.equal((await read(r.subjectId,'fare.quoted',s)).status,'recheck_required');assert.equal((await q('SELECT v2_worker_drain_assess(20) r')).rows[0].r.failedAttempts,0);assert.equal((await read(r.subjectId,'fare.quoted',s)).support,'reported');
 });
 test('assessment worker: elapsed validity is refused on read and its overdue durable job recomputes',async()=>{
  const r=await fresh(),s=await scope({quotationDate:'2020-01-01'});await add(r.subjectId,'fare.quoted',{amount:'25.00',currency:'USD'},s,context().user,'observed_sign','2020-01-01');
  const a=(await q("SELECT v2_assess_field($1,'fare.quoted',v2_assessment_hash($2),$2,s.revision,s.input_generation,g.revision,'2020-01-02T12:00:00Z',gen_random_uuid()) id FROM v2_subjects s CROSS JOIN v2_source_graph g WHERE s.id=$1",[r.subjectId,s])).rows[0].id;await q('SELECT v2_process_field_assessment($1)',[a]);assert.equal((await read(r.subjectId,'fare.quoted',s)).status,'recheck_required');
  await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='assess' AND state='pending' AND subject_id<>$1",[r.subjectId]);const w=await claim();assert.ok(w);assert.equal(await finish(w),'done');const f=await read(r.subjectId,'fare.quoted',s);assert.equal(f.status,'assessed');assert.equal(f.freshness,'recheck_due');assert.equal(f.candidates[0].newestDate,'2020-01-01');
 });
 test('assessment worker: invalid drain bounds reject without consuming jobs',async()=>{
  const r=await fresh();await enqueue(r.subjectId);for(const limit of [null,0,21])await denied(()=>q('SELECT v2_worker_drain_assess($1)',[limit]),'23514');assert.equal((await counts(r.subjectId)).assessments,'0');
 });
 for(const isolation of ['READ COMMITTED','REPEATABLE READ'])test('assessment worker: a concurrent generation change fences effects at '+isolation,{timeout:15000},async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q('COMMIT');const writer=new pg.Client({connectionString:context().connectionString}),worker=new pg.Client({connectionString:context().connectionString});await Promise.all([writer.connect(),worker.connect()]);
  try{await writer.query('BEGIN');await worker.query('BEGIN ISOLATION LEVEL '+isolation);await worker.query("SET LOCAL statement_timeout='5s'");await worker.query('SELECT count(*) FROM v2_subjects');await writer.query('UPDATE v2_transport_guard SET toggle=NOT toggle WHERE id');await writer.query('UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1',[r.subjectId]);
   const pending=worker.query('SELECT v2_worker_finish_assess($1,$2) r',[w.id,w.lease_token]).then(v=>({r:v.rows[0].r,code:null}),e=>({r:null,code:e.code}));await writer.query('COMMIT');const result=await pending;
   if(isolation==='READ COMMITTED'){assert.equal(result.r,'superseded');await worker.query('COMMIT');}else{assert.equal(result.code,'40001');await worker.query('ROLLBACK');}assert.equal((await counts(r.subjectId)).assessments,'0');
  }finally{await writer.query('ROLLBACK').catch(()=>{});await worker.query('ROLLBACK').catch(()=>{});await Promise.all([writer.end(),worker.end()]);await q('BEGIN');}
 });
 test('assessment worker: separate connections cannot claim the same committed job',{timeout:15000},async()=>{
  const r=await fresh(),job=await enqueue(r.subjectId);await q('COMMIT');
  const a=new pg.Client({connectionString:context().connectionString}),b=new pg.Client({connectionString:context().connectionString});await Promise.all([a.connect(),b.connect()]);
  try{await a.query('BEGIN');await b.query('BEGIN');const first=(await a.query('SELECT to_jsonb(v2_worker_claim_assess()) w')).rows[0].w;assert.equal(first.id,job.id);
   const second=(await b.query('SELECT to_jsonb(v2_worker_claim_assess()) w')).rows[0].w;assert.equal(second,null);await b.query('COMMIT');await a.query('ROLLBACK');
   assert.equal((await q('SELECT to_jsonb(v2_worker_claim_assess()) w')).rows[0].w.id,job.id);
  }finally{await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});await Promise.all([a.end(),b.end()]);await q('BEGIN');}
 });
}
