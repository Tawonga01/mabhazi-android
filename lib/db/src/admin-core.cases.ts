import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
type Context={db:pg.Client;user:string;other:string;origin:number;destination:number;corridor:string};
export function registerAdminCoreTests(context:()=>Context){
 const q=(sql:string,values:unknown[]=[])=>context().db.query(sql,values);
 async function fixture(){
  const {user,other,origin,destination,corridor}=context(),route=randomUUID(),source=randomUUID();
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','core_fixture') ON CONFLICT DO NOTHING",[other]);
  await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[route]);
  await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
   VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,$4,$5)`,[source,user,'a'.repeat(64),{target:{newLead:{originCityId:origin,destinationCityId:destination,operator:{name:'Original operator'},departureTime:'07:00'}}},route]);
  await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,25200,'Original operator',$3)",[route,corridor,source]);
  for(const [field,value] of [['operator.reported',{name:'Original operator'}],['departure.reported',{time:'07:00',basis:'unspecified'}]] as const)
   await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis)
    VALUES($1,$2,$3,$4,'{}',v2_assessment_hash('{}'),v2_assessment_hash($4::jsonb),'unprovided')`,[source,route,field,value]);
  return {route,source};
 }
 const revision=async(route:string)=>(await q('SELECT revision::text r FROM v2_subjects WHERE id=$1',[route])).rows[0].r;
 async function command(route:string,field='departure.reported',value:unknown={time:'08:00',basis:'scheduled'}){
  return {routeId:route,revision:await revision(route),operation:'correct',field,value,basis:'observed_sign',observedDate:'2026-10-30',reason:'source_checked',reversedActionId:null,expiresAt:Date.now()+300000};
 }
 const apply=async(body:unknown,id=randomUUID(),actor=context().other)=>(await q('SELECT v2_api_admin_core_action($1,$2,$3) r',[actor,id,body])).rows[0].r;
 const legacy=async(route:string)=>(await q('SELECT count(*) n FROM v2_public_lead_reports WHERE subject_id=$1',[route])).rows[0].n;
 const reviewed=async(route:string)=>(await q('SELECT * FROM v2_public_reviewed_lead_reports WHERE subject_id=$1',[route])).rows[0];
 async function reverse(route:string,id:string,field='departure.reported'){
  return apply({...await command(route,field,null),operation:'reverse',reversedActionId:id,basis:'unprovided',observedDate:null,reason:'decision_incorrect'});
 }
 async function invalid(sql:string,values:unknown[],codes=['23514']){
  await q('SAVEPOINT invalid_core');try{await assert.rejects(q(sql,values),(e:any)=>{assert.ok(codes.includes(e.code),e.code+': '+e.message);return true;});}
  finally{await q('ROLLBACK TO SAVEPOINT invalid_core');await q('RELEASE SAVEPOINT invalid_core');}
 }
 test('core correction: changed clock is separately attributed; original report and observations remain immutable',async()=>{
  const f=await fixture(),snapshot=(await q('SELECT payload FROM v2_contributions WHERE id=$1',[f.source])).rows[0].payload,rev=await revision(f.route);
  const r=await apply(await command(f.route));assert.equal(r.outcome,'corrected');assert.equal(r.basis,'observed_sign');
  assert.equal(await legacy(f.route),'0');const p=await reviewed(f.route);assert.equal(p.reported_time.value,'08:00');assert.equal(p.reported_time.basis,'scheduled');
  assert.equal(p.core_corrections.length,1);assert.equal(p.core_corrections[0].field,'departure.reported');assert.equal(p.core_corrections[0].observedDate,'2026-10-30');
  assert.equal(p.operator_report.value,'Original operator');assert.ok(BigInt(await revision(f.route))>BigInt(rev));
  assert.deepEqual((await q('SELECT payload FROM v2_contributions WHERE id=$1',[f.source])).rows[0].payload,snapshot);
  assert.equal((await q("SELECT value->>'time' time FROM v2_observations WHERE contribution_id=$1 AND field_key='departure.reported'",[f.source])).rows[0].time,'07:00');
 });
 test('core correction: all four typed properties use independent current values without a calendar',async()=>{
  const f=await fixture(),city=(await q("INSERT INTO cities(name,place_type) VALUES('Correction city','city') RETURNING id")).rows[0].id;
  assert.equal((await apply(await command(f.route,'route.origin',{cityId:city}))).outcome,'corrected');
  assert.equal((await apply(await command(f.route,'operator.reported',{name:'Corrected operator'}))).outcome,'corrected');
  assert.equal((await apply(await command(f.route,'departure.reported',{time:'00:00',basis:'actual'}))).outcome,'corrected');
  let p=await reviewed(f.route);assert.equal(p.origin.id,city);assert.equal(p.operator_report.value,'Corrected operator');assert.equal(p.reported_time.value,'00:00');
  assert.equal(p.reported_time.basis,'actual');assert.equal(p.core_corrections.length,3);
  await invalid('DELETE FROM cities WHERE id=$1',[city],['23503']);
  await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().other,randomUUID(),await command(f.route,'route.destination',{cityId:city})]);
 });
 test('core correction: exact replay after expiry returns one receipt and a changed payload conflicts',async()=>{
  const f=await fixture(),body=await command(f.route),id=randomUUID(),r=await apply(body,id);
  assert.deepEqual(await apply({...body,expiresAt:Date.now()-1},id),r);
  assert.equal((await q('SELECT count(*) n FROM v2_admin_core_actions WHERE id=$1',[id])).rows[0].n,'1');
  await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().other,id,{...body,reason:'typing_error'}]);
  await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().other,randomUUID(),{...body,expiresAt:Date.now()-1}]);
 });
 test('core correction: stale tab receives a stable changed receipt and cannot overwrite newer value',async()=>{
  const f=await fixture(),body=await command(f.route);await apply(body);const stale=await apply({...body,value:{time:'09:00',basis:'scheduled'}});
  assert.equal(stale.outcome,'changed');assert.equal((await reviewed(f.route)).reported_time.value,'08:00');
 });
 test('core correction: reversing an older change preserves the newer correction and other properties',async()=>{
  const f=await fixture(),a=await apply(await command(f.route)),b=await apply(await command(f.route,'departure.reported',{time:'09:00',basis:'scheduled'}));
  const operator=await apply(await command(f.route,'operator.reported',{name:'Second operator'}));
  assert.equal((await reverse(f.route,a.id)).outcome,'reversed');assert.equal((await reviewed(f.route)).reported_time.value,'09:00');
  assert.equal((await reverse(f.route,b.id)).outcome,'reversed');assert.equal((await reviewed(f.route)).reported_time.value,'07:00');
  assert.equal((await reviewed(f.route)).operator_report.value,'Second operator');assert.equal(await legacy(f.route),'0');
  assert.equal((await reverse(f.route,operator.id,'operator.reported')).outcome,'reversed');assert.equal(await legacy(f.route),'1');
  assert.equal((await reverse(f.route,a.id)).outcome,'already_reversed');
 });
 test('core correction: related initial place evidence blocks identity changes instead of moving the place',async()=>{
  const f=await fixture();await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key)
   VALUES($1,$2,'boarding.pickup',$3,'{}',v2_assessment_hash('{}'),v2_assessment_hash($3::jsonb))`,[f.source,f.route,{cityId:context().origin,name:'Keep this pickup'}]);
  assert.equal((await apply(await command(f.route))).outcome,'unsafe_dependencies');assert.equal(await legacy(f.route),'1');
  assert.equal((await reviewed(f.route)).reported_time.value,'07:00');
 });
 test('core correction: erasing the correcting administrator redacts copied evidence without resurrecting a rejected original',async()=>{
  const f=await fixture(),r=await apply(await command(f.route));await q('DELETE FROM users WHERE id=$1',[context().other]);
  const a=(await q('SELECT * FROM v2_admin_core_actions WHERE id=$1',[r.id])).rows[0];
  assert.equal(a.proposed_value,null);assert.equal(a.request_digest,null);assert.equal(a.observed_date,null);assert.equal(a.actor_user_id,null);
  assert.equal(await legacy(f.route),'0');assert.equal(await reviewed(f.route),undefined);
 });
 test('core correction: source erasure and administrative removal stay effective in every projection',async()=>{
  const f=await fixture();await apply(await command(f.route));
  const visibility={routeId:f.route,revision:await revision(f.route),operation:'remove',reason:'inaccurate',removalId:null,expiresAt:Date.now()+300000};
  await q('SELECT v2_api_admin_route_action($1,$2,$3)',[context().other,randomUUID(),visibility]);assert.equal(await reviewed(f.route),undefined);
  const g=await fixture(),r=await apply(await command(g.route));await q('DELETE FROM v2_contributions WHERE id=$1',[g.source]);
  assert.equal(await reviewed(g.route),undefined);assert.equal((await q('SELECT proposed_value FROM v2_admin_core_actions WHERE id=$1',[r.id])).rows[0].proposed_value,null);
 });
 test('core correction: revoked/public accounts and direct backend edits cannot mutate or read private receipts',async()=>{
  const f=await fixture(),body=await command(f.route);
  await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().user,randomUUID(),body],['42501']);
  await q('SET LOCAL ROLE mabhazi_api');await invalid("UPDATE v2_admin_core_actions SET reason_code='typing_error'",[],['42501']);
  await invalid('SELECT v2_admin_core_dependency_count($1)',[f.route],['42501']);await q('RESET ROLE');
  await q('UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL',[context().other]);
  await invalid('SELECT v2_api_admin_core_receipt($1,$2)',[context().other,randomUUID()],['42501']);
 });
 test('core correction: invalid clocks and city self-loops cannot become correction evidence',async()=>{
  const f=await fixture();for(const value of [{time:'24:00',basis:'scheduled'},{time:'08:00',basis:'daily'}])
   await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().other,randomUUID(),await command(f.route,'departure.reported',value)]);
  await invalid('SELECT v2_api_admin_core_action($1,$2,$3)',[context().other,randomUUID(),await command(f.route,'route.origin',{cityId:context().destination})]);
 });
}
