import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type pg from 'pg';
import {createTimetablePreview,type TimetableProposal} from '../lib/adminTimetable';
type Context={admin:pg.Client;base:string;accounts:string[];tokens:string[];cities:number[]};
export function registerAdminTimetableApiTests(context:()=>Context){
 const owner=randomUUID(),token=randomBytes(32).toString('hex');
 const q=(sql:string,args:unknown[]=[])=>context().admin.query(sql,args);
 const facades=['v2_api_admin_timetable_preview(varchar,jsonb)','v2_api_admin_timetable_action(varchar,uuid,jsonb)',
  'v2_api_admin_timetable_receipt(varchar,uuid)','v2_api_admin_timetable_operators(varchar,text)'];
 // Test-only grants in isolated CI PostgreSQL. No migration grants these rights.
 async function enabled<T>(fn:()=>Promise<T>,grant=true){
  const a=process.env.NAMED_ADMIN_CONSOLE_ENABLED,b=process.env.NAMED_ADMIN_TIMETABLES_ENABLED;
  process.env.NAMED_ADMIN_CONSOLE_ENABLED='true';process.env.NAMED_ADMIN_TIMETABLES_ENABLED='true';
  try{if(grant)for(const f of facades)await q('GRANT EXECUTE ON FUNCTION public.'+f+' TO mabhazi_api');return await fn();}
  finally{if(grant)for(const f of facades)await q('REVOKE ALL ON FUNCTION public.'+f+' FROM mabhazi_api');
   if(a===undefined)delete process.env.NAMED_ADMIN_CONSOLE_ENABLED;else process.env.NAMED_ADMIN_CONSOLE_ENABLED=a;
   if(b===undefined)delete process.env.NAMED_ADMIN_TIMETABLES_ENABLED;else process.env.NAMED_ADMIN_TIMETABLES_ENABLED=b;}
 }
 async function call(path:string,body?:unknown,extra:Record<string,string>={},sid:string|null=token){
  const r=await fetch(context().base+'/admin-console/timetables'+path,{method:body===undefined?'GET':'POST',headers:{
   ...(sid?{Authorization:'Bearer '+sid}:{}),'X-Mabhazi-Account':owner,Origin:'https://api.mabhazi.com','Content-Type':'application/json',...extra},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,value:await r.json() as any,headers:r.headers};
 }
 async function proposal():Promise<TimetableProposal>{const c=context(),day=(await q("SELECT (statement_timestamp() AT TIME ZONE 'Africa/Harare')::date::text AS checked_date")).rows[0].checked_date;
  return{version:1,operator:'Private API timetable '+randomUUID().slice(0,8),operatorRef:null,separateOperator:false,
   originCityId:c.cities[0],destinationCityId:c.cities[1],pickup:'API timetable boarding',dropoff:null,timezone:'Africa/Harare',weekdays:[1,2,3,4,5],
   validFrom:day,validUntil:day.slice(0,4)+'-12-31',source:{kind:'operator_confirmation',reference:'Synthetic isolated API fixture',checkedOn:day},
   departures:[{departure:'06:00',arrival:null,arrivalDay:0,fare:null},{departure:'13:30',arrival:null,arrivalDay:0,fare:null}]};
 }
 test('timetable API: named authority, feature flag and all four executable facades are required independently',async()=>{
  await q('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Timetable fixture owner']);
  await q("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id:owner},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);
  await enabled(async()=>{assert.equal((await call('/state')).status,503);},false);
  await enabled(async()=>{const r=await call('/state');assert.equal(r.status,200);assert.deepEqual(r.value,{available:true});assert.match(r.headers.get('cache-control')??'',/no-store/);});
  await enabled(async()=>{await q('REVOKE ALL ON FUNCTION public.'+facades[3]+' FROM mabhazi_api');assert.equal((await call('/state')).status,503);});
 });
 test('timetable API: guest, ordinary user, changed account, cross-origin and actor-injected bodies cannot create commands',async()=>enabled(async()=>{
  const p=await proposal(),before=(await q('SELECT count(*) n FROM v2_admin_timetables')).rows[0].n;
  assert.equal((await call('/preview',p,{},null)).status,401);
  assert.equal((await call('/preview',p,{},context().tokens[0])).status,403);
  assert.equal((await call('/preview',p,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
  assert.equal((await call('/preview',p,{Origin:'https://other.example'})).status,403);
  assert.equal((await call('/preview',{...p,actor:owner})).status,422);
  assert.equal((await q('SELECT count(*) n FROM v2_admin_timetables')).rows[0].n,before);
 }));
 test('timetable API: two concurrent exact approvals commit once and receipts recover the original two departures',async()=>enabled(async()=>{
  const p=await proposal(),review=await call('/preview',p);assert.equal(review.status,200);assert.equal(review.value.writable,true);
  assert.deepEqual(review.value.proposal,p);const body={clientRequestId:randomUUID(),previewToken:review.value.previewToken};
  const [a,b]=await Promise.all([call('/actions',body),call('/actions',body)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.value,b.value);
  assert.equal(a.value.id,body.clientRequestId);assert.equal(a.value.departureCount,2);assert.equal(a.value.outcome,'approved');
  assert.equal((await q('SELECT count(*) n FROM v2_admin_timetable_entries WHERE timetable_id=$1',[body.clientRequestId])).rows[0].n,'2');
  assert.deepEqual((await call('/receipts/'+body.clientRequestId)).value,a.value);
  const duplicate=await call('/preview',p);assert.equal(duplicate.status,200);assert.equal(duplicate.value.writable,false);assert.ok(duplicate.value.duplicates.some((d:any)=>d.kind==='timetable'));
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:duplicate.value.previewToken})).status,409);
  const raw=JSON.parse(Buffer.from(review.value.previewToken.split('.')[0],'base64url').toString('utf8'));
  const expired=createTimetablePreview(p,owner,raw.stateDigest,process.env.ADMIN_SECRET!,Date.now()-300001);
  const replay=await call('/actions',{...body,previewToken:expired});assert.equal(replay.status,200);assert.deepEqual(replay.value,a.value);
 }));
 test('timetable API: stale previews, duplicate departures, unknown optional values and unsafe keys remain explicit',async()=>enabled(async()=>{
  const p=await proposal();p.originCityId=(await q("INSERT INTO cities(name,place_type) VALUES('Isolated timetable preview city','city') RETURNING id")).rows[0].id;
  const review=await call('/preview',p);assert.equal(review.status,200);
  await q('UPDATE cities SET name=name||$2 WHERE id=$1',[p.originCityId,' timetable change']);
  const stale=await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken});assert.equal(stale.status,409);assert.equal(stale.value.code,'PREVIEW_CHANGED');
  assert.equal((await call('/preview',{...p,weekdays:[]})).status,422);
  assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken,actor:owner})).status,422);
  assert.equal((await call('/operators?q=x&extra=1')).status,400);
  await q('DELETE FROM cities WHERE id=$1',[p.originCityId]);
 }));
 test('timetable API: revoked owner cannot use an intact signed preview or recover private receipts',async()=>enabled(async()=>{
  const p=await proposal(),review=await call('/preview',p);assert.equal(review.status,200);
  await q('UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=user_id WHERE user_id=$1 AND revoked_at IS NULL',[owner]);
  try{assert.equal((await call('/actions',{clientRequestId:randomUUID(),previewToken:review.value.previewToken})).status,403);
   assert.equal((await call('/receipts/'+randomUUID())).status,403);}
  finally{await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_regrant')",[owner]);}
 }));
}
