import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;connectionString:string;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerLeadAssociationTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 async function invalid(action:()=>Promise<unknown>,code='42501'){
  await q('SAVEPOINT association_reject');try{await assert.rejects(action,(e:unknown)=>e instanceof Error && 'code' in e && String(e.code)===code);}
  finally{await q('ROLLBACK TO SAVEPOINT association_reject');await q('RELEASE SAVEPOINT association_reject');}
 }
 async function subject(kind:string,id=randomUUID()){await q('SET CONSTRAINTS public.v2_subject_subtype DEFERRED');await q('INSERT INTO v2_subjects(id,kind) VALUES($1,$2)',[id,kind]);return id;}
 async function operator(){const id=await subject('operator');await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Same printed name')",[id]);return id;}
 async function fresh(options:{owner?:string;operatorId?:string;time?:string;reverse?:boolean;basis?:'actual'|'scheduled'}={}){
  const owner=options.owner||context().user;await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=clock_timestamp() WHERE id=$1",[owner]);
  const request={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{
   originCityId:options.reverse?context().destination:context().origin,destinationCityId:options.reverse?context().origin:context().destination,
   departureTime:options.time||'07:00',operator:options.operatorId?{id:options.operatorId}:{name:'Same printed name'}}},observations:[],...(options.basis?{leadContext:{timeBasis:options.basis}}:{})};
  // Public minimum capability stays name-only. Resolved/context fixtures use
  // the existing owner-only typed writer, without broadening that API grant.
  const sql=options.operatorId||options.basis?"SELECT v2_submit_lead($1,'2026-09-12',$2) r":"SELECT v2_api_submit_minimum_lead($1,'2026-09-12',$2) r";
  const receipt=(await q(sql,[owner,request])).rows[0].r;
  const normalise=(await q("SELECT * FROM v2_jobs WHERE contribution_id=$1 AND kind='normalise'",[receipt.contributionId])).rows[0];
  await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND kind='normalise' AND id<>$1",[normalise.id]);
  const w=(await q('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;assert.equal(w.id,normalise.id);
  assert.equal((await q('SELECT v2_worker_finish_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r,'done');
  const job=(await q("SELECT * FROM v2_jobs WHERE subject_id=$1 AND kind='associate' AND trigger_id=subject_id",[receipt.subjectId])).rows[0];
  return {...receipt,job};
 }
 async function focus(id:string){await q("UPDATE v2_jobs SET available_at=CASE WHEN id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END WHERE kind='associate' AND state='pending'",[id]);}
 const claim=async()=> (await q('SELECT to_jsonb(v2_worker_claim_associate()) w')).rows[0].w;
 const finish=async(w:Record<string,unknown>)=>(await q('SELECT v2_worker_finish_associate($1,$2) r',[w.id,w.lease_token])).rows[0].r;
 const candidates=async(id:string)=>(await q("SELECT * FROM v2_association_candidates WHERE from_subject_id=$1 AND rule_version='lead-association/1' ORDER BY to_subject_id,relation",[id])).rows;
 async function execute(r:{job:{id:string}}){await focus(r.job.id);const w=await claim();assert.equal(w.id,r.job.id);assert.equal(await finish(w),'done');return w;}
 async function decide(id:string,action:string){
  const c=(await q('SELECT * FROM v2_association_candidates WHERE id=$1',[id])).rows[0],d=randomUUID();
  const rev=(await q('SELECT id,revision FROM v2_subjects WHERE id=ANY($1::uuid[])',[[c.from_subject_id,c.to_subject_id]])).rows;
  await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'association')",[d]);
  await q(`INSERT INTO v2_association_decisions(id,candidate_id,action,previous_decision_id,actor_kind,reason_code,policy_version,expected_from_revision,expected_to_revision,expected_candidate_revision)
   VALUES($1,$2,$3,$4,'system','fixture_decision','lead-association/1',$5,$6,$7)`,[d,id,action,c.last_decision_id,rev.find(r=>r.id===c.from_subject_id).revision,rev.find(r=>r.id===c.to_subject_id).revision,c.revision]);
  await q('SELECT v2_apply_association_decision($1)',[d]);return d;
 }
 async function renormalise(id:string){
  const j=(await q("SELECT id FROM v2_jobs WHERE subject_id=$1 AND kind='normalise' AND policy_version='intake/1' AND state='pending' ORDER BY requested_generation DESC LIMIT 1",[id])).rows[0];
  await q("UPDATE v2_jobs SET available_at=CASE WHEN id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END WHERE kind='normalise' AND state='pending'",[j.id]);
  const w=(await q('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;assert.equal(w.id,j.id);assert.equal((await q('SELECT v2_worker_finish_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r,'done');
 }
 async function structure(op:string,departure=25200){
  const route=await subject('route');await q('INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)',[route,op]);
  const stops=[];for(const city of [context().origin,context().destination]){const id=await subject('stop');await q("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$2,'Fixture stop')",[id,city]);stops.push(id);}
  const p=await addPattern(route,stops),plan=await subject('service_plan');
  await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')",[plan,p]);
  const run=await subject('run');await q('INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,$4)',[run,plan,p,departure]);
  return {route,stops,p,plan,run};
 }
 async function addPattern(route:string,stops:string[],id=randomUUID()){
  await subject('pattern',id);await q('INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)',[id,route,context().corridor]);
  await q('INSERT INTO v2_pattern_versions(pattern_subject_id,version,stops_complete) VALUES($1,1,true)',[id]);
  for(let i=0;i<stops.length;i++)await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff) VALUES($1,1,$2,$3,'allowed','allowed')",[id,i,stops[i]]);
  await q('UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1',[id]);return id;
 }
 async function addPatterns(route:string,stops:string[],count:number){
  await q('SET CONSTRAINTS public.v2_subject_subtype DEFERRED');
  await q(`DO $$ DECLARE p uuid; BEGIN FOR n IN 1..${count} LOOP p:=gen_random_uuid();
   INSERT INTO v2_subjects(id,kind) VALUES(p,'pattern');
   INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES(p,'${route}','${context().corridor}',1);
   INSERT INTO v2_pattern_versions(pattern_subject_id,version,stops_complete) VALUES(p,1,true);
   INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff) VALUES(p,1,0,'${stops[0]}','allowed','allowed'),(p,1,1,'${stops[1]}','allowed','allowed');
   UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=p; END LOOP; END; $$`);
 }
 test('association worker: equal city pair and names yield explained corridor candidates only',async()=>{
  const a=await fresh(),b=await fresh({owner:context().other});const originals=(await q('SELECT id,value FROM v2_observations WHERE contribution_id=ANY($1::uuid[]) ORDER BY id',[[a.contributionId,b.contributionId]])).rows;
  await execute(a);const c=await candidates(a.subjectId);assert.equal(c.length,1);assert.equal(c[0].relation,'same_corridor');assert.equal(c[0].state,'pending');assert.ok(c[0].reason_codes.includes('operator_context_incomplete'));
  assert.equal((await q('SELECT count(*) n FROM v2_candidate_evidence WHERE candidate_id=$1',[c[0].id])).rows[0].n,'4');
  assert.deepEqual((await q('SELECT id,value FROM v2_observations WHERE contribution_id=ANY($1::uuid[]) ORDER BY id',[[a.contributionId,b.contributionId]])).rows,originals);
  assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE from_subject_id=$1',[a.subjectId])).rows[0].n,'0');assert.equal((await q('SELECT count(*) n FROM v2_current_fields WHERE subject_id=$1',[a.subjectId])).rows[0].n,'0');
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='assess' AND policy_version='evidence/1'",[a.subjectId])).rows[0].n,'1');
 });
 test('association worker: opposite directions never share a corridor candidate',async()=>{
  const a=await fresh(),b=await fresh({reverse:true});await execute(a);assert.equal((await candidates(a.subjectId)).some(c=>c.to_subject_id===b.subjectId),false);
 });
 test('association worker: known different operators keep corridor grouping but exclude service identity',async()=>{
  const op=await operator(),other=await operator(),s=await structure(other);const a=await fresh({operatorId:op});await execute(a);
  const c=await candidates(a.subjectId);assert.ok(c.some(c=>c.to_subject_id===s.p && c.reason_codes.includes('known_operators_differ')));assert.ok(!c.some(c=>c.to_subject_id===s.run));
 });
 test('association worker: equal printed names do not resolve a lead to known runs',async()=>{
  const s=await structure(await operator());const a=await fresh();await execute(a);assert.ok(!(await candidates(a.subjectId)).some(c=>c.to_subject_id===s.run));
 });
 test('association worker: known operator and exact clock yield review context, never a timetable',async()=>{
  const op=await operator(),s=await structure(op),a=await fresh({operatorId:op});await execute(a);
  const c=(await candidates(a.subjectId)).find(c=>c.to_subject_id===s.run);assert.ok(c);assert.equal(c.relation,'same_service');
  for(const reason of ['known_operator_equal','departure_clock_equal','time_basis_unspecified','service_dates_unprovided','stop_context_incomplete','identity_review_required'])assert.ok(c.reason_codes.includes(reason));
  assert.equal((await q('SELECT resolved_status FROM v2_leads WHERE subject_id=$1',[a.subjectId])).rows[0].resolved_status,'unresolved');
  assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE from_subject_id=$1',[a.subjectId])).rows[0].n,'0');
 });
 test('association worker: 07:00 and 14:00 remain distinct candidates and original runs',async()=>{
  const op=await operator(),s=await structure(op);const afternoon=await subject('run');await q('INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,50400)',[afternoon,s.plan,s.p]);
  const a=await fresh({operatorId:op});await execute(a);const c=await candidates(a.subjectId);assert.ok(c.some(c=>c.to_subject_id===s.run));assert.ok(!c.some(c=>c.to_subject_id===afternoon));
  assert.equal((await q('SELECT departure_seconds FROM v2_runs WHERE subject_id=$1',[afternoon])).rows[0].departure_seconds,50400);
 });
 test('association worker: an actual clock cannot supply a scheduled-run identity',async()=>{
  const op=await operator(),s=await structure(op),a=await fresh({operatorId:op,basis:'actual'});await execute(a);assert.ok(!(await candidates(a.subjectId)).some(c=>c.to_subject_id===s.run));
 });
 test('association worker: retired run parents are excluded from service candidates',async()=>{
  const op=await operator(),s=await structure(op),a=await fresh({operatorId:op});await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[s.plan]);await execute(a);assert.ok(!(await candidates(a.subjectId)).some(c=>c.to_subject_id===s.run));
 });
 test('association worker: one lead may retain multiple ambiguous matching runs',async()=>{
  const op=await operator(),s=await structure(op);const second=await subject('run');await q('INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,25200)',[second,s.plan,s.p]);
  const a=await fresh({operatorId:op});await execute(a);assert.equal((await candidates(a.subjectId)).filter(c=>c.relation==='same_service').length,2);assert.equal((await q('SELECT count(*) n FROM v2_association_links')).rows[0].n,'0');
 });
 test('association worker: candidate retries deduplicate without rewriting sealed evidence',async()=>{
  const a=await fresh(),b=await fresh();const w=await execute(a),before=await candidates(a.subjectId);assert.equal(await finish(w),'lease_lost');
  const j=(await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('associate',$1,$2,'association/1',gen_random_uuid()) RETURNING id",[a.subjectId,a.job.requested_generation])).rows[0];await execute({job:j});
  assert.deepEqual(await candidates(a.subjectId),before);assert.equal((await q('SELECT count(*) n FROM v2_candidate_evidence WHERE candidate_id=$1',[before[0].id])).rows[0].n,'4');
  assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='assess' AND policy_version='evidence/1'",[a.subjectId])).rows[0].n,'1');assert.ok(b.subjectId);
 });
 test('association worker: no existing matches still produces a durable assessment intent',async()=>{
  const a=await fresh();await execute(a);assert.equal((await candidates(a.subjectId)).length,0);assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='assess' AND policy_version='evidence/1'",[a.subjectId])).rows[0].n,'1');
 });
 test('association worker: a rejected candidate stays rejected after derived-generation reprocessing',async()=>{
  const a=await fresh(),b=await fresh();await execute(a);const c=(await candidates(a.subjectId))[0];await decide(c.id,'reject');await renormalise(a.subjectId);await renormalise(b.subjectId);
  const j=(await q("SELECT id FROM v2_jobs WHERE subject_id=$1 AND kind='associate' AND state='pending' AND requested_generation=(SELECT input_generation FROM v2_subjects WHERE id=$1)",[a.subjectId])).rows[0];await execute({job:j});
  const after=await candidates(a.subjectId);assert.equal(after.length,1);assert.equal(after[0].id,c.id);assert.equal(after[0].state,'decided');
 });
 test('association worker: generated grouping accepts and reverses with history while preserving originals',async()=>{
  const a=await fresh(),b=await fresh();await execute(a);const c=(await candidates(a.subjectId))[0];const before=(await q('SELECT id,value FROM v2_observations WHERE contribution_id=ANY($1::uuid[]) ORDER BY id',[[a.contributionId,b.contributionId]])).rows;
  await decide(c.id,'accept');assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'1');await decide(c.id,'reverse');
  assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'0');assert.equal((await q('SELECT count(*) n FROM v2_association_decisions WHERE candidate_id=$1',[c.id])).rows[0].n,'2');
  assert.deepEqual((await q('SELECT id,value FROM v2_observations WHERE contribution_id=ANY($1::uuid[]) ORDER BY id',[[a.contributionId,b.contributionId]])).rows,before);await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('association worker: generated service identity cannot be automatically accepted',async()=>{
  const op=await operator(),s=await structure(op),a=await fresh({operatorId:op});await execute(a);const c=(await candidates(a.subjectId)).find(c=>c.to_subject_id===s.run);assert.ok(c);await invalid(()=>decide(c.id,'accept'));assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'0');
 });
 test('association worker: wrong and expired tokens cannot commit, renew or fail a scan',async()=>{
  const a=await fresh();await focus(a.job.id);const w=await claim();assert.equal(await finish({...w,lease_token:randomUUID()}),'lease_lost');
  assert.equal((await q('SELECT v2_worker_heartbeat_associate($1,$2) r',[w.id,randomUUID()])).rows[0].r,false);
  await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);assert.equal(await finish(w),'lease_lost');
  for(const sql of ['SELECT v2_worker_heartbeat_associate($1,$2) r',"SELECT v2_worker_fail_associate($1,$2,'processing_error') r"])assert.equal((await q(sql,[w.id,w.lease_token])).rows[0].r,false);
  assert.equal((await q('SELECT count(*) n FROM v2_association_scans WHERE job_id=$1',[w.id])).rows[0].n,'0');
 });
 test('association worker: interrupted candidate writes roll back with next-stage intent',async()=>{
  const a=await fresh();await fresh();await focus(a.job.id);const w=await claim();await q('SAVEPOINT interrupted_scan');await finish(w);await q('ROLLBACK TO SAVEPOINT interrupted_scan');await q('RELEASE SAVEPOINT interrupted_scan');
  assert.equal((await candidates(a.subjectId)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[w.id])).rows[0].n,'0');assert.equal(await finish(w),'done');
 });
 test('association worker: expiry during candidate insertion rolls all effects back',{timeout:10_000},async()=>{
  const a=await fresh();await fresh();await focus(a.job.id);const w=await claim();await q("CREATE FUNCTION association_test_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1);RETURN NEW;END;$$");
  await q('CREATE TRIGGER association_test_slow BEFORE INSERT ON v2_association_candidates FOR EACH ROW EXECUTE FUNCTION association_test_slow()');await q("UPDATE v2_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1",[w.id]);
  await invalid(()=>finish(w),'40001');assert.equal((await candidates(a.subjectId)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_association_scans WHERE job_id=$1',[w.id])).rows[0].n,'0');
 });
 test('association worker: generation changes supersede old work and invalidate candidates',async()=>{
  const a=await fresh();await fresh();await execute(a);const c=(await candidates(a.subjectId))[0];
  const j=(await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('associate',$1,$2,'association/1',gen_random_uuid()) RETURNING id",[a.subjectId,a.job.requested_generation])).rows[0];await focus(j.id);const w=await claim();
  await q('UPDATE v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=$1',[a.subjectId]);assert.equal(await finish(w),'superseded');assert.equal((await q('SELECT state FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0].state,'obsolete');
 });
 test('association worker: observation deletion erases candidate digest and its scan projection',async()=>{
  const a=await fresh();await fresh();await execute(a);const c=(await candidates(a.subjectId))[0];const id=(await q('SELECT operator_observation_id FROM v2_normalised_leads WHERE subject_id=$1',[a.subjectId])).rows[0].operator_observation_id;
  await q('DELETE FROM v2_observations WHERE id=$1',[id]);assert.deepEqual((await q('SELECT state,evidence_erased,evidence_digest,basis_digest FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0],{state:'obsolete',evidence_erased:true,evidence_digest:null,basis_digest:null});assert.equal((await q('SELECT count(*) n FROM v2_association_scans WHERE subject_id=$1',[a.subjectId])).rows[0].n,'0');
 });
 test('association worker: a new neighbour wakes a completed scan without inflating source facts',async()=>{
  const a=await fresh();await execute(a);const b=await fresh({owner:context().other});const j=(await q("SELECT id FROM v2_jobs WHERE subject_id=$1 AND kind='associate' AND state='pending'",[a.subjectId])).rows;assert.equal(j.length,1);await execute({job:j[0]});assert.ok((await candidates(a.subjectId)).some(c=>c.to_subject_id===b.subjectId));
  assert.equal((await q('SELECT count(*) n FROM v2_observations WHERE contribution_id=$1',[a.contributionId])).rows[0].n,'2');
 });
 test('association worker: bounded pages resume beyond the first fifty and fence catalog changes',async()=>{
  const s=await structure(await operator()),a=await fresh();await addPatterns(s.route,s.stops,50);await focus(a.job.id);const w=await claim();assert.equal(await finish(w),'continued');assert.ok((await candidates(a.subjectId)).length<=50);assert.ok((await candidates(a.subjectId)).length>=49);
  const inserted=await addPattern(s.route,s.stops,'00000000-0000-4000-8000-000000000005');await focus(a.job.id);
  for(let i=0;i<4;i++){const next=await claim();assert.equal(next.id,a.job.id);const result=await finish(next);if(result==='done')break;assert.equal(result,'continued');}
  const c=await candidates(a.subjectId);assert.equal(c.length,52);assert.ok(c.some(c=>c.to_subject_id===inserted));assert.equal((await q('SELECT state FROM v2_jobs WHERE id=$1',[a.job.id])).rows[0].state,'done');
 });
 test('association worker: successful pagination does not exhaust the eight-failure budget',{timeout:60_000},async()=>{
  const s=await structure(await operator()),a=await fresh();await addPatterns(s.route,s.stops,401);await focus(a.job.id);let completed=false;
  for(let i=0;i<12;i++){const w=await claim();assert.equal(w.id,a.job.id);const result=await finish(w);if(result==='done'){completed=true;break;}assert.equal(result,'continued');}
  assert.ok(completed);assert.equal((await candidates(a.subjectId)).length,402);const j=(await q('SELECT attempt,max_attempts,state FROM v2_jobs WHERE id=$1',[a.job.id])).rows[0];assert.equal(j.attempt,9);assert.equal(j.state,'done');assert.ok(j.max_attempts>j.attempt);
 });
 test('association worker: failed work stays visible and owner retry preserves lifetime attempts',async()=>{
  const a=await fresh();await focus(a.job.id);for(let i=1;i<=8;i++){const w=await claim();assert.equal(w.attempt,i);await q('SELECT v2_worker_fail_associate($1,$2,$3)',[w.id,w.lease_token,'private://do-not-retain']);if(i<8)await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[w.id]);}
  const j=(await q('SELECT * FROM v2_jobs WHERE id=$1',[a.job.id])).rows[0];assert.equal(j.state,'failed');assert.equal(j.last_error_code,'processing_error');assert.equal(await claim(),null);
  const h=(await q('SELECT v2_worker_health() h')).rows[0].h;assert.ok(h.failedJobs.some((v:{id:string})=>v.id===a.job.id));assert.equal((await q('SELECT v2_worker_retry_associate($1) r',[a.job.id])).rows[0].r,true);assert.equal((await claim()).attempt,9);
 });
 test('association worker: unsupported policy backlog is visible and never consumed',async()=>{
  const a=await fresh();await focus(a.job.id);await execute(a);await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('normalise',$1,$2,'future/9',gen_random_uuid()),('associate',$1,$2,'future/9',gen_random_uuid())",[a.subjectId,a.job.requested_generation]);
  assert.equal(await claim(),null);assert.equal((await q('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w,null);assert.ok((await q('SELECT v2_worker_health() h')).rows[0].h.otherPendingStages>=2);
 });
 test('association worker: backend has fenced facades but cannot mutate candidates, cursors or retry',async()=>{
  const a=await fresh();await fresh();await focus(a.job.id);await q('SET LOCAL ROLE mabhazi_api');const w=await claim();assert.equal(await finish(w),'done');
  for(const sql of ['DELETE FROM v2_association_candidates','DELETE FROM v2_association_scans','UPDATE v2_association_catalog SET revision=revision','UPDATE v2_jobs SET state=state'])await invalid(()=>q(sql));
  await invalid(()=>q('SELECT v2_worker_retry_associate($1)',[w.id]));await q('RESET ROLE');
 });
 test('association worker: hosted clients cannot read cursor metadata or execute worker helpers',async()=>{
  const a=await fresh();for(const role of ['anon','authenticated']){await q(`SET LOCAL ROLE ${role}`);for(const sql of ['SELECT * FROM v2_association_catalog','SELECT * FROM v2_association_scans','SELECT v2_worker_claim_associate()','SELECT v2_worker_drain_associate(1)','SELECT v2_worker_stage_health(\'associate\',\'association/1\',\'association/1\')'])await invalid(()=>q(sql));await invalid(()=>q('SELECT v2_worker_finish_associate($1,$2)',[a.job.id,randomUUID()]));await q('RESET ROLE');}
 });
 test('association worker: account erasure prevents a leased scan from resurrecting private evidence',async()=>{
  const a=await fresh(),b=await fresh({owner:context().other});await focus(a.job.id);const w=await claim();await q('SET LOCAL ROLE mabhazi_api');await q('DELETE FROM users WHERE id=$1',[context().user]);await q('RESET ROLE');assert.equal(await finish(w),'superseded');assert.equal((await candidates(a.subjectId)).length,0);assert.ok((await q('SELECT id FROM v2_contributions WHERE id=$1',[b.contributionId])).rowCount);
 });
 test('association worker: SQL tick rollback leaves the receipt and stage replayable',async()=>{
  const a=await fresh();await fresh();await focus(a.job.id);await q('SAVEPOINT lost_tick');assert.equal((await q('SELECT v2_worker_drain_associate(1) r')).rows[0].r.done,1);await q('ROLLBACK TO SAVEPOINT lost_tick');await q('RELEASE SAVEPOINT lost_tick');assert.equal((await candidates(a.subjectId)).length,0);
  assert.equal((await q('SELECT v2_worker_drain_associate(1) r')).rows[0].r.done,1);assert.ok((await q('SELECT v2_worker_health() h')).rows[0].h.associate.lastCompletedAt);for(const n of [null,0,21])await invalid(()=>q('SELECT v2_worker_drain_associate($1)',[n]),'23514');
 });
 for(const isolation of ['READ COMMITTED','REPEATABLE READ'])test(`association worker: target retirement races the fenced scan at ${isolation}`,{timeout:15_000},async()=>{
  const a=await fresh(),b=await fresh();await focus(a.job.id);const w=await claim();await q('COMMIT');const writer=new pg.Client({connectionString:context().connectionString}),worker=new pg.Client({connectionString:context().connectionString});await writer.connect();await worker.connect();
  try{await writer.query('BEGIN');await worker.query(`BEGIN ISOLATION LEVEL ${isolation}`);await worker.query("SET LOCAL statement_timeout='5s'");await worker.query('SELECT count(*) FROM v2_subjects');await writer.query('UPDATE v2_transport_guard SET toggle=NOT toggle WHERE id');await writer.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[b.subjectId]);
   const pending=worker.query('SELECT v2_worker_finish_associate($1,$2) r',[w.id,w.lease_token]).then(v=>({r:v.rows[0].r,code:null}),e=>({r:null,code:e.code}));await writer.query('COMMIT');const result=await pending;
   if(isolation==='READ COMMITTED'){assert.equal(result.r,'done');await worker.query('COMMIT');}else{assert.equal(result.code,'40001');await worker.query('ROLLBACK');}assert.equal((await candidates(a.subjectId)).length,0);
  }finally{await writer.query('ROLLBACK');await worker.query('ROLLBACK');await writer.end();await worker.end();await q('BEGIN');}
 });
}
