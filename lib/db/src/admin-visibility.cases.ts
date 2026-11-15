import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerAdminVisibilityTests(context:()=>Context){
 const q=(sql:string,values:unknown[]=[])=>context().db.query(sql,values);
 async function fixture(){
  const {user,other,corridor,origin,destination}=context(),route=randomUUID(),source=randomUUID();
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','visibility_fixture') ON CONFLICT DO NOTHING",[other]);
  await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[route]);
  await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
   VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,$4,$5)`,[source,user,'a'.repeat(64),{target:{newLead:{originCityId:origin,destinationCityId:destination,operator:{name:'Visibility fixture'},departureTime:'08:00'}}},route]);
  await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Visibility fixture',$3)",[route,corridor,source]);
  for(const [field,value] of [['operator.reported',{name:'Visibility fixture'}],['departure.reported',{time:'08:00',basis:'scheduled'}]] as const)
   await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
    VALUES($1,$2,$3,$4,'{}',v2_assessment_hash('{}'),v2_assessment_hash($4::jsonb),'observed_sign',current_date-1)`,[source,route,field,value]);
  return {route,source};
 }
 const revision=async(route:string)=>(await q('SELECT revision::text r FROM v2_subjects WHERE id=$1',[route])).rows[0].r;
 const visible=async(route:string)=>(await q('SELECT EXISTS(SELECT 1 FROM v2_public_lead_reports WHERE subject_id=$1) v',[route])).rows[0].v;
 async function command(route:string,operation='remove',removalId:string|null=null){return {routeId:route,revision:await revision(route),operation,reason:operation==='remove'?'inaccurate':'record_rechecked',removalId,expiresAt:Date.now()+300000};}
 const apply=async(body:unknown,id=randomUUID(),actor=context().other)=>(await q('SELECT v2_api_admin_route_action($1,$2,$3) r',[actor,id,body])).rows[0].r;
 async function invalid(sql:string,values:unknown[],codes=['23514']){
  await q('SAVEPOINT invalid_visibility');try{await assert.rejects(q(sql,values),(e:any)=>{assert.ok(codes.includes(e.code),e.code+': '+e.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_visibility');await q('RELEASE SAVEPOINT invalid_visibility');}
 }
 test('admin visibility: removal hides only the intended route and retains original evidence',async()=>{
  const a=await fixture(),b=await fixture();assert.equal(await visible(a.route),true);assert.equal(await visible(b.route),true);
  const before=(await q('SELECT payload FROM v2_contributions WHERE id=$1',[a.source])).rows[0].payload,rev=await revision(a.route);
  const r=await apply(await command(a.route));assert.equal(r.outcome,'removed');assert.equal(r.effect,'public_hidden');
  assert.equal(await visible(a.route),false);assert.equal(await visible(b.route),true);assert.ok(BigInt(await revision(a.route))>BigInt(rev));
  assert.deepEqual((await q('SELECT payload FROM v2_contributions WHERE id=$1',[a.source])).rows[0].payload,before);
  assert.equal((await q('SELECT count(*) FROM v2_observations WHERE contribution_id=$1',[a.source])).rows[0].count,'2');
  assert.equal((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND kind IN('assess','refresh_tasks')",[a.route])).rows[0].count,'2');
 });
 test('admin visibility: exact replay survives expiry while changed reason conflicts',async()=>{
  const f=await fixture(),body=await command(f.route),id=randomUUID(),r=await apply(body,id);
  assert.deepEqual(await apply({...body,expiresAt:Date.now()-1},id),r);
  assert.equal((await q('SELECT count(*) FROM v2_admin_route_actions WHERE id=$1',[id])).rows[0].count,'1');
  await invalid('SELECT v2_api_admin_route_action($1,$2,$3)',[context().other,id,{...body,reason:'spam'}]);
  await invalid('SELECT v2_api_admin_route_action($1,$2,$3)',[context().other,randomUUID(),{...body,expiresAt:Date.now()-1}]);
 });
 test('admin visibility: stale second tab receives an immutable unchanged receipt',async()=>{
  const f=await fixture(),body=await command(f.route);await apply(body);const r=await apply(body);assert.equal(r.outcome,'changed');
  assert.equal((await q('SELECT count(*) FROM v2_admin_active_route_removals WHERE route_subject_id=$1',[f.route])).rows[0].count,'1');
 });
 test('admin visibility: lifting one removal preserves an independent removal',async()=>{
  const f=await fixture(),a=await apply(await command(f.route)),b=await apply(await command(f.route));
  assert.equal((await apply(await command(f.route,'restore',a.id))).outcome,'restored');assert.equal(await visible(f.route),false);
  assert.equal((await q('SELECT id FROM v2_admin_active_route_removals WHERE route_subject_id=$1',[f.route])).rows[0].id,b.id);
  assert.equal((await apply(await command(f.route,'restore',b.id))).outcome,'restored');assert.equal(await visible(f.route),true);
  assert.equal((await apply(await command(f.route,'restore',a.id))).outcome,'already_restored');
 });
 test('admin visibility: an existing safety hide survives administrative restoration',async()=>{
  const f=await fixture(),a=await apply(await command(f.route));
  const report=(await q("INSERT INTO abuse_reports(reporter_id,target_type,target_id,reason) VALUES($1,'transport_subject',$2,'unsafe') RETURNING id",[context().user,f.route])).rows[0].id;
  await q('INSERT INTO v2_public_lead_hides(subject_id,report_id) VALUES($1,$2)',[f.route,report]);
  assert.equal((await apply(await command(f.route,'restore',a.id))).outcome,'restored');assert.equal(await visible(f.route),false);
 });
 test('admin visibility: retirement and source erasure cannot be undone by restoration',async()=>{
  const f=await fixture(),a=await apply(await command(f.route));await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[f.route]);
  assert.equal((await apply(await command(f.route,'restore',a.id))).outcome,'unavailable');assert.equal(await visible(f.route),false);
  const g=await fixture(),b=await apply(await command(g.route));await q('DELETE FROM v2_contributions WHERE id=$1',[g.source]);
  assert.equal((await apply(await command(g.route,'restore',b.id))).outcome,'unavailable');
  assert.equal((await q('SELECT v2_api_admin_route_action_receipt($1,$2) r',[context().other,b.id])).rows[0].r.sourceErased,true);
 });
 test('admin visibility: public, reviewer-only and revoked accounts cannot mutate or recover private receipts',async()=>{
  const f=await fixture(),body=await command(f.route);
  await invalid('SELECT v2_api_admin_route_action($1,$2,$3)',[context().user,randomUUID(),body],['42501']);
  await q("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL",[context().other]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','visibility_fixture')",[context().other]);
  await invalid('SELECT v2_api_admin_route_action($1,$2,$3)',[context().other,randomUUID(),body],['42501']);
  await invalid('SELECT v2_api_admin_route_action_receipt($1,$2)',[context().other,randomUUID()],['42501']);
 });
 test('admin visibility: backend and public roles cannot forge or delete history',async()=>{
  const f=await fixture(),body=await command(f.route);await q('SET LOCAL ROLE mabhazi_api');
  for(const sql of ['DELETE FROM v2_admin_route_actions','UPDATE v2_admin_route_actions SET reason_code=\'other\'','SELECT v2_admin_route_action_guard()'])await invalid(sql,[],['42501']);
  assert.equal((await apply(body)).outcome,'removed');await q('RESET ROLE');
  await invalid('DELETE FROM v2_admin_route_actions WHERE route_subject_id=$1',[f.route]);
  for(const role of ['anon','authenticated'])assert.equal((await q('SELECT has_function_privilege($1,\'v2_api_admin_route_action(varchar,uuid,jsonb)\',\'EXECUTE\') v',[role])).rows[0].v,false);
 });
 test('admin visibility: hidden routes cannot receive even newly refreshed pickup questions',async()=>{
  const f=await fixture(),a=await apply(await command(f.route));
  const t=(await q("INSERT INTO v2_question_tasks(subject_id,field_key,scope_key,scope,registry_key,registry_version,reason,input_generation,priority) SELECT $1,'boarding.pickup',v2_assessment_hash('{}'),'{}','pickup_place','prompts/1','missing',input_generation,40 FROM v2_subjects WHERE id=$1 RETURNING id",[f.route])).rows[0].id;
  assert.equal((await q("SELECT v2_prompt_eligible($1,$2,ARRAY['knows_route']) v",[t,context().user])).rows[0].v,false);
  await apply(await command(f.route,'restore',a.id));await q("UPDATE v2_question_tasks SET state='obsolete' WHERE id=$1",[t]);
  const next=(await q("INSERT INTO v2_question_tasks(subject_id,field_key,scope_key,scope,registry_key,registry_version,reason,input_generation,priority) SELECT $1,'boarding.pickup',v2_assessment_hash('{}'),'{}','pickup_place','prompts/1','missing',input_generation,40 FROM v2_subjects WHERE id=$1 RETURNING id",[f.route])).rows[0].id;
  assert.equal((await q("SELECT v2_prompt_eligible($1,$2,ARRAY['knows_route']) v",[next,context().user])).rows[0].v,true);
 });
 test('admin visibility: fresh contextual intake is blocked but historical receipts and independent reporting survive',async()=>{
  const f=await fixture();await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=now() WHERE id=$1",[context().user]);
  const body={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{newActualJourney:{intendedSubject:{id:f.route,kind:'lead',expectedRevision:Number(await revision(f.route))}}},observations:[{fieldKey:'departure.actual',value:{time:'08:20'},scope:{schemaVersion:'1.0'}}]};
  const original=(await q("SELECT v2_submit_actual_journey($1,'2026-09-12',$2) r",[context().user,body])).rows[0].r;
  await apply(await command(f.route));
  const fresh={...body,clientSubmissionId:randomUUID(),target:{newActualJourney:{intendedSubject:{...body.target.newActualJourney.intendedSubject,expectedRevision:Number(await revision(f.route))}}}};
  await invalid("SELECT v2_submit_actual_journey($1,'2026-09-12',$2)",[context().user,fresh],['23503']);
  assert.deepEqual((await q("SELECT v2_submit_actual_journey($1,'2026-09-12',$2) r",[context().user,body])).rows[0].r,{...original,replayed:true});
  assert.equal((await q("SELECT v2_submit_actual_journey($1,'2026-09-12',$2) r",[context().user,{...body,clientSubmissionId:randomUUID(),target:{newActualJourney:{}}}])).rows[0].r.saveStatus,'saved');
 });

 test('admin visibility: restoration lifts its own removal without reviving an author-withdrawn fact',async()=>{
  const f=await fixture(),a=await apply(await command(f.route));
  const fact=(await q("SELECT o.id,s.revision FROM v2_observations o JOIN v2_observation_states s ON s.observation_id=o.id WHERE o.contribution_id=$1 AND o.field_key='operator.reported'",[f.source])).rows[0];
  await q('SELECT v2_withdraw_observation($1,$2,$3,$4,NULL)',[context().user,fact.id,fact.revision,randomUUID()]);
  assert.equal((await apply(await command(f.route,'restore',a.id))).outcome,'restored');assert.equal(await visible(f.route),false);
  assert.equal((await q('SELECT status FROM v2_observation_states WHERE observation_id=$1',[fact.id])).rows[0].status,'withdrawn');
 });

}
