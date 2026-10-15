import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type pg from 'pg';
type Receipt={contributionId:string;subjectId:string;clientSubmissionId:string;replayed:boolean;saveStatus:string};
type Context={admin:pg.Client;cities:number[];accounts:string[];tokens:string[];base:string;request:(path:string,input?:unknown,account?:number|null,extra?:Record<string,string>)=>Promise<{status:number;value:any;headers:Headers}>;leadBody:()=>unknown};
export function registerActualApiTests(context:()=>Context) {
  const q=(sql:string,args:unknown[]=[])=>context().admin.query(sql,args);
  const call=(body:unknown,account:number|null=0,headers?:Record<string,string>)=>context().request('/v2/actual-journeys',body,account,headers);
  const clock=(fieldKey='departure.actual',time='08:20',scope:unknown={schemaVersion:'1.0'})=>({fieldKey,value:{time},scope});
  const body=()=>({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newActualJourney:{} as Record<string,unknown>},observations:[clock()] as any[],actualContext:undefined as unknown});
  const fare=(amount='0.00',currency='USD')=>({fieldKey:'fare.paid',value:{amount,currency},scope:{schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:context().cities[0],destinationCityId:context().cities[1]},serviceDate:'2026-10-01',passengerCategory:'adult',ticketBasis:'one_way'}});
  const counts=async()=>(await q('SELECT (SELECT count(*) FROM v2_contributions) contributions,(SELECT count(*) FROM v2_actual_journeys) actuals,(SELECT count(*) FROM v2_observations) facts,(SELECT count(*) FROM v2_receipts) receipts,(SELECT count(*) FROM v2_jobs) jobs')).rows[0];
  const facts=async(id:string)=>(await q('SELECT field_key,value,scope,knowledge_basis,observed_from FROM v2_observations WHERE contribution_id=$1 ORDER BY field_key',[id])).rows;
  const target=async(account=0)=>{
    const lead=await context().request('/v2/contributions',context().leadBody(),account);assert.equal(lead.status,200);
    const r=(await q('SELECT revision FROM v2_subjects WHERE id=$1',[lead.value.subjectId])).rows[0];
    return {id:lead.value.subjectId,kind:'lead',expectedRevision:Number(r.revision)};
  };
  test('actual API: capability gates independent reports and leaves receipt recovery available',async()=>{
    assert.equal((await context().request('/v2/capabilities')).value.actualJourneyEnabled,true);
    const input=body(),saved=await call(input);assert.equal(saved.status,200);
    delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
    try {assert.equal((await context().request('/v2/capabilities')).value.actualJourneyEnabled,false);assert.equal((await call(body())).status,503);assert.equal((await context().request('/v2/receipts/'+input.clientSubmissionId)).value.initialReceipt.contributionId,saved.value.contributionId);}
    finally {process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';}
  });
  test('actual API: server authentication, expected account and current Terms precede intake',async()=>{
    assert.equal((await call(body(),null)).status,401);
    assert.equal((await call(body(),1,{'X-Mabhazi-Account':context().accounts[0]})).status,409);
    await q('UPDATE users SET terms_accepted_at=NULL WHERE id=$1',[context().accounts[0]]);
    try {assert.equal((await call(body())).status,428);} finally {await q('UPDATE users SET terms_accepted_at=now() WHERE id=$1',[context().accounts[0]]);}
  });
  test('actual API: one clock commits actual origin, original evidence, receipt and final-generation job without inventing scope',async()=>{
    const beforeLegacy=(await q('SELECT count(*) FROM journeys')).rows[0].count;
    const input=body(),saved=await call(input);assert.equal(saved.status,200);assert.equal(saved.value.saveStatus,'saved');assert.equal(saved.value.replayed,false);assert.equal(saved.headers.get('cache-control'),'no-store');
    const a=(await q('SELECT * FROM v2_actual_journeys WHERE subject_id=$1',[saved.value.subjectId])).rows[0];
    for(const key of ['reported_service_date','timezone','intended_subject_id','matched_run_subject_id']) assert.equal(a[key],null,key);
    const proof=await facts(saved.value.contributionId);assert.equal(proof.length,1);assert.deepEqual(proof[0].value,{time:'08:20'});assert.deepEqual(proof[0].scope,{schemaVersion:'1.0'});assert.equal(proof[0].knowledge_basis,'unprovided');assert.equal(proof[0].observed_from,null);
    assert.equal((await q("SELECT count(*) FROM v2_jobs j JOIN v2_subjects s ON s.id=j.subject_id WHERE j.contribution_id=$1 AND j.kind='normalise' AND j.state='pending' AND j.requested_generation=s.input_generation",[saved.value.contributionId])).rows[0].count,'1');
    assert.equal((await q("SELECT origin_kind FROM v2_subject_revisions WHERE subject_id=$1 AND revision=1",[saved.value.subjectId])).rows[0].origin_kind,'contribution');
    assert.equal((await q('SELECT count(*) FROM journeys')).rows[0].count,beforeLegacy);
  });
  test('actual API: header context never fills fact dates or zones; overnight clocks keep distinct local scopes',async()=>{
    const input=body();input.target.newActualJourney={reportedServiceDate:'2026-10-01',timezone:'Africa/Harare'};
    input.actualContext={knowledgeBasis:'travelled',observedDate:'2026-10-02'};
    input.observations=[clock(),clock('arrival.actual','01:30',{schemaVersion:'1.0',serviceDate:'2026-10-02',utcOffset:'+03:00'})];
    const saved=await call(input);assert.equal(saved.status,200);const os=await facts(saved.value.contributionId);
    assert.deepEqual(os.find(o=>o.field_key==='departure.actual').scope,{schemaVersion:'1.0'});
    assert.deepEqual(os.find(o=>o.field_key==='arrival.actual').scope,{schemaVersion:'1.0',serviceDate:'2026-10-02',utcOffset:'+03:00'});
    assert.ok(os.every(o=>o.knowledge_basis==='travelled'));
  });
  test('actual API: explicit zero fare is scoped; equivalent decimal-scale retry returns the same receipt',async()=>{
    const input=body();input.observations=[fare()];const saved=await call(input);assert.equal(saved.status,200);
    const stored=(await facts(saved.value.contributionId))[0];assert.deepEqual(stored.value,{amount:'0',currency:'USD'});assert.equal(stored.scope.serviceDate,'2026-10-01');
    input.observations=[fare('0')];const retry=await call(input);assert.equal(retry.status,200);assert.equal(retry.value.contributionId,saved.value.contributionId);assert.equal(retry.value.replayed,true);
  });
  test('actual API: named operator, pickup and quoted/advertised fare remain separate typed reports',async()=>{
    const input=body(),quoted=fare('12.50');quoted.fieldKey='fare.quoted';const advertised=fare('10');advertised.fieldKey='fare.advertised';
    input.observations=[{fieldKey:'operator.reported',value:{name:'Actual reported bus'},scope:{}},{fieldKey:'boarding.pickup',value:{cityId:context().cities[0],name:'Named terminus'},scope:{}},quoted,advertised];
    const saved=await call(input);assert.equal(saved.status,200);assert.equal((await facts(saved.value.contributionId)).length,4);
    assert.equal((await q('SELECT count(*) FROM v2_association_links WHERE from_subject_id=$1',[saved.value.subjectId])).rows[0].count,'0');
  });
  test('actual API: invalid optional fact, schedule, currency, date, reference or hidden extra rolls back all intake',async()=>{
    const cases:unknown[]=[{...body(),actor:context().accounts[1]}, {...body(),observations:[]}, {...body(),observations:Array(21).fill(clock())},
      {...body(),observations:[clock('departure.scheduled')]}, {...body(),observations:[clock('departure.actual','8:20')]},
      {...body(),observations:[{...clock(),role:'reviewer'}]}, {...body(),observations:[clock('departure.actual','08:20',{schemaVersion:'1.0',timezone:'Africa/Harare',utcOffset:'+02:00'})]},
      {...body(),observations:[fare('1.00','JPY')]},{...body(),observations:[fare('1','XXX')]},
      {...body(),observations:[{...fare(),scope:{...fare().scope,serviceDate:'2026-02-30'}}]},
      {...body(),observations:[{fieldKey:'operator.reported',value:{id:randomUUID()},scope:{}}]},
      {...body(),observations:[{fieldKey:'boarding.pickup',value:{cityId:1.5,name:'Not an integer'},scope:{}}]},
      {...body(),observations:[{...clock(),value:{time:'08:20',verified:true}}]},
      {...body(),target:{newActualJourney:{timezone:'Not/A_Zone'}}}];
    for(const input of cases){const before=await counts();const result=await call(input);assert.equal(result.status,422,JSON.stringify(input));assert.deepEqual(await counts(),before);}
  });
  test('actual API: exact owned lead selection is intention only; stale revision needs reconfirmation',async()=>{
    const intent=await target(),input=body();input.target.newActualJourney={intendedSubject:intent};
    const saved=await call(input);assert.equal(saved.status,200);assert.equal((await q('SELECT intended_subject_id FROM v2_actual_journeys WHERE subject_id=$1',[saved.value.subjectId])).rows[0].intended_subject_id,intent.id);
    const stale=body();stale.target.newActualJourney={intendedSubject:{...intent,expectedRevision:intent.expectedRevision+1}};const before=await counts();assert.equal((await call(stale)).status,409);assert.deepEqual(await counts(),before);
    await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[intent.id]);
    assert.equal((await call(input)).value.replayed,true);
  });
  test('actual API: another account and a missing private target return the same safe error without writes',async()=>{
    const foreign=await target(1);
    for(const id of [foreign.id,randomUUID()]){const input=body();input.target.newActualJourney={intendedSubject:{id,kind:'lead',expectedRevision:foreign.expectedRevision}};const before=await counts();const denied=await call(input);assert.equal(denied.status,404);assert.equal(denied.value.code,'TARGET_NOT_FOUND');assert.deepEqual(await counts(),before);}
  });
  test('actual API: owned citations work, other-account and absent source IDs reveal no private source',async()=>{
    const source=(await q("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','private fixture') RETURNING id",[context().accounts[0]])).rows[0].id;
    const input=body();input.observations=[{...clock(),sources:[source]}];assert.equal((await call(input)).status,200);
    for(const id of [source,randomUUID()]){const foreign=body();foreign.observations=[{...clock(),sources:[id]}];const before=await counts();assert.equal((await call(foreign,1)).status,403);assert.deepEqual(await counts(),before);}
  });
  test('actual API: concurrent replay, changed content and cross-target key reuse preserve one account-scoped result',async()=>{
    const input=body(),results=await Promise.all([call(input),call(input)]);assert.ok(results.every(r=>r.status===200));assert.equal(results[0].value.contributionId,results[1].value.contributionId);
    assert.equal((await call({...input,observations:[clock('departure.actual','09:30')]})).status,409);
    assert.equal((await context().request('/v2/contributions',{...context().leadBody() as object,clientSubmissionId:input.clientSubmissionId})).status,409);
    assert.equal((await context().request('/v2/receipts/'+input.clientSubmissionId,undefined,1)).value.found,false);
    const other=await call(input,1);assert.equal(other.status,200);assert.notEqual(other.value.contributionId,results[0].value.contributionId);
  });
  test('actual API: backend facade stays narrow and the actual constructor remains denied',async()=>{
    await q('SET ROLE mabhazi_api');try {
      const access=(await q("SELECT has_function_privilege(current_user,'v2_api_submit_actual_journey(varchar,text,jsonb)','EXECUTE') facade,has_function_privilege(current_user,'v2_submit_actual_journey(varchar,text,jsonb)','EXECUTE') constructor")).rows[0];assert.deepEqual(access,{facade:true,constructor:false});
      for(const role of ['anon','authenticated']) assert.equal((await q("SELECT has_function_privilege($1,'v2_api_submit_actual_journey(varchar,text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
      const input=body();input.observations=[{fieldKey:'operator.reported',value:{id:randomUUID()},scope:{}}];
      await assert.rejects(q('SELECT v2_api_submit_actual_journey($1,$2,$3)',[context().accounts[0],'2026-09-12',input]),/v2_actual_capability_only/);
    } finally {await q('RESET ROLE');}
  });
  test('actual API: new reports enter existing fenced workers, stay unresolved and leave original observations untouched',async()=>{
    const input=body(),saved=await call(input);assert.equal(saved.status,200);const original=await facts(saved.value.contributionId);
    for(let i=0;i<3;i++) await q('SELECT v2_worker_drain_normalise(20)');
    for(let i=0;i<3;i++) await q('SELECT v2_worker_drain_associate(20)');
    assert.equal((await q('SELECT count(*) FROM v2_normalised_actuals WHERE subject_id=$1',[saved.value.subjectId])).rows[0].count,'1');
    assert.equal((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND kind='assess' AND policy_version='evidence/1' AND state='pending'",[saved.value.subjectId])).rows[0].count,'1');
    assert.deepEqual(await facts(saved.value.contributionId),original);
    assert.equal((await q('SELECT count(*) FROM v2_association_candidates WHERE from_subject_id=$1',[saved.value.subjectId])).rows[0].count,'0');
  });
  test('actual API: raw size and browser origin protections apply to the new endpoint',async()=>{
    const {base,tokens,accounts}=context();const headers={'Content-Type':'application/json',Authorization:`Bearer ${tokens[0]}`,'X-Mabhazi-Account':accounts[0]};
    assert.equal((await fetch(base+'/v2/actual-journeys',{method:'POST',headers,body:' '.repeat(65537)+'{}'})).status,413);
    assert.equal((await call(body(),0,{Origin:'https://attacker.invalid'})).status,403);
    assert.equal((await call(body(),0,{'Content-Type':'text/plain'})).status,415);
  });
  test('actual API: erasure removes the private receipt, facts and derived actual input',async()=>{
    const input=body(),saved=await call(input);assert.equal(saved.status,200);
    await q('DELETE FROM v2_contributions WHERE id=$1',[saved.value.contributionId]);
    assert.equal((await context().request('/v2/receipts/'+input.clientSubmissionId)).value.found,false);
    assert.equal((await facts(saved.value.contributionId)).length,0);
    assert.equal((await q('SELECT count(*) FROM v2_normalised_actuals WHERE subject_id=$1',[saved.value.subjectId])).rows[0].count,'0');
  });
}
