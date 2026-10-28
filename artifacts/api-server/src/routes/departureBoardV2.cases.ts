import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';
import type pg from 'pg';
type Context={admin:pg.Client;cities:number[];accounts:string[];request:(path:string,input?:unknown,account?:number|null,extra?:Record<string,string>)=>Promise<{status:number;value:any;headers:Headers}>;leadBody:()=>unknown};
export function registerDepartureBoardTests(context:()=>Context){
 const legacyIds:number[]=[];
 const q=(sql:string,args:unknown[]=[])=>context().admin.query(sql,args);
 const read=(query='',account:number|null=null,headers:Record<string,string>={})=>context().request('/v2/departure-board'+query,undefined,account,headers);
 async function city(name:string){return(await q("INSERT INTO cities(name,place_type) VALUES($1,'city') RETURNING id",[name])).rows[0].id as number;}
 async function lead(origin:number,name='Board report coach'){const b=context().leadBody() as any;b.target.newLead.originCityId=origin;b.target.newLead.operator.name=name;const r=await context().request('/v2/contributions',b);assert.equal(r.status,200);return r.value;}
 async function legacy(from:string,to:string,operator:string,author:string|null=context().accounts[0],clock='09:15'){
  const id=(await q("INSERT INTO journeys(from_city,to_city,departure_time,arrival_time,travel_date,bus_company,pickup_point,dropoff_point,price,contributed_by) VALUES($1,$2,$3,'14:00','Mon, Fri',$4,'Fixture rank','Fixture stop',12.50,$5) RETURNING id",[from,to,clock,operator,author])).rows[0].id as number;legacyIds.push(id);return id;
 }
 // Only this suite's disposable legacy fixtures; no shared route is removed.
 afterEach(async()=>{if(legacyIds.length)await q('DELETE FROM journeys WHERE id=ANY($1::integer[])',[legacyIds.splice(0)]);});
 test('departure board API: origins and rows share actual visible routes without unrelated reference cities or a20-city cutoff',async()=>{
  const suffix=randomUUID(),unused='Unused board '+suffix;await city(unused);
  const ids=[];for(let i=0;i<25;i++){const id=await city('Board catalog '+suffix+' '+String(i).padStart(2,'0'));ids.push(id);await lead(id);}
  const r=await read();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.value.origins.some((c:any)=>c.name===unused),false);
  for(const id of ids)assert.ok(r.value.origins.some((c:any)=>c.key==='city:'+id));
  const selected=await read('?originKey=city:'+ids[24]);assert.equal(selected.value.selectedOriginKey,'city:'+ids[24]);assert.equal(selected.value.entries.length,1);assert.equal(selected.value.entries[0].kind,'community');assert.equal(selected.value.entries[0].timedDepartureEligible,false);
  assert.equal(JSON.stringify(selected.value).includes(context().accounts[0]),false);
 });
 test('departure board API: exact origins exclude transit-stop clocks and never infer daily next departures',async()=>{
  const name='Exact board '+randomUUID(),id=await city(name),saved=await lead(id),own=await legacy(name,'Board destination','Board legacy coach'),through=await legacy('Other board origin',name,'Through coach');
  await q("INSERT INTO journey_stops(journey_id,city,departure_time,sequence) VALUES($1,$2,'12:30',1)",[through,name]);
  const r=await read('?originKey=city:'+id);assert.equal(r.status,200);assert.ok(r.value.entries.some((e:any)=>e.journeyId===own));assert.ok(r.value.entries.some((e:any)=>e.subjectId===saved.subjectId));assert.equal(r.value.entries.some((e:any)=>e.journeyId===through),false);
  assert.ok(r.value.entries.every((e:any)=>e.originKey==='city:'+id&&e.timedDepartureEligible===false));assert.ok(r.value.entries.every((e:any)=>!('minsUntil' in e)&&!('nextDepartureAt' in e)));assert.equal(r.value.entries.find((e:any)=>e.journeyId===own).scheduledDays,'Mon, Fri');
 });
 test('departure board API: device/account hiding removes authors from both rows and origins without leaking their identities',async()=>{
  const name='Private board '+randomUUID(),id=await city(name),saved=await lead(id);await legacy(name,'Hidden destination','Hidden board coach');
  const device=await read('',null,{'X-Mabhazi-Blocked-Contributors':JSON.stringify([context().accounts[0]])});assert.equal(device.status,200);assert.equal(device.value.origins.some((c:any)=>c.key==='city:'+id),false);assert.equal(device.value.hasHiddenRoutes,true);
  const action=await context().request('/v2/subjects/'+saved.subjectId+'/safety',{action:'block'},3);assert.equal(action.status,200);
  try{const account=await read('',3);assert.equal(account.value.origins.some((c:any)=>c.key==='city:'+id),false);assert.equal(JSON.stringify(account.value).includes(context().accounts[0]),false);}
  finally{await q('DELETE FROM v2_route_report_blocks WHERE blocker_id=$1 AND blocked_user_id=$2',[context().accounts[3],context().accounts[0]]);}
 });
 test('departure board API: removed or inactive routes never create available origins; stale explicit selection never switches to another city',async()=>{
  const name='Withdrawn board '+randomUUID(),id=await city(name),saved=await lead(id);const j=await legacy(name,'Gone destination','Gone coach');
  await q("UPDATE journeys SET moderation_status='hidden' WHERE id=$1",[j]);await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[saved.subjectId]);
  const r=await read('?originKey=city:'+id);assert.equal(r.status,200);assert.equal(r.value.selectionUnavailable,true);assert.equal(r.value.selectedOriginKey,null);assert.deepEqual(r.value.entries,[]);assert.equal(r.value.origins.some((c:any)=>c.key==='city:'+id),false);
  const inactive='Inactive board '+randomUUID(),k=await legacy(inactive,'Other','Inactive coach');await q("UPDATE journeys SET data_status='inactive' WHERE id=$1",[k]);assert.equal((await read()).value.origins.some((c:any)=>c.name===inactive),false);
 });
 test('departure board API: ambiguous reference names keep explicit report identities and legacy labels separate; malformed clocks remain unknown',async()=>{
  const name='Ambiguous board '+randomUUID(),a=await city(name),b=await city(name);await lead(a);await lead(b);const j=await legacy(name,'Example destination','Unresolved legacy coach',null,'not a clock');
  const r=await read(),origins=r.value.origins.filter((c:any)=>c.name===name);assert.equal(origins.length,3);assert.ok(origins.some((c:any)=>c.key==='city:'+a));assert.ok(origins.some((c:any)=>c.key==='city:'+b));const unresolved=origins.find((c:any)=>c.cityId===null);assert.ok(unresolved?.key.startsWith('legacy:'));
  const l=await read('?originKey='+encodeURIComponent(unresolved.key));assert.equal(l.value.entries.length,1);assert.equal(l.value.entries[0].journeyId,j);assert.equal(l.value.entries[0].reportedTime,undefined);assert.equal(l.value.entries[0].timedDepartureEligible,false);
 });
 test('departure board API: invalid queries/account contexts fail explicitly; pausing community intake keeps legacy schedules readable',async()=>{
  assert.equal((await read('?unexpected=1')).status,400);assert.equal((await read('?originKey=city:0')).status,400);assert.equal((await read('?originKey=legacy:a&originKey=legacy:b')).status,400);assert.equal((await read('',null,{'X-Mabhazi-Account':context().accounts[0]})).status,401);assert.equal((await read('',1,{'X-Mabhazi-Account':context().accounts[0]})).status,409);assert.equal((await read('',null,{'X-Mabhazi-Blocked-Contributors':'invalid'})).status,400);
  const name='Paused board '+randomUUID();await legacy(name,'Other destination','Paused legacy coach',null);delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
  try{const r=await read();assert.equal(r.status,200);assert.ok(r.value.origins.some((c:any)=>c.name===name));assert.equal(r.value.origins.some((c:any)=>c.hasCommunityReports),false);}
  finally{process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';}
 });
}
