import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
type Context={admin:pg.Client;base:string;accounts:string[];tokens:string[];leadBody:()=>Record<string,unknown>};
export function registerAdminCoreApiTests(context:()=>Context){
 const owner=randomUUID(),token=randomBytes(32).toString('hex');let route:string;
 const q=(sql:string,values:unknown[]=[])=>context().admin.query(sql,values);
 async function enabled<T>(fn:()=>Promise<T>){const a=process.env.NAMED_ADMIN_CONSOLE_ENABLED,b=process.env.NAMED_ADMIN_CORE_CORRECTIONS_ENABLED;
  process.env.NAMED_ADMIN_CONSOLE_ENABLED='true';process.env.NAMED_ADMIN_CORE_CORRECTIONS_ENABLED='true';
  try{return await fn();}finally{if(a===undefined)delete process.env.NAMED_ADMIN_CONSOLE_ENABLED;else process.env.NAMED_ADMIN_CONSOLE_ENABLED=a;if(b===undefined)delete process.env.NAMED_ADMIN_CORE_CORRECTIONS_ENABLED;else process.env.NAMED_ADMIN_CORE_CORRECTIONS_ENABLED=b;}}
 async function call(path:string,body?:unknown,extra:Record<string,string>={},sid:string|null=token){const r=await fetch(context().base+'/admin-console/corrections'+path,
  {method:body===undefined?'GET':'POST',headers:{...(sid?{Authorization:'Bearer '+sid}:{}),'X-Mabhazi-Account':owner,Origin:'https://api.mabhazi.com','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,value:await r.json() as any,headers:r.headers};}
 const proposal=()=>({routeId:route,operation:'correct',field:'departure.reported',value:{time:'08:00',basis:'scheduled'},basis:'observed_sign',observedDate:'2026-10-30',reason:'source_checked',reversedActionId:null});
 test('core API: correction capability is explicit and the named owner can inspect original/current evidence',async()=>{
  await q('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Core test owner']);
  await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:owner},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);
  const saved=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{Authorization:'Bearer '+context().tokens[0],'X-Mabhazi-Account':context().accounts[0],'Content-Type':'application/json'},body:JSON.stringify(context().leadBody())});
  assert.equal(saved.status,200);route=(await saved.json() as any).subjectId;
  assert.equal((await call('/'+route)).status,503);
  await enabled(async()=>{const r=await call('/'+route);assert.equal(r.status,200);assert.equal(r.value.current['departure.reported'].time,'00:00');assert.equal(Number(r.value.dependencies),0);assert.match(r.headers.get('cache-control')??'',/no-store/);});
 });
 test('core API: public, changed-account, cross-origin and actor-injected writes fail before changing data',async()=>enabled(async()=>{
  assert.equal((await call('/'+route,undefined,{},null)).status,401);
  assert.equal((await call('/preview',proposal(),{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/preview',proposal(),{Origin:'https://other.example'})).status,403);
  assert.equal((await call('/preview',{...proposal(),actor:owner})).status,422);
  assert.equal((await q('SELECT count(*) n FROM v2_admin_core_actions WHERE route_subject_id=$1',[route])).rows[0].n,'0');
 }));
 test('core API: approved preview saves a scoped correction and its receipt recovers the exact committed action',async()=>enabled(async()=>{
  const p=await call('/preview',proposal());assert.equal(p.status,200);assert.ok(p.value.previewToken);
  const body={clientRequestId:randomUUID(),previewToken:p.value.previewToken},saved=await call('/actions',body);
  assert.equal(saved.status,200);assert.equal(saved.value.outcome,'corrected');assert.equal(saved.value.field,'departure.reported');
  assert.deepEqual((await call('/actions',body)).value,saved.value);assert.deepEqual((await call('/receipts/'+body.clientRequestId)).value,saved.value);
  const state=await call('/'+route);assert.equal(state.value.current['departure.reported'].time,'08:00');assert.equal(state.value.original['departure.reported'].time,'00:00');
  assert.equal(state.value.history.length,1);
 }));
 test('core API: supported public readers share corrected values/provenance while old readers withhold the original',async()=>enabled(async()=>{
  const modern={'X-Mabhazi-Route-Display':'reviewed-core/1'};
  const old=await fetch(context().base+'/v2/subjects/'+route);assert.equal(old.status,404);
  const response=await fetch(context().base+'/v2/subjects/'+route,{headers:modern});assert.equal(response.status,200);
  assert.match(response.headers.get('vary')??'',/X-Mabhazi-Route-Display/i);
  const displayed=(await response.json() as any).subject;assert.equal(displayed.reportedTime.value,'08:00');assert.equal(displayed.timedDepartureEligible,false);
  assert.equal(displayed.contributionTargetEligible,false);assert.equal(displayed.coreCorrections[0].field,'departure.reported');
  assert.equal(displayed.coreCorrections[0].basis,'observed_sign');assert.equal(displayed.coreCorrections[0].observedDate,'2026-10-30');
  assert.equal(JSON.stringify(displayed).includes(owner),false);
  let cursor:string|undefined,found:any;
  for(let n=0;n<30;n++){const r=await fetch(context().base+'/v2/search?originCityId='+displayed.origin.id+'&destinationCityId='+displayed.destination.id+(cursor?'&cursor='+cursor:''),{headers:modern});
   assert.equal(r.status,200);const data=await r.json() as any;found=data.items.find((i:any)=>i.subjectId===route);if(found||!data.nextCursor)break;cursor=data.nextCursor;}
  assert.ok(found);assert.deepEqual(found.coreCorrections,displayed.coreCorrections);assert.equal(found.reportedTime.value,'08:00');
  const board=await fetch(context().base+'/v2/departure-board?originKey=city:'+displayed.origin.id,{headers:modern});assert.equal(board.status,200);
  const entry=(await board.json() as any).entries.find((i:any)=>i.subjectId===route);assert.ok(entry);assert.equal(entry.reportedTime,'08:00');
  assert.equal(entry.countdownEligible,false);assert.equal(entry.nextDepartureAt,undefined);assert.deepEqual(entry.coreCorrections,displayed.coreCorrections);
  const unknown=await fetch(context().base+'/v2/subjects/'+route,{headers:{'X-Mabhazi-Route-Display':'future'}});assert.equal(unknown.status,400);
 }));
 test('core API: stale proposal returns an unchanged receipt and reversal preserves original evidence',async()=>enabled(async()=>{
  const preview=await call('/preview',{...proposal(),value:{time:'09:00',basis:'scheduled'}});
  const later=await call('/preview',{...proposal(),field:'operator.reported',value:{name:'Core corrected operator'}});
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:later.value.previewToken})).value.outcome,'corrected');
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:preview.value.previewToken})).value.outcome,'changed');
  const state=(await call('/'+route)).value,clock=state.history.find((a:any)=>a.field==='departure.reported'&&a.outcome==='corrected');
  const reverse=await call('/preview',{...proposal(),operation:'reverse',value:null,basis:'unprovided',observedDate:null,reason:'decision_incorrect',reversedActionId:clock.id});
  assert.equal(reverse.status,200);assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:reverse.value.previewToken})).value.outcome,'reversed');
  const current=(await call('/'+route)).value.current;assert.equal(current['departure.reported'].time,'00:00');assert.equal(current['operator.reported'].name,'Core corrected operator');
 }));
 test('core API: role revocation denies the open editor and receipt recovery',async()=>enabled(async()=>{
  await q('UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL',[owner]);
  assert.equal((await call('/'+route)).status,403);assert.equal((await call('/receipts/'+randomUUID())).status,403);
 }));
}
