import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
type Context={db:pg.Client;connectionString:string;user:string;other:string;origin:number;destination:number;corridor:string};
type Pattern={id:string;route:string;stops:string[];complete:boolean;permissions:string[];sequences:number[]};
type Proposal={key:string;from:string;to:string;relation:string;segmentStart?:number;segmentEnd?:number;reasons:string[]};
export function registerPatternAssociationTests(context:()=>Context){
 const q=(sql:string,args:unknown[]=[])=>context().db.query(sql,args);
 async function invalid(action:()=>Promise<unknown>,code='23514'){
  await q('SAVEPOINT rejected_pattern');try{await assert.rejects(action,(e:unknown)=>e instanceof Error && 'code' in e && String(e.code)===code);}
  finally{await q('ROLLBACK TO SAVEPOINT rejected_pattern');await q('RELEASE SAVEPOINT rejected_pattern');}
 }
 async function subject(kind:string,id:string=randomUUID()){await q('SET CONSTRAINTS public.v2_subject_subtype DEFERRED');await q('INSERT INTO v2_subjects(id,kind) VALUES($1,$2)',[id,kind]);return id;}
 async function route(op?:string){const owner=op||await subject('operator');if(!op)await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Identical printed name')",[owner]);const id=await subject('route');await q('INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)',[id,owner]);return id;}
 async function stop(city?:number){const c=city||(await q("INSERT INTO cities(name,place_type) VALUES('Pattern fixture city','city') RETURNING id")).rows[0].id;const id=await subject('stop');await q("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$2,'Fixture terminal')",[id,c]);return id;}
 async function base(){const r=await route(),stops=[await stop(context().origin),await stop(),await stop(),await stop(context().destination)];return {r,stops};}
 async function pattern(r:string,stops:string[],options:{complete?:boolean;permissions?:string[];sequences?:number[];id?:string}={}):Promise<Pattern>{
  const id=await subject('pattern',options.id),complete=options.complete??true,permissions=options.permissions||stops.map(()=>'allowed'),sequences=options.sequences||stops.map((_,i)=>i);
  const cities=(await q('SELECT subject_id,city_id FROM v2_stops WHERE subject_id=ANY($1::uuid[])',[stops])).rows;
  const from=cities.find(c=>c.subject_id===stops[0]).city_id,to=cities.find(c=>c.subject_id===stops.at(-1)).city_id;
  const corridor=from===to?context().corridor:(await q('INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$2) ON CONFLICT(origin_city_id,destination_city_id) DO UPDATE SET origin_city_id=EXCLUDED.origin_city_id RETURNING id',[from,to])).rows[0].id;
  await q('INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)',[id,r,corridor]);
  await q('INSERT INTO v2_pattern_versions(pattern_subject_id,version,stops_complete) VALUES($1,1,$2)',[id,complete]);
  for(let i=0;i<stops.length;i++)await q('INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff) VALUES($1,1,$2,$3,$4,$4)',[id,sequences[i],stops[i],permissions[i]]);
  await q('UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1',[id]);return {id,route:r,stops,complete,permissions,sequences};
 }
 const page=async(a:Pattern,b:Pattern,after:string|null=null,limit=51):Promise<Proposal[]> =>(await q('SELECT v2_pattern_candidate_page($1,$2,$3,$4) r',[a.id,b.id,after,limit])).rows[0].r;
 async function all(a:Pattern,b:Pattern){const result:Proposal[]=[];let after:string|null=null;for(let i=0;i<1000;i++){const batch=await page(a,b,after,7);result.push(...batch);if(batch.length<7)return result;after=batch.at(-1)!.key;}throw new Error('classifier did not terminate');}
 async function jobFor(p:Pattern){return(await q("SELECT j.* FROM v2_jobs j JOIN v2_subjects s ON s.id=j.subject_id WHERE j.subject_id=$1 AND j.kind='associate' AND j.policy_version='pattern-association/1' AND j.requested_generation=s.input_generation AND j.state='pending' ORDER BY j.created_at DESC LIMIT 1",[p.id])).rows[0];}
 async function focus(id:string){await q("UPDATE v2_jobs SET available_at=CASE WHEN id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END WHERE state='pending' AND kind='associate'",[id]);}
 const claim=async()=> (await q('SELECT to_jsonb(v2_worker_claim_associate()) w')).rows[0].w;
 const finish=async(w:Record<string,unknown>)=>(await q('SELECT v2_worker_finish_associate($1,$2) r',[w.id,w.lease_token])).rows[0].r;
 async function execute(p:Pattern){const j=await jobFor(p);assert.ok(j);await focus(j.id);for(let n=0;n<100;n++){const w=await claim();assert.equal(w.id,j.id);const r=await finish(w);if(r==='done')return j;assert.equal(r,'continued');}throw new Error('scan did not terminate');}
 const candidates=async(a:Pattern,b?:Pattern)=>(await q("SELECT * FROM v2_association_candidates WHERE rule_version='pattern-association/1' AND $1 IN(from_subject_id,to_subject_id) AND ($2::uuid IS NULL OR $2 IN(from_subject_id,to_subject_id)) ORDER BY relation,segment_start,segment_end",[a.id,b?.id||null])).rows;
 async function observe(p:Pattern,owner=context().user){const c=randomUUID(),o=randomUUID(),value={stops:p.stops.map((id,i)=>({place:{stopId:id},pickup:p.permissions[i],dropoff:p.permissions[i]})),stopsComplete:p.complete};
  await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','route_detail',repeat('a',64),'{}',$3)",[c,owner,p.id]);
  await q("INSERT INTO v2_observations(id,contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,$3,'pattern.stops',$4,'{}',v2_assessment_hash('{}'::jsonb),v2_assessment_hash($4::jsonb))",[o,c,p.id,value]);return {c,o,owner};
 }
 async function review(c:Record<string,any>,action='accept',evidence?:string[],reverse:string|null=null){
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture_role') ON CONFLICT DO NOTHING",[context().other]);
  let id=c.caseId as string|undefined;if(!id){id=(await q("SELECT v2_open_review_case($1,$2,'identity',NULL,NULL) id",[context().other,c.from_subject_id])).rows[0].id;await q('UPDATE v2_review_cases SET candidate_id=$1 WHERE id=$2',[c.id,id]);}
  const state=(await q('SELECT r.revision,s.revision subject_revision FROM v2_review_cases r JOIN v2_subjects s ON s.id=r.subject_id WHERE r.id=$1',[id])).rows[0];
  const ids=evidence||(await q('SELECT observation_id FROM v2_pattern_candidate_support WHERE candidate_id=$1',[c.id])).rows.map(r=>r.observation_id);
  const result=(await q('SELECT v2_record_review($1,$2,$3,$4,$5,$6,NULL,$7::uuid[],\'review/1\',$8) id',[context().other,id,state.revision,state.subject_revision,action,'fixture_review',ids,reverse])).rows[0].id;return {id:result,caseId:id};
 }
 async function apply(cId:string,action:string,rId:string|null=null){const c=(await q('SELECT * FROM v2_association_candidates WHERE id=$1',[cId])).rows[0],id=randomUUID();const from=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[c.from_subject_id])).rows[0].revision,to=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[c.to_subject_id])).rows[0].revision;
  await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'association')",[id]);await q(`INSERT INTO v2_association_decisions(id,candidate_id,action,previous_decision_id,actor_kind,reviewer_decision_id,reason_code,policy_version,expected_from_revision,expected_to_revision,expected_candidate_revision)
   VALUES($1,$2,$3,$4,$5,$6,'fixture_relation','pattern-association/1',$7,$8,$9)`,[id,cId,action,c.last_decision_id,rId?'reviewer':'system',rId,from,to,c.revision]);await q('SELECT v2_apply_association_decision($1)',[id]);return id;
 }
 async function reviewedContext(){
  await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=clock_timestamp() WHERE id=$1",[context().user]);await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture_role') ON CONFLICT DO NOTHING",[context().other]);
  const state=async(id:string)=>(await q('SELECT revision FROM v2_subjects WHERE id=$1',[id])).rows[0].revision;
  async function lead(operator:unknown){return(await q("SELECT v2_submit_lead($1,'2026-09-12',$2) r",[context().user,{schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:context().origin,destinationCityId:context().destination,departureTime:'07:00',operator}},observations:[]}])).rows[0].r;}
  async function materialize(sourceId:string,observation:string,kind:string,parent?:string){
   const proposal=(await q(parent?'SELECT v2_propose_pattern_creation($1,$2,$3,$4,$5,$6,gen_random_uuid()) id':'SELECT v2_propose_transport_creation($1,$2,$3,$4,$5,gen_random_uuid()) id',parent?[context().other,sourceId,await state(sourceId),observation,parent,await state(parent)]:[context().other,sourceId,await state(sourceId),observation,kind])).rows[0].id;
   const p=(await q('SELECT * FROM v2_transport_creations WHERE id=$1',[proposal])).rows[0],rev=(await q('SELECT revision FROM v2_review_cases WHERE id=$1',[p.case_id])).rows[0].revision;
   const approval=(await q("SELECT v2_review_transport_creation($1,$2,$3,$4,'accept','fixture_creation',NULL,gen_random_uuid(),NULL) id",[context().other,proposal,rev,await state(sourceId)])).rows[0].id;await q('SELECT v2_apply_transport_creation($1,$2,$3,gen_random_uuid())',[context().other,proposal,approval]);return p.target_subject_id as string;
  }
  const initial=await lead({name:'Origin company'}),opObservation=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[initial.contributionId])).rows[0].id,op=await materialize(initial.subjectId,opObservation,'operator'),f=await lead({id:op});
  const operatorReport=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[f.contributionId])).rows[0].id,r=await materialize(f.subjectId,operatorReport,'route');
  async function report(field:string,value:unknown){return(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,$3,$4,'{}',v2_assessment_hash('{}'),v2_assessment_hash($4)) RETURNING id",[f.contributionId,f.subjectId,field,value])).rows[0].id as string;}
  const pickup=await report('boarding.pickup',{cityId:context().origin,name:'Start terminal'}),start=await materialize(f.subjectId,pickup,'stop'),dropoff=await report('alighting.dropoff',{cityId:context().destination,name:'End terminal'}),end=await materialize(f.subjectId,dropoff,'stop');
  async function make(){const observation=await report('pattern.stops',{stops:[{place:{stopId:start},pickup:'allowed',dropoff:'allowed'},{place:{stopId:end},pickup:'allowed',dropoff:'allowed'}],stopsComplete:true}),id=await materialize(f.subjectId,observation,'pattern',r);return {p:{id,route:r,stops:[start,end],complete:true,permissions:['allowed','allowed'],sequences:[0,1]} as Pattern,observation};}
  return {make,pickup,opObservation};
 }
 test('pattern matching: complete equal known stop visits and permissions propose the same pattern',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const p=await all(a,b);assert.equal(p.filter(p=>p.relation==='same_pattern').length,1);assert.ok(p.find(p=>p.relation==='same_pattern')!.reasons.includes('known_permissions_equal'));assert.equal(p.some(p=>p.relation==='duplicate_of'),false);
 });
 test('pattern matching: arbitrary sequence labels do not change visit identity',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops,{sequences:[10,20,30,40]}),b=await pattern(r,stops);assert.ok((await all(a,b)).some(p=>p.relation==='same_pattern'));
 });
 test('pattern matching: direct versus stopping variants never become the same pattern',async()=>{
  const {r,stops}=await base(),a=await pattern(r,[stops[0]!,stops[3]!]),b=await pattern(r,stops);const p=await all(a,b);assert.ok(p.some(p=>p.relation==='variant_of'));assert.ok(!p.some(p=>p.relation==='same_pattern'));assert.ok(p.some(p=>p.relation==='contains_segment'&&p.reasons.includes('unmatched_intermediate_stops')));
 });
 test('pattern matching: known boarding permission conflicts propose a variant',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops,{permissions:['forbidden','allowed','allowed','allowed']});assert.ok((await all(a,b)).some(p=>p.relation==='variant_of'&&p.reasons.includes('known_permissions_differ')));
 });
 test('pattern matching: unknown permission equality is not identity evidence',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops,{permissions:stops.map(()=>'unknown')}),b=await pattern(r,stops,{permissions:stops.map(()=>'unknown')});const p=await all(a,b);assert.deepEqual(p.map(p=>p.relation),['same_corridor']);assert.ok(p[0]!.reasons.includes('permissions_incomplete'));
 });
 test('pattern matching: a missing permission is not a known contradiction',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops,{permissions:['unknown','allowed','allowed','allowed']});assert.deepEqual((await all(a,b)).map(p=>p.relation),['same_corridor']);
 });
 test('pattern matching: incomplete lists cannot prove sameness or variants',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops,{complete:false}),b=await pattern(r,[stops[0]!,stops[3]!],{complete:false});const p=await all(a,b);assert.ok(!p.some(p=>['same_pattern','variant_of'].includes(p.relation)));assert.ok(p.some(p=>p.relation==='contains_segment'&&p.reasons.includes('stop_list_incomplete')));
 });
 test('pattern matching: opposite directions stay separate even under one route',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,[...stops].reverse());assert.deepEqual(await all(a,b),[]);
 });
 test('pattern matching: different known operators sharing a printed name keep corridor grouping only',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(await route(),stops);const p=await all(a,b);assert.deepEqual(p.map(p=>p.relation),['same_corridor']);assert.ok(p[0]!.reasons.includes('known_operators_differ'));
 });
 test('pattern matching: separate route identities under one operator do not imply pattern identity',async()=>{
  const {r,stops}=await base(),op=(await q('SELECT operator_subject_id FROM v2_routes WHERE subject_id=$1',[r])).rows[0].operator_subject_id,a=await pattern(r,stops),b=await pattern(await route(op),stops);assert.deepEqual((await all(a,b)).map(p=>p.relation),['same_corridor']);
 });
 test('pattern matching: contained segments retain longer-to-shorter actual sequence bounds',async()=>{
  const {r,stops}=await base(),long=await pattern(r,stops,{sequences:[10,20,30,40]}),short=await pattern(r,stops.slice(1,3));const p=(await all(short,long)).find(p=>p.relation==='contains_segment')!;assert.ok(p);assert.equal(p.from,long.id);assert.equal(p.to,short.id);assert.equal(p.segmentStart,20);assert.equal(p.segmentEnd,30);assert.ok(p.reasons.includes('no_schedule_or_fare_inheritance'));
 });
 test('pattern matching: segment permission conflict is visible and never grants boarding access',async()=>{
  const {r,stops}=await base(),long=await pattern(r,stops),short=await pattern(r,stops.slice(1,3),{permissions:['forbidden','allowed']});assert.ok((await all(long,short)).some(p=>p.relation==='contains_segment'&&p.reasons.includes('segment_permission_conflict')));
 });
 test('pattern matching: unordered overlapping stops do not make a contained segment',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,[stops[2]!,stops[1]!]);assert.ok(!(await all(a,b)).some(p=>p.relation==='contains_segment'));
 });
 test('pattern matching: repeated visits expose every plausible endpoint window',async()=>{
  const {r,stops}=await base(),a=await pattern(r,[stops[0]!,stops[1]!,stops[0]!,stops[1]!,stops[3]!]),b=await pattern(r,[stops[0]!,stops[1]!]);const windows=(await all(a,b)).filter(p=>p.relation==='contains_segment');assert.deepEqual(windows.map(p=>[p.segmentStart,p.segmentEnd]),[[0,1],[0,3],[2,3]]);
 });
 test('pattern matching: lazy pages do not truncate more than fifty repeated-stop windows',async()=>{
  const {r,stops}=await base(),a=await pattern(r,Array.from({length:20},(_,i)=>i%2?stops[1]!:stops[0]!),{complete:false}),b=await pattern(r,[stops[0]!,stops[1]!],{complete:false});const windows=(await all(a,b)).filter(p=>p.relation==='contains_segment');assert.equal(windows.length,55);assert.equal(new Set(windows.map(p=>p.key)).size,55);
 });
 test('pattern matching: retired context suppresses identity proposals',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[stops[1]]);assert.deepEqual(await all(a,b),[]);
 });
 test('pattern matching: invalid paging controls fail explicitly',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);for(const limit of [0,52,null])await invalid(()=>q('SELECT v2_pattern_candidate_page($1,$2,NULL,$3)',[a.id,b.id,limit]));await invalid(()=>page(a,b,'private://bad'));await invalid(()=>page(a,a));
 });
 test('pattern worker: sealed creation queues current policy and dispatches through existing facade',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const j=await execute(a),c=await candidates(a,b);assert.equal(c.length,2);assert.ok(c.every(c=>c.state==='pending'));assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[j.id])).rows[0].n,'1');assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='assess' AND policy_version='evidence/1'",[a.id])).rows[0].n,'1');
 });
 test('pattern worker: reciprocal scans coalesce symmetric pair/window candidates',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops.slice(1,3));await execute(a);const before=await candidates(a,b);await execute(b);assert.deepEqual(await candidates(a,b),before);
 });
 test('pattern worker: one target with more than fifty windows resumes without losing alternatives',async()=>{
  const {r,stops}=await base(),a=await pattern(r,Array.from({length:20},(_,i)=>i%2?stops[1]!:stops[0]!),{complete:false}),b=await pattern(r,[stops[0]!,stops[1]!],{complete:false});const j=await jobFor(a);await focus(j.id);let w=await claim();assert.equal(await finish(w),'continued');const scan=(await q('SELECT * FROM v2_pattern_scans WHERE job_id=$1',[j.id])).rows[0];assert.equal(scan.cursor_subject_id,b.id);assert.ok(scan.cursor_key);w=await claim();assert.equal(await finish(w),'done');assert.equal((await candidates(a,b)).filter(c=>c.relation==='contains_segment').length,55);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[j.id])).rows[0].n,'1');
 });
 test('pattern worker: more than ten targets are scanned in resumable pages',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);const others=[];for(let i=0;i<12;i++)others.push(await pattern(r,stops));const j=await execute(a);assert.equal((await candidates(a)).length,24);assert.ok((await q('SELECT pages_completed FROM v2_pattern_scans WHERE job_id=$1',[j.id])).rows[0].pages_completed>=2);
 });
 test('pattern worker: adding a lower UUID between pages resets the catalog cursor',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);for(let i=0;i<12;i++)await pattern(r,stops);const j=await jobFor(a);await focus(j.id);assert.equal(await finish(await claim()),'continued');const b=await pattern(r,stops,{id:'00000000-0000-4000-8000-000000000025'});await execute(a);assert.ok((await candidates(a,b)).some(c=>c.relation==='same_pattern'));
 });
 test('pattern worker: lease loss and expiry cannot heartbeat, fail or create candidates',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);await pattern(r,stops);const j=await jobFor(a);await focus(j.id);const w=await claim();assert.equal(await finish({...w,lease_token:randomUUID()}),'lease_lost');await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);assert.equal(await finish(w),'lease_lost');for(const sql of ['SELECT v2_worker_heartbeat_associate($1,$2) r',"SELECT v2_worker_fail_associate($1,$2,'processing_error') r"])assert.equal((await q(sql,[w.id,w.lease_token])).rows[0].r,false);assert.equal((await candidates(a)).length,0);
 });
 test('pattern worker: source generation changes supersede old work and remove private cursors',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);await pattern(r,stops);const j=await jobFor(a);await focus(j.id);const w=await claim();await q('UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1',[a.id]);assert.equal(await finish(w),'superseded');assert.equal((await q('SELECT count(*) n FROM v2_pattern_scans WHERE job_id=$1',[j.id])).rows[0].n,'0');assert.ok(await jobFor(a));
 });
 test('pattern worker: rollback restores candidates, cursor and next-stage intent together',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);await pattern(r,stops);const j=await jobFor(a);await focus(j.id);const w=await claim();await q('SAVEPOINT interrupted_pattern');await finish(w);await q('ROLLBACK TO SAVEPOINT interrupted_pattern');await q('RELEASE SAVEPOINT interrupted_pattern');assert.equal((await candidates(a)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_pattern_scans WHERE job_id=$1',[j.id])).rows[0].n,'0');assert.equal(await finish(w),'done');
 });
 test('pattern worker: expiry during candidate writes rolls back effects',{timeout:10_000},async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);await pattern(r,stops);const j=await jobFor(a);await focus(j.id);const w=await claim();await q("CREATE FUNCTION pattern_slow_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1);RETURN NEW;END;$$");await q('CREATE TRIGGER pattern_slow_fixture BEFORE INSERT ON v2_association_candidates FOR EACH ROW EXECUTE FUNCTION pattern_slow_fixture()');await q("UPDATE v2_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1",[w.id]);await invalid(()=>finish(w),'40001');assert.equal((await candidates(a)).length,0);assert.equal((await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[j.id])).rows[0].n,'0');
 });
 test('pattern worker: backend can process fenced work but cannot mutate provenance or review links',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops);await pattern(r,stops);const j=await jobFor(a);await focus(j.id);await q('SET LOCAL ROLE mabhazi_api');assert.equal(await finish(await claim()),'done');for(const sql of ['DELETE FROM v2_pattern_scans','UPDATE v2_pattern_catalog SET revision=revision','DELETE FROM v2_pattern_candidate_support','DELETE FROM v2_association_links','SELECT v2_pattern_candidate_page(NULL,NULL)'])await invalid(()=>q(sql),'42501');await q('RESET ROLE');
 });
 test('pattern worker: hosted clients get no classifier, worker or private metadata access',async()=>{
  for(const role of ['anon','authenticated']){await q(`SET LOCAL ROLE ${role}`);for(const sql of ['SELECT * FROM v2_pattern_scans','SELECT * FROM v2_pattern_catalog','SELECT * FROM v2_pattern_candidate_support','SELECT v2_pattern_context(NULL)','SELECT v2_worker_claim_associate()'])await invalid(()=>q(sql),'42501');await q('RESET ROLE');}
 });
 test('pattern worker: original endpoint evidence is declared and cannot be forged or amended',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const x=await observe(a),y=await observe(b);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');assert.ok(c);assert.equal((await q('SELECT count(*) n FROM v2_pattern_candidate_support WHERE candidate_id=$1',[c.id])).rows[0].n,'2');assert.equal((await q('SELECT count(*) n FROM v2_candidate_evidence WHERE candidate_id=$1',[c.id])).rows[0].n,'2');await invalid(()=>q('UPDATE v2_pattern_candidate_support SET observation_id=$1 WHERE candidate_id=$2',[y.o,c.id]));assert.ok(x.o);
 });
 test('pattern worker: evidence deletion redacts both fingerprints and preserves other reports',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const x=await observe(a),y=await observe(b,context().other);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');await q('DELETE FROM v2_observations WHERE id=$1',[x.o]);assert.deepEqual((await q('SELECT state,evidence_erased,evidence_digest,basis_digest FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0],{state:'obsolete',evidence_erased:true,evidence_digest:null,basis_digest:null});assert.ok((await q('SELECT id FROM v2_observations WHERE id=$1',[y.o])).rowCount);await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('pattern worker: withdrawal invalidates support and queues reevaluation',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const x=await observe(a);await observe(b);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().user,x.o,randomUUID()]);assert.equal((await q('SELECT state FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0].state,'obsolete');assert.ok(await jobFor(a));
 });
 test('pattern provenance: reviewed construction declares original lead evidence and permits exact review',async()=>{
  const f=await reviewedContext(),a=await f.make(),b=await f.make();await execute(a.p);const c=(await candidates(a.p,b.p)).find(c=>c.relation==='same_pattern');assert.ok(c);assert.equal((await q('SELECT count(*) n FROM v2_candidate_evidence WHERE candidate_id=$1',[c.id])).rows[0].n,'0');assert.equal((await q('SELECT count(*) n FROM v2_pattern_candidate_support WHERE candidate_id=$1',[c.id])).rows[0].n,'6');const approval=await review(c);await apply(c.id,'accept',approval.id);assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'1');await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('pattern provenance: deleting parent-origin proof redacts dependent candidates and prevents reconstruction',async()=>{
  const f=await reviewedContext(),a=await f.make(),b=await f.make();await execute(a.p);const c=(await candidates(a.p,b.p)).find(c=>c.relation==='same_pattern');await q('DELETE FROM v2_observations WHERE id=$1',[f.pickup]);assert.deepEqual((await q('SELECT state,evidence_erased,basis_digest,evidence_digest FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0],{state:'obsolete',evidence_erased:true,basis_digest:null,evidence_digest:null});assert.equal((await q('SELECT v2_pattern_context($1) p',[a.p.id])).rows[0].p,null);await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('pattern provenance: parent proof withdrawal invalidates current proposals without deleting originals',async()=>{
  const f=await reviewedContext(),a=await f.make(),b=await f.make();await execute(a.p);const c=(await candidates(a.p,b.p)).find(c=>c.relation==='same_pattern');await q('SELECT v2_withdraw_observation($1,$2,1,gen_random_uuid(),NULL)',[context().user,f.pickup]);assert.equal((await q('SELECT state FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0].state,'obsolete');assert.ok((await q('SELECT id FROM v2_observations WHERE id=$1',[f.pickup])).rowCount);assert.equal((await q('SELECT v2_pattern_context($1) p',[a.p.id])).rows[0].p,null);
 });
 test('pattern worker: automatic identity acceptance is denied despite matching structure',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');await invalid(()=>apply(c.id,'accept'), '42501');
 });
 test('pattern review: declared evidence from both endpoints supports exact reviewed acceptance',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);await observe(a);await observe(b,context().other);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');const result=await review(c);assert.equal((await q('SELECT state FROM v2_association_candidates WHERE id=$1',[c.id])).rows[0].state,'pending');await apply(c.id,'accept',result.id);assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'1');await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 test('pattern review: unrelated evidence cannot enter a candidate-bound identity case',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops),other=await pattern(r,stops);await observe(a);await observe(b);const wrong=await observe(other);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');await invalid(()=>review(c,'accept',[wrong.o]));
 });
 test('pattern review: undeclared evidence from the reviewed endpoint is also rejected',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops),x=await observe(a),y=await observe(b),from=a.id<b.id?a:b,contribution=from.id===a.id?x.c:y.c;
  const o=(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,'boarding.pickup',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3)) RETURNING id",[contribution,from.id,{stopId:stops[0]}])).rows[0].id;
  await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern');assert.equal(c.from_subject_id,from.id);await invalid(()=>review(c,'accept',[o]));
 });
 test('pattern review: omitting declared support cannot accept the association',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);await observe(a);await observe(b);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern'),one=(await q('SELECT observation_id FROM v2_candidate_evidence WHERE candidate_id=$1 LIMIT 1',[c.id])).rows[0].observation_id;const result=await review(c,'accept',[one]);await invalid(()=>apply(c.id,'accept',result.id));
 });
 test('pattern review: rejection survives unchanged derived-generation scans',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);await observe(a);await observe(b);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern'),result=await review(c,'reject');await apply(c.id,'reject',result.id);await execute(a);const matching=(await candidates(a,b)).filter(c=>c.relation==='same_pattern');assert.equal(matching.length,1);assert.equal(matching[0].state,'decided');
 });
 test('pattern review: reversal retains history and original reports without destructive identity merging',async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops);const x=await observe(a),y=await observe(b,context().other);await execute(a);const c=(await candidates(a,b)).find(c=>c.relation==='same_pattern'),approval=await review(c);await apply(c.id,'accept',approval.id);
  const caseId=(await q('SELECT case_id FROM v2_review_decisions WHERE id=$1',[approval.id])).rows[0].case_id;const reversal=await review({...c,caseId},'reverse',[],approval.id);await apply(c.id,'reverse',reversal.id);assert.equal((await q('SELECT count(*) n FROM v2_association_links WHERE candidate_id=$1',[c.id])).rows[0].n,'0');assert.equal((await q('SELECT count(*) n FROM v2_association_decisions WHERE candidate_id=$1',[c.id])).rows[0].n,'2');assert.equal((await q('SELECT count(*) n FROM v2_observations WHERE id=ANY($1::uuid[])',[[x.o,y.o]])).rows[0].n,'2');await q('SET CONSTRAINTS ALL IMMEDIATE');
 });
 for(const isolation of ['READ COMMITTED','REPEATABLE READ'])test(`pattern worker: target retirement races the scan at ${isolation}`,{timeout:15_000},async()=>{
  const {r,stops}=await base(),a=await pattern(r,stops),b=await pattern(r,stops),j=await jobFor(a);await focus(j.id);const w=await claim();await q('COMMIT');const writer=new pg.Client({connectionString:context().connectionString}),worker=new pg.Client({connectionString:context().connectionString});await writer.connect();await worker.connect();
  try{await writer.query('BEGIN');await worker.query(`BEGIN ISOLATION LEVEL ${isolation}`);await worker.query("SET LOCAL statement_timeout='5s'");await worker.query('SELECT count(*) FROM v2_subjects');await writer.query('UPDATE v2_transport_guard SET toggle=NOT toggle WHERE id');await writer.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[b.id]);const pending=worker.query('SELECT v2_worker_finish_associate($1,$2) r',[w.id,w.lease_token]).then(v=>({r:v.rows[0].r,code:null}),e=>({r:null,code:e.code}));await writer.query('COMMIT');const result=await pending;
   if(isolation==='READ COMMITTED'){assert.equal(result.r,'done');await worker.query('COMMIT');}else{assert.equal(result.code,'40001');await worker.query('ROLLBACK');}assert.equal((await candidates(a)).length,0);
  }finally{await writer.query('ROLLBACK');await worker.query('ROLLBACK');await writer.end();await worker.end();await q('BEGIN');}
 });
}
