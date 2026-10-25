import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;connectionString:string;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerPromptWorkerTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 const claim=async()=>(await q('SELECT to_jsonb(v2_worker_claim_tasks()) w')).rows[0].w;
 const finish=async(w:Record<string,unknown>)=>(await q('SELECT v2_worker_finish_tasks($1,$2) r',[w.id,w.lease_token])).rows[0].r;
 const tasks=async(id:string)=>(await q('SELECT * FROM v2_question_tasks WHERE subject_id=$1 ORDER BY registry_key,field_key,scope_key,id',[id])).rows;
 const active=async(id:string)=>(await tasks(id)).filter(x=>['open','paused'].includes(x.state));
 const today=async()=>(await q("SELECT to_char((statement_timestamp()-interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD') d")).rows[0].d as string;
 async function fresh(){
  await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=clock_timestamp() WHERE id=$1",[context().user]);
  const body={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:context().origin,destinationCityId:context().destination,departureTime:'07:00',operator:{name:'Synthetic question company'}}},observations:[]};
  return (await q('SELECT v2_api_submit_minimum_lead($1,$2,$3) r',[context().user,'2026-09-12',body])).rows[0].r;
 }
 async function enqueue(id:string){
  await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='refresh_tasks' AND state='pending'");
  return (await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) SELECT 'refresh_tasks',id,input_generation,'prompts/1',gen_random_uuid() FROM v2_subjects WHERE id=$1 RETURNING *",[id])).rows[0];
 }
 async function run(id:string){
  const job=await enqueue(id);let result='continued';
  for(let n=0;n<60&&result==='continued';n++){const w=await claim();assert.ok(w);assert.equal(w.id,job.id);result=await finish(w);}
  assert.equal(result,'done');return job;
 }
 async function add(id:string,field='boarding.pickup',value:unknown={cityId:context().origin,name:'Synthetic pickup'},scope:unknown={},owner=context().user,days=1){
  const c=(await q("INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,gen_random_uuid(),'1.0','route_detail',repeat('a',64),'{}',$2) RETURNING id",[owner,id])).rows[0].id;
  return (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
   VALUES($1,$2,$3,$4,$5,v2_assessment_hash($5),v2_assessment_hash($4),'observed_sign',current_date-$6::integer) RETURNING id`,[c,id,field,value,scope,days])).rows[0].id as string;
 }
 const fareScope=async(extra:Record<string,unknown>={})=>({schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:context().origin,destinationCityId:context().destination},passengerCategory:'adult',ticketBasis:'one_way',timeBasis:'actual',serviceDate:await today(),...extra});
 async function denied(action:()=>Promise<unknown>,code='42501'){
  await q('SAVEPOINT invalid_prompt_worker');try{await assert.rejects(action,(e:unknown)=>e instanceof Error&&'code'in e&&e.code===code);}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_prompt_worker');await q('RELEASE SAVEPOINT invalid_prompt_worker');}
 }
 test('task worker: real intake pipeline generates questions without inventing facts or invitations',async()=>{
  const r=await fresh();await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE subject_id<>$1 AND state='pending'",[r.subjectId]);
  await q('SELECT v2_worker_drain_normalise(20)');await q('SELECT v2_worker_drain_associate(20)');await q('SELECT v2_worker_drain_assess(20)');
  const before=(await q('SELECT count(*) n FROM v2_observations')).rows[0].n;
  const tick=(await q('SELECT v2_worker_drain_tasks(20) r')).rows[0].r;assert.ok(tick.done>=1);assert.equal(tick.failedAttempts,0);
  assert.deepEqual((await active(r.subjectId)).map(x=>x.registry_key),['clarify_time_basis','complete_pattern','identify_service','operating_days','pickup_place']);
  assert.equal((await q('SELECT count(*) n FROM v2_observations')).rows[0].n,before);assert.equal((await q('SELECT count(*) n FROM v2_prompt_invitations')).rows[0].n,'0');
  assert.equal((await q('SELECT count(*) n FROM v2_runs')).rows[0].n,'0');
 });
 test('task worker: no fare context, travel, preference, email or default fare is invented',async()=>{
  const r=await fresh();await run(r.subjectId);assert.ok((await active(r.subjectId)).length>0);
  assert.ok(!(await tasks(r.subjectId)).some(x=>x.field_key.startsWith('fare.')));
  for(const table of ['v2_prompt_preferences','v2_prompt_sessions','v2_prompt_requests','v2_prompt_events'])assert.equal((await q(`SELECT count(*) n FROM ${table}`)).rows[0].n,'0');
 });
 test('task worker: a replay preserves needed task identities and a paused task',async()=>{
  const r=await fresh();await run(r.subjectId);const before=await active(r.subjectId);await q("UPDATE v2_question_tasks SET state='paused' WHERE id=$1",[before[0].id]);
  await run(r.subjectId);const after=await active(r.subjectId);assert.deepEqual(after.map(x=>x.id),before.map(x=>x.id));assert.equal(after[0].state,'paused');
 });
 test('task worker: a current report satisfies the pickup question without claiming verification',async()=>{
  const r=await fresh();await run(r.subjectId);const old=(await active(r.subjectId)).find(x=>x.registry_key==='pickup_place');assert.ok(old);
  await add(r.subjectId);await run(r.subjectId);assert.ok(!(await active(r.subjectId)).some(x=>x.registry_key==='pickup_place'));
  const oldRow=(await tasks(r.subjectId)).find(x=>x.id===old.id);assert.ok(['satisfied','obsolete'].includes(oldRow!.state));
  assert.equal((await q('SELECT count(*) n FROM v2_field_resolutions')).rows[0].n,'0');
 });
 test('task worker: dated stale pickup creates a recheck while undated missing facts do not',async()=>{
  const r=await fresh();await add(r.subjectId,'boarding.pickup',undefined,{},context().user,400);await run(r.subjectId);
  assert.ok((await active(r.subjectId)).some(x=>x.registry_key==='confirm_current_fact'&&x.field_key==='boarding.pickup'));
  assert.ok(!(await active(r.subjectId)).some(x=>x.registry_key==='confirm_current_fact'&&x.field_key==='service.calendar'));
 });
 test('task worker: withdrawn old evidence does not justify stale invitations',async()=>{
  const r=await fresh(),o=await add(r.subjectId,'boarding.pickup',undefined,{},context().user,400);await run(r.subjectId);
  await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().user,o,randomUUID()]);await run(r.subjectId);
  assert.ok(!(await active(r.subjectId)).some(x=>x.registry_key==='confirm_current_fact'&&x.field_key==='boarding.pickup'));
 });
 test('task worker: future observations never count as a current or stale answer',async()=>{
  const r=await fresh();await add(r.subjectId,'boarding.pickup',undefined,{},context().user,-2);await run(r.subjectId);
  assert.ok((await active(r.subjectId)).some(x=>x.registry_key==='pickup_place'));assert.ok(!(await active(r.subjectId)).some(x=>x.registry_key==='confirm_current_fact'));
 });
 test('task worker: scoped current conflict produces a context task that still needs volunteered knowledge',async()=>{
  const id=(await q("INSERT INTO v2_subjects(kind) VALUES('stop') RETURNING id")).rows[0].id;await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Synthetic task terminal')",[id]);
  await add(id,'stop.location',{cityId:context().origin,name:'North terminal',precision:'named_place'});await add(id,'stop.location',{cityId:context().origin,name:'South terminal',precision:'named_place'},{},context().other);await run(id);
  const t=(await active(id)).find(x=>x.registry_key==='resolve_conflict_context');assert.ok(t);
  assert.equal((await q('SELECT v2_prompt_eligible($1,$2,$3) ok',[t.id,context().user,['at_stop']])).rows[0].ok,false);
  assert.equal((await q('SELECT v2_prompt_eligible($1,$2,$3) ok',[t.id,context().user,['at_stop','relevant_conflict']])).rows[0].ok,true);
 });
 test('task worker: exact paid-fare scopes retain dates and categories with no new default scope',async()=>{
  const r=await fresh(),a=await fareScope({serviceDate:'2020-01-01'}),b=await fareScope({serviceDate:'2020-01-02',passengerCategory:'child'});
  await add(r.subjectId,'fare.paid',{amount:'15',currency:'USD'},a,context().user,400);await add(r.subjectId,'fare.paid',{amount:'9',currency:'USD'},b,context().user,400);await run(r.subjectId);
  const fares=(await active(r.subjectId)).filter(x=>x.registry_key==='fare_paid');assert.equal(fares.length,2);assert.deepEqual(fares.map(x=>x.scope.serviceDate).sort(),['2020-01-01','2020-01-02']);
  assert.ok(fares.every(x=>x.scope.schemaVersion==='1.0'&&x.scope.segment.kind==='city_pair'));
  assert.equal((await q('SELECT v2_prompt_eligible($1,$2,$3) ok',[fares[0].id,context().user,['paid']])).rows[0].ok,false);
  assert.equal((await q('SELECT v2_prompt_eligible($1,$2,$3) ok',[fares[0].id,context().user,['travelled','paid']])).rows[0].ok,true);
  assert.equal((await q('SELECT v2_prompt_eligible($1,$2,$3) ok',[fares[0].id,context().other,['travelled','paid']])).rows[0].ok,false);
 });
 test('task worker: currencies are not collapsed into a false fare conflict',async()=>{
  const r=await fresh(),scope=await fareScope({timeBasis:'scheduled',serviceDate:undefined,quotationDate:await today()});
  await add(r.subjectId,'fare.quoted',{amount:'15',currency:'USD'},scope);await add(r.subjectId,'fare.quoted',{amount:'20',currency:'ZAR'},scope,context().other);await run(r.subjectId);
  assert.ok(!(await active(r.subjectId)).some(x=>x.registry_key==='resolve_conflict_context'&&x.field_key==='fare.quoted'));
 });
 test('task worker: invalid legacy fare task scope is retired rather than offered as a valid question',async()=>{
  const r=await fresh();await q("SELECT v2_prompt_put_task($1,'fare.paid','{}','fare_paid',s.input_generation) FROM v2_subjects s WHERE s.id=$1",[r.subjectId]);await run(r.subjectId);
  const bad=(await tasks(r.subjectId)).filter(x=>x.field_key==='fare.paid');assert.equal(bad.length,1);assert.equal(bad[0].state,'obsolete');
 });
 test('task worker: a bounded scan continues without exhausting its failure budget',async()=>{
  const r=await fresh(),j=await enqueue(r.subjectId),w=await claim();assert.equal(await finish(w),'continued');
  assert.equal((await q("SELECT count(*) n FROM v2_job_effects WHERE job_id=$1 AND stage='prompt-scope/1'",[j.id])).rows[0].n,'10');
  const saved=(await q('SELECT * FROM v2_jobs WHERE id=$1',[j.id])).rows[0];assert.equal(saved.max_attempts,9);assert.equal(saved.state,'pending');
  assert.equal(await finish(await claim()),'done');assert.equal((await q("SELECT count(*) n FROM v2_job_effects WHERE job_id=$1 AND stage='prompt-refresh/1'",[j.id])).rows[0].n,'1');
 });
 test('task worker: rollback removes all task/cursor effects and leaves the lease recoverable',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q('SAVEPOINT interrupted_tasks');await finish(w);await q('ROLLBACK TO SAVEPOINT interrupted_tasks');await q('RELEASE SAVEPOINT interrupted_tasks');
  assert.equal((await tasks(r.subjectId)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[w.id])).rows[0].n,'0');assert.equal(await finish(w),'continued');
 });
 test('task worker: wrong and expired tokens cannot commit, renew or fail a job',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();assert.equal(await finish({...w,lease_token:randomUUID()}),'lease_lost');
  await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);assert.equal(await finish(w),'lease_lost');
  assert.equal((await q('SELECT v2_worker_heartbeat_tasks($1,$2) r',[w.id,w.lease_token])).rows[0].r,false);assert.equal((await q("SELECT v2_worker_fail_tasks($1,$2,'processing_error') r",[w.id,w.lease_token])).rows[0].r,false);assert.equal((await tasks(r.subjectId)).length,0);
 });
 test('task worker: a crashed claim is reclaimed with a new fenced token',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const old=await claim();await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);const newer=await claim();assert.equal(newer.id,old.id);assert.notEqual(newer.lease_token,old.lease_token);assert.equal(await finish(old),'lease_lost');assert.equal(await finish(newer),'continued');assert.equal(newer.attempt,2);
 });
 test('task worker: expired lease during task insertion rolls back the complete effect set',{timeout:12000},async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q("CREATE FUNCTION task_slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2);RETURN NEW;END;$$");await q('CREATE TRIGGER task_slow BEFORE INSERT ON v2_question_tasks FOR EACH ROW EXECUTE FUNCTION task_slow_insert()');await q("UPDATE v2_jobs SET lease_until=clock_timestamp()+interval '0.1 second' WHERE id=$1",[w.id]);
  await denied(()=>finish(w),'40001');assert.equal((await tasks(r.subjectId)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[w.id])).rows[0].n,'0');
 });
 test('task worker: changed generation supersedes the old claim and regenerates current tasks',async()=>{
  const r=await fresh();await enqueue(r.subjectId);const w=await claim();await q('UPDATE v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=$1',[r.subjectId]);assert.equal(await finish(w),'superseded');assert.equal((await tasks(r.subjectId)).length,0);
  await run(r.subjectId);const generation=(await q('SELECT input_generation FROM v2_subjects WHERE id=$1',[r.subjectId])).rows[0].input_generation;assert.ok((await active(r.subjectId)).every(x=>x.input_generation===generation));
 });
 test('task worker: retirement obsoletes tasks and never resurrects them',async()=>{
  const r=await fresh();await run(r.subjectId);await enqueue(r.subjectId);const w=await claim();await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[r.subjectId]);assert.equal(await finish(w),'superseded');assert.deepEqual(await active(r.subjectId),[]);
 });
 test('task worker: observation erasure removes worker cursor digests, tasks and copied scopes',async()=>{
  const r=await fresh(),o=await add(r.subjectId);const j=await run(r.subjectId);assert.ok((await q('SELECT 1 FROM v2_job_effects WHERE job_id=$1',[j.id])).rowCount);
  await q('DELETE FROM v2_observations WHERE id=$1',[o]);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[j.id])).rows[0].n,'0');assert.equal((await tasks(r.subjectId)).length,0);
 });
 test('task worker: active generation change durably wakes tasks without waiting for another assessment',async()=>{
  const r=await fresh();await run(r.subjectId);await q('UPDATE v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=$1',[r.subjectId]);
  assert.equal((await q("SELECT count(*) n FROM v2_jobs j JOIN v2_subjects s ON s.id=j.subject_id WHERE s.id=$1 AND j.kind='refresh_tasks' AND j.policy_version='prompts/1' AND j.requested_generation=s.input_generation AND j.state='pending'",[r.subjectId])).rows[0].n,'1');assert.deepEqual(await active(r.subjectId),[]);
 });
 test('task worker: later assessments at the same generation create distinct refresh intents',async()=>{
  const r=await fresh();await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE subject_id<>$1 AND state='pending'",[r.subjectId]);await q('SELECT v2_worker_drain_normalise(20)');await q('SELECT v2_worker_drain_associate(20)');await q('SELECT v2_worker_drain_assess(20)');
  const before=(await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='refresh_tasks' AND policy_version='prompts/1'",[r.subjectId])).rows[0].n;
  await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) SELECT 'assess',id,input_generation,'evidence/1',gen_random_uuid() FROM v2_subjects WHERE id=$1",[r.subjectId]);await q('SELECT v2_worker_drain_assess(20)');
  assert.equal(Number((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='refresh_tasks' AND policy_version='prompts/1'",[r.subjectId])).rows[0].n),Number(before)+1);
 });
 test('task worker: evidence time boundaries create one idempotent future refresh per scan',async()=>{
  const r=await fresh();await add(r.subjectId);const j=await run(r.subjectId);const next=(await q("SELECT * FROM v2_jobs WHERE kind='refresh_tasks' AND policy_version='prompts/1' AND trigger_id=$1",[j.id])).rows;assert.equal(next.length,1);assert.equal(next[0].state,'pending');assert.ok(next[0].available_at>new Date());
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE trigger_id=$1 AND kind='refresh_tasks'",[j.id])).rows[0].n,'1');
 });
 test('task worker: unsupported policy and future jobs remain visible and untouched',async()=>{
  const r=await fresh(),j=await enqueue(r.subjectId);await q("UPDATE v2_jobs SET policy_version='affiliation/1' WHERE id=$1",[j.id]);assert.equal(await claim(),null);
  assert.ok(Number((await q('SELECT v2_worker_health() h')).rows[0].h.otherPendingStages)>=1);await enqueue(r.subjectId);await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='refresh_tasks' AND subject_id=$1",[r.subjectId]);assert.equal(await claim(),null);
 });
 test('task worker: exhausted failures stay visible with safe errors and owner-only retry',async()=>{
  const r=await fresh(),j=await enqueue(r.subjectId);for(let n=0;n<8;n++){const w=await claim();await q('SELECT v2_worker_fail_tasks($1,$2,$3)',[w.id,w.lease_token,'private://never-log-this']);await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[j.id]);}
  assert.equal(await claim(),null);const h=(await q('SELECT v2_worker_health() h')).rows[0].h;assert.equal(h.tasks.failed,1);assert.ok(h.failedJobs.some((x:{id:string})=>x.id===j.id));assert.ok(!JSON.stringify(h).includes('private://'));
  assert.equal((await q('SELECT v2_worker_retry_tasks($1) r',[j.id])).rows[0].r,true);assert.equal((await claim()).attempt,9);
 });
 test('task worker: backend has only fenced functions and cannot impersonate accounts or construct tasks',async()=>{
  const r=await fresh();await enqueue(r.subjectId);await q('SET LOCAL ROLE mabhazi_api');const tick=(await q('SELECT v2_worker_drain_tasks(1) r')).rows[0].r;assert.equal(tick.continued,1);
  await denied(()=>q('SELECT v2_worker_retry_tasks(gen_random_uuid())'));await denied(()=>q('SELECT v2_worker_task_scopes($1)',[r.subjectId]));await denied(()=>q("SELECT v2_prompt_put_task($1,'boarding.pickup','{}','pickup_place',1)",[r.subjectId]));await denied(()=>q("UPDATE v2_question_tasks SET state='satisfied' WHERE subject_id=$1",[r.subjectId]));await q('RESET ROLE');
 });
 test('task worker: hosted clients and PUBLIC cannot call the security-definer worker',async()=>{
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.v2_worker_drain_tasks(integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await q("SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='public.v2_worker_drain_tasks(integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') allowed")).rows[0].allowed,false);
 });
 test('task worker: refresh preserves global opt-out, unknown suppression and existing reservation budget',async()=>{
  const r=await fresh();await run(r.subjectId);const t=(await active(r.subjectId)).find(x=>x.registry_key==='pickup_place');assert.ok(t);
  const i=(await q("SELECT v2_prompt_reserve($1,$2,ARRAY['knows_route'],'route_detail',NULL,$3) id",[context().user,randomUUID(),r.subjectId])).rows[0].id;assert.ok(i);await q("SELECT v2_prompt_event($1,$2,$3,'unknown','UTC',NULL)",[context().user,i,randomUUID()]);await q('SELECT v2_prompt_set_preferences($1,1,false,ARRAY[]::text[])',[context().user]);
  const before=(await q('SELECT to_jsonb(p) r FROM v2_prompt_preferences p WHERE user_id=$1',[context().user])).rows;const budget=(await q('SELECT to_jsonb(p) r FROM v2_prompt_requests p WHERE user_id=$1',[context().user])).rows;
  await run(r.subjectId);assert.deepEqual((await q('SELECT to_jsonb(p) r FROM v2_prompt_preferences p WHERE user_id=$1',[context().user])).rows,before);assert.deepEqual((await q('SELECT to_jsonb(p) r FROM v2_prompt_requests p WHERE user_id=$1',[context().user])).rows,budget);
 });
}
