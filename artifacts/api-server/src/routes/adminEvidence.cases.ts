import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
import {adminDigest,parseAdminSelection} from '../lib/adminEvidence';

type Context={admin:pg.Client;base:string;accounts:string[];tokens:string[];cities:number[];leadBody:()=>Record<string,unknown>};
export function registerAdminEvidenceTests(context:()=>Context){
 const owner=randomUUID(),token=randomBytes(32).toString('hex');let route:string;let second:string;
 const query=(text:string,values:unknown[]=[])=>context().admin.query(text,values);
 async function call(path:string,body?:unknown,sid:string|null=token,extra:Record<string,string>={}){
  const response=await fetch(context().base+'/admin-console'+path,{method:body===undefined?'GET':'POST',
   headers:{...(sid?{Authorization:'Bearer '+sid}:{}),'Content-Type':'application/json','X-Mabhazi-Account':owner,Origin:'https://api.mabhazi.com',...extra},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,value:await response.json(),headers:response.headers};
 }
 test('admin evidence: guest and ordinary identity cannot read a claim or preview a batch',async()=>{
  const selection={routeIds:[randomUUID()],fields:['operator.reported']};
  for(const sid of [null,context().tokens[0]]){
   assert.equal((await call('/evidence?record='+randomUUID(),undefined,sid)).status,sid?403:401);
   assert.equal((await call('/preview',selection,sid)).status,sid?403:401);
  }
 });
 test('admin evidence: original assertions and observations retain separate stable typed identities',async()=>{
  await query('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Evidence Owner']);
  await query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:owner},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);
  for(const index of [0,1]){
   const result=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{Authorization:'Bearer '+context().tokens[0],'X-Mabhazi-Account':context().accounts[0],'Content-Type':'application/json'},body:JSON.stringify(context().leadBody())});
   assert.equal(result.status,200);const saved=await result.json() as {subjectId:string};if(index===0)route=saved.subjectId;else second=saved.subjectId;
  }
  const result=await call('/evidence?record='+route);assert.equal(result.status,200);
  assert.equal(result.value.claims.length,4);assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(result.value.claims.map((c:any)=>c.field).sort(),['departure.reported','operator.reported','route.destination','route.origin']);
  for(const c of result.value.claims){assert.equal(c.routeId,route);assert.equal(c.review,'pending');assert.match(c.digest,/^[0-9a-f]{64}$/);assert.equal(c.basis,'unprovided');}
  const origin=result.value.claims.find((c:any)=>c.field==='route.origin');assert.equal(origin.observationId,null);assert.equal(origin.value.id,context().cities[0]);
  assert.ok(!JSON.stringify(result.value).includes(token));assert.ok(!JSON.stringify(result.value).includes('synthetic-test-token'));
 });
 test('admin evidence: separately scoped fares keep their own currency, service date and segment',async()=>{
  const revision=Number((await query('SELECT revision FROM v2_subjects WHERE id=$1',[route])).rows[0].revision);
  const serviceDate=new Date().toISOString().slice(0,10);
  for(const [amount,currency] of [['15','USD'],['270','ZAR']]){
   const input={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',
    target:{newActualJourney:{intendedSubject:{id:route,kind:'lead',expectedRevision:revision}}},
    observations:[{fieldKey:'fare.paid',value:{amount,currency},scope:{schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:context().cities[0],destinationCityId:context().cities[1]},serviceDate,passengerCategory:'unknown',ticketBasis:'unknown'}}]};
   const saved=await fetch(context().base+'/v2/actual-journeys',{method:'POST',headers:{Authorization:'Bearer '+context().tokens[0],'X-Mabhazi-Account':context().accounts[0],'Content-Type':'application/json'},body:JSON.stringify(input)});
   assert.equal(saved.status,200);
  }
  const result=await call('/evidence?record='+route);assert.equal(result.status,200);
  const fares=result.value.claims.filter((c:any)=>c.field==='fare.paid');assert.equal(fares.length,2);
  assert.deepEqual(fares.map((c:any)=>c.value.currency).sort(),['USD','ZAR']);
  assert.notEqual(fares[0].id,fares[1].id);assert.notEqual(fares[0].subjectId,fares[1].subjectId);
  for(const c of fares){assert.equal(c.scope.serviceDate,serviceDate);assert.equal(c.scope.segment.originCityId,context().cities[0]);assert.equal(c.review,'pending');}
 });
 test('admin evidence: one batch preview binds exact chosen fields and does not write review decisions',async()=>{
  const before=(await query('SELECT count(*) FROM v2_review_decisions')).rows[0].count;
  const selection={routeIds:[route,second],fields:['fare.paid']},result=await call('/preview',selection);
  assert.equal(result.status,200);assert.deepEqual(result.value.selection,selection);assert.equal(result.value.claims.length,2);
  assert.deepEqual(result.value.missing,[{routeId:second,field:'fare.paid'}]);assert.equal(result.value.writable,false);
  assert.equal((await query('SELECT count(*) FROM v2_review_decisions')).rows[0].count,before);
  assert.equal(result.value.digest,(await call('/preview',selection)).value.digest);
  assert.notEqual(result.value.digest,(await call('/preview',{routeIds:[route,second],fields:['operator.reported']})).value.digest);
 });
 test('admin evidence: no actor injection, cross-origin request or changed account can preview',async()=>{
  const selection={routeIds:[route],fields:['operator.reported']};
  assert.equal((await call('/preview',selection,token,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await call('/preview',selection,token,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/preview',{...selection,actor:owner})).status,422);
  assert.equal((await call('/preview',{...selection,fields:['role.administrator']})).status,422);
  assert.equal((await call('/preview',{...selection,routeIds:[route,route]})).status,422);
  assert.equal((await call('/preview',{...selection,routeIds:[route,randomUUID()]})).status,409);
  assert.equal((await call('/evidence?record='+route+'&actor='+owner)).status,400);
  assert.equal((await call('/evidence?record=1')).status,400);
 });
 test('admin evidence: stable canonical digests and bounded strict selections',()=>{
  assert.equal(adminDigest({b:{z:1,a:2},a:[3,4]}),adminDigest({a:[3,4],b:{a:2,z:1}}));
  assert.notEqual(adminDigest({scope:{currency:'USD'}}),adminDigest({scope:{currency:'ZAR'}}));
  assert.equal(parseAdminSelection({routeIds:[],fields:['operator.reported']}),null);
  assert.equal(parseAdminSelection({routeIds:Array.from({length:101},()=>randomUUID()),fields:['operator.reported']}),null);
  assert.equal(parseAdminSelection({routeIds:[randomUUID()],fields:['operator.reported','operator.reported']}),null);
 });
 test('admin evidence: current role revocation and deleted identity close reads and previews',async()=>{
  await query("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL",[owner]);
  assert.equal((await call('/evidence?record='+route)).status,403);
  assert.equal((await call('/preview',{routeIds:[route],fields:['operator.reported']})).status,403);
  await query('DELETE FROM users WHERE id=$1',[owner]);
  assert.equal((await call('/evidence?record='+route)).status,401);
  await query('DELETE FROM sessions WHERE sid=$1',[token]);
 });
}
