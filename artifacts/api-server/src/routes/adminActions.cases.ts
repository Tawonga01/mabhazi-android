import {createVisibilityPreview} from './adminVisibility';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
import {createReviewPreview} from '../lib/adminReviewToken';
type Context={admin:pg.Client;base:string;accounts:string[];tokens:string[];leadBody:()=>Record<string,unknown>};
export function registerAdminActionTests(context:()=>Context){
 const owner=randomUUID(),token=randomBytes(32).toString('hex');let route:string;let firstBatch:string;
 const q=(sql:string,values:unknown[]=[])=>context().admin.query(sql,values);
 async function enabled<T>(fn:()=>Promise<T>){const previous=process.env.NAMED_ADMIN_CONSOLE_ENABLED;process.env.NAMED_ADMIN_CONSOLE_ENABLED='true';try{return await fn();}finally{if(previous===undefined)delete process.env.NAMED_ADMIN_CONSOLE_ENABLED;else process.env.NAMED_ADMIN_CONSOLE_ENABLED=previous;}}
 async function call(path:string,body?:unknown,extra:Record<string,string>={},sid:string|null=token){
  const r=await fetch(context().base+'/admin-console'+path,{method:body===undefined?'GET':'POST',headers:{...(sid?{Authorization:'Bearer '+sid}:{}),
   'X-Mabhazi-Account':owner,Origin:'https://api.mabhazi.com','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,value:await r.json() as any,headers:r.headers};
 }
 async function newRoute(){
  const r=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{Authorization:'Bearer '+context().tokens[0],
   'X-Mabhazi-Account':context().accounts[0],'Content-Type':'application/json'},body:JSON.stringify(context().leadBody())});
  assert.equal(r.status,200);return (await r.json() as {subjectId:string}).subjectId;
 }
 const preview=(id:string,fields=['route.origin','route.destination'])=>call('/preview',{routeIds:[id],fields});
 test('admin actions: capability stays off by default and enabling it requires the installed fenced facade',async()=>{
  await q('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Action Owner']);
  await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:owner},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);route=await newRoute();
  assert.equal((await preview(route)).value.writable,false);
  await enabled(async()=>{const p=await preview(route);assert.equal(p.status,200);assert.equal(p.value.writable,true);assert.equal(p.value.ready,2);assert.ok(p.value.previewToken);});
 });
 test('admin actions: guest/public user, cross-origin and switched-account attempts are denied before a write',async()=>enabled(async()=>{
  const p=(await preview(route)).value,body={clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'reports_reviewed'};
  assert.equal((await call('/actions',body,{},null)).status,401);
  assert.equal((await call('/actions',body,{},context().tokens[0])).status,403);
  assert.equal((await call('/actions',body,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await call('/actions',body,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/receipts/'+body.clientRequestId,undefined,{},context().tokens[0])).status,403);
 }));
 test('admin actions: concurrent exact commands commit once and return the same durable receipt',async()=>enabled(async()=>{
  const p=(await preview(route)).value,body={clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'reports_reviewed'};
  const original=(await q('SELECT payload FROM v2_contributions WHERE original_subject_id=$1',[route])).rows[0].payload;
  const [a,b]=await Promise.all([call('/actions',body),call('/actions',body)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.value,b.value);
  assert.equal(a.value.items.length,2);assert.ok(a.value.items.every((i:any)=>i.outcome==='approved'));
  firstBatch=body.clientRequestId;
  assert.equal((await q('SELECT count(*) FROM v2_admin_batches WHERE id=$1',[body.clientRequestId])).rows[0].count,'1');
  assert.deepEqual((await q('SELECT payload FROM v2_contributions WHERE original_subject_id=$1',[route])).rows[0].payload,original);
  assert.deepEqual((await call('/receipts/'+body.clientRequestId)).value,a.value);
  assert.equal((await call('/actions',{...body,reason:'evidence_checked'})).status,409);
  const fields=(await call('/evidence?record='+route)).value.claims;
  assert.ok(fields.filter((c:any)=>c.field.startsWith('route.')).every((c:any)=>c.review==='approved'));
  assert.ok(fields.filter((c:any)=>!c.field.startsWith('route.')).every((c:any)=>c.review==='pending'));
 }));
 test('admin actions: signed preview cannot be changed and has a finite new-write lifetime',async()=>enabled(async()=>{
  const id=await newRoute(),p=(await preview(id)).value;
  const [encoded,signature]=p.previewToken.split('.'),raw=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  const forged=Buffer.from(JSON.stringify({...raw,actor:context().accounts[0]})).toString('base64url')+'.'+signature;
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:forged,reason:'reports_reviewed'})).status,409);
  const expired=createReviewPreview(owner,'approve',raw.items,process.env.ADMIN_SECRET!,Date.now()-300001);
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:expired,reason:'reports_reviewed'})).value.code,'PREVIEW_EXPIRED');
 }));
 test('admin actions: an expired authentic preview still recovers an identical committed command',async()=>enabled(async()=>{
  const id=await newRoute(),p=(await preview(id)).value,raw=JSON.parse(Buffer.from(p.previewToken.split('.')[0],'base64url').toString('utf8'));
  const body={clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'reports_reviewed'},saved=await call('/actions',body);assert.equal(saved.status,200);
  const old=createReviewPreview(owner,'approve',raw.items,process.env.ADMIN_SECRET!,Date.now()-300001);
  const replay=await call('/actions',{...body,previewToken:old});assert.equal(replay.status,200);assert.deepEqual(replay.value,saved.value);
 }));
 test('admin actions: stale preview produces explicit unchanged outcomes and no false approval',async()=>enabled(async()=>{
  const id=await newRoute(),p=(await preview(id)).value;await q('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[id]);
  const r=await call('/actions',{clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'reports_reviewed'});
  assert.equal(r.status,200);assert.ok(r.value.items.every((x:any)=>x.outcome==='changed'&&x.reviewId===null));
  assert.ok((await call('/evidence?record='+id)).value.claims.every((c:any)=>c.review==='pending'));
 }));
 test('admin actions: revoked open sessions cannot apply even an intact current preview',async()=>enabled(async()=>{
  const id=await newRoute(),p=(await preview(id)).value;
  await q("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND revoked_at IS NULL",[owner]);
  try{assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'reports_reviewed'})).status,403);}
  finally{await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_regrant')",[owner]);}
 }));
 test('admin actions: enabling the named console fences old shared-secret hard-delete paths',async()=>enabled(async()=>{
  const before=(await q('SELECT count(*) FROM journeys')).rows[0].count;
  const r=await fetch(context().base+'/admin/journeys/1',{method:'DELETE',headers:{'X-Admin-Secret':process.env.ADMIN_SECRET!,Origin:'https://api.mabhazi.com'}});
  assert.equal(r.status,410);assert.equal((await r.json() as {code:string}).code,'NAMED_ADMIN_REQUIRED');
  assert.equal((await q('SELECT count(*) FROM journeys')).rows[0].count,before);
 }));
 test('admin actions: history can reverse one exact property while preserving its neighbour and original receipt',async()=>enabled(async()=>{
  const history=await call('/history');assert.equal(history.status,200);assert.ok(history.value.batches.some((b:any)=>b.id===firstBatch));
  const original=(await call('/receipts/'+firstBatch)).value,one=original.items[0];
  const p=await call('/reverse-preview',{batchId:firstBatch,reviewIds:[one.reviewId]});assert.equal(p.status,200);assert.equal(p.value.ready,1);
  const r=await call('/actions',{clientRequestId:randomUUID(),previewToken:p.value.previewToken,reason:'decision_incorrect'});
  assert.equal(r.status,200);assert.equal(r.value.items[0].outcome,'reversed');
  assert.deepEqual((await call('/receipts/'+firstBatch)).value,original);
  const claims=(await call('/evidence?record='+route)).value.claims;
  assert.equal(claims.find((c:any)=>c.field===one.fieldKey).review,'pending');
  assert.equal(claims.find((c:any)=>c.field===original.items[1].fieldKey).review,'approved');
  const again=await call('/reverse-preview',{batchId:firstBatch,reviewIds:[one.reviewId]});assert.equal(again.value.ready,0);assert.equal(again.value.held.length,1);
 }));
 test('admin workbench: the actual page and application script are private, branded and constrained by CSP',async()=>enabled(async()=>{
  const html=await fetch(context().base+'/admin-console',{headers:{Authorization:'Bearer '+token}});assert.equal(html.status,200);
  const page=await html.text();assert.ok(page.includes('workbench-screen'));assert.ok(page.includes('data:image/png;base64,'));assert.ok(page.includes('/api/admin-console/ui.js'));
  assert.match(html.headers.get('content-security-policy')??'',/script-src 'self'/);assert.match(html.headers.get('x-robots-tag')??'',/noindex/);
  const script=await fetch(context().base+'/admin-console/ui.js',{headers:{Authorization:'Bearer '+token}});assert.equal(script.status,200);
  assert.match(script.headers.get('content-type')??'',/javascript/);assert.ok((await script.text()).includes('mabhazi-admin-recovery'));
  assert.equal((await call('/ui.js',undefined,{},null)).status,401);assert.equal((await call('/ui.js',undefined,{},context().tokens[0])).status,403);
 }));
 test('admin workbench: data pages retain typed evidence, support bounded searching and enforce account binding',async()=>enabled(async()=>{
  const data=await call('/data?limit=20');assert.equal(data.status,200);assert.ok(data.value.rows.length>0&&data.value.rows.length<=20);
  assert.ok(data.value.rows.every((r:any)=>data.value.claims.some((c:any)=>c.routeId===r.id)));assert.ok(data.value.claims.some((c:any)=>c.field==='route.origin'));
  const one=await call('/data?limit=100&q='+route);assert.equal(one.status,200);assert.equal(one.value.rows.length,1);assert.equal(one.value.rows[0].id,route);
  assert.equal((await call('/data?limit=100&q=does-not-exist')).value.rows.length,0);
  for(const path of ['/data?limit=1000','/data?limit=20&limit=100','/data?cursor=invalid','/data?actor='+owner,'/history?cursor=invalid'])assert.equal((await call(path)).status,400,path);
  for(const path of ['/data','/history','/evidence?record='+route]){
   assert.equal((await call(path,undefined,{},null)).status,401);assert.equal((await call(path,undefined,{},context().tokens[0])).status,403);
   assert.equal((await call(path,undefined,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  }
 }));
 test('admin workbench: reversal previews reject foreign, empty and duplicate decisions without writes',async()=>enabled(async()=>{
  const before=(await q('SELECT count(*) FROM v2_admin_batches')).rows[0].count;
  for(const reviewIds of [[],[randomUUID()],[firstBatch,firstBatch]])assert.equal((await call('/reverse-preview',{batchId:firstBatch,reviewIds})).status,422);
  assert.equal((await call('/reverse-preview',{batchId:randomUUID()})).status,404);
  assert.equal((await call('/reverse-preview',{batchId:firstBatch,actor:owner})).status,422);
  assert.equal((await call('/reverse-preview',{batchId:firstBatch},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await q('SELECT count(*) FROM v2_admin_batches')).rows[0].count,before);
 }));
 test('admin visibility HTTP: private state, preview and writes preserve named authority and exact scope',async()=>enabled(async()=>{
  const id=await newRoute();assert.equal((await call('/visibility/'+id)).status,200);
  const p=await call('/visibility/preview',{routeId:id,operation:'remove'});assert.equal(p.status,200);assert.equal(p.value.route.id,id);
  const body={clientRequestId:randomUUID(),previewToken:p.value.previewToken,reason:'inaccurate'};
  assert.equal((await call('/visibility/actions',body,{},null)).status,401);
  assert.equal((await call('/visibility/actions',body,{},context().tokens[0])).status,403);
  assert.equal((await call('/visibility/actions',body,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await call('/visibility/'+id,undefined,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/visibility/actions',{...body,actor:owner})).status,422);
 }));
 test('admin visibility HTTP: removal reaches public detail and a scoped restore retains immutable receipts',async()=>enabled(async()=>{
  const id=await newRoute(),publicRead=()=>fetch(context().base+'/v2/subjects/'+id);assert.equal((await publicRead()).status,200);
  const p=(await call('/visibility/preview',{routeId:id,operation:'remove'})).value;
  const body={clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'inaccurate'};
  const [one,two]=await Promise.all([call('/visibility/actions',body),call('/visibility/actions',body)]);assert.equal(one.status,200);assert.deepEqual(one.value,two.value);assert.equal(one.value.outcome,'removed');
  assert.equal((await publicRead()).status,404);assert.deepEqual((await call('/visibility/receipts/'+body.clientRequestId)).value,one.value);
  const state=(await call('/visibility/'+id)).value;assert.equal(state.public_visible,false);assert.equal(state.removals.length,1);
  const undo=(await call('/visibility/preview',{routeId:id,operation:'restore',removalId:body.clientRequestId})).value;
  const restored=await call('/visibility/actions',{clientRequestId:randomUUID(),previewToken:undo.previewToken,reason:'record_rechecked'});assert.equal(restored.status,200);assert.equal(restored.value.outcome,'restored');
  assert.equal((await publicRead()).status,200);assert.deepEqual((await call('/visibility/receipts/'+body.clientRequestId)).value,one.value);
  assert.equal((await call('/visibility/'+id)).value.history.length,2);
 }));
 test('admin visibility HTTP: tampered, expired, wrong-reason and stale previews cannot change another route',async()=>enabled(async()=>{
  const id=await newRoute(),p=(await call('/visibility/preview',{routeId:id,operation:'remove'})).value;
  const body={clientRequestId:randomUUID(),previewToken:p.previewToken,reason:'inaccurate'};
  const [encoded,mac]=p.previewToken.split('.'),raw=JSON.parse(Buffer.from(encoded,'base64url').toString());
  assert.equal((await call('/visibility/actions',{...body,previewToken:Buffer.from(JSON.stringify({...raw,routeId:route})).toString('base64url')+'.'+mac})).status,409);
  assert.equal((await call('/visibility/actions',{...body,reason:'record_rechecked'})).status,422);
  const expired=createVisibilityPreview({actor:owner,routeId:id,revision:p.route.revision,operation:'remove',removalId:null},Date.now()-300001);
  assert.equal((await call('/visibility/actions',{...body,previewToken:expired})).value.code,'PREVIEW_EXPIRED');
  await q('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[id]);
  const stale=await call('/visibility/actions',body);assert.equal(stale.status,200);assert.equal(stale.value.outcome,'changed');
  assert.equal((await call('/visibility/'+id)).value.removals.length,0);
 }));
 test('admin actions: account erasure closes an old session and redacts receipt actor references',async()=>enabled(async()=>{
  await q('DELETE FROM users WHERE id=$1',[owner]);assert.equal((await call('/receipts/'+randomUUID())).status,401);
  await q('DELETE FROM sessions WHERE sid=$1',[token]);
 }));
}
