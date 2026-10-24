import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { before, after, test } from 'node:test';
import pg from 'pg';
import { SubmitV2LeadResponse, GetV2CapabilitiesResponse, ListV2CitiesResponse, GetV2LeadReceiptResponse, ListV2OwnRoutesResponse, GetV2OwnRouteResponse } from '@workspace/api-zod';
import type { infer as Infer } from 'zod';
import { registerActualApiTests } from './actualJourney.cases';
import { registerPublicRouteTests } from './publicRoutesV2.cases';
type TestPayload = Infer<typeof SubmitV2LeadResponse> & Infer<typeof GetV2CapabilitiesResponse> & Infer<typeof ListV2CitiesResponse> & Infer<typeof GetV2LeadReceiptResponse> & Infer<typeof ListV2OwnRoutesResponse> & Infer<typeof GetV2OwnRouteResponse>;

let admin: pg.Client, server: Server, base: string;
const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()], tokens = accounts.map(() => randomBytes(32).toString('hex'));
let cities: number[];
before(async () => {
  process.env.PUBLIC_ORIGIN = 'https://api.mabhazi.com';
  process.env.ALLOWED_ORIGINS = 'https://mabhazi.com';
  process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED = 'true';
  admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  for (let i = 0; i < accounts.length; i++) {
    await admin.query(`INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,$2,$3)`, [accounts[i], i === 2 ? null : '2026-09-12', i === 2 ? null : new Date()]);
    await admin.query(`INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')`, [tokens[i], { user: { id: accounts[i] }, access_token: 'synthetic-test-token', expires_at: Math.floor(Date.now()/1000)+3600 }]);
  }
  cities = (await admin.query(`INSERT INTO cities(name,place_type) VALUES('API Origin fixture','city'),('API Destination fixture','city') RETURNING id`)).rows.map(r => r.id);
  const { pool } = await import('@workspace/db');
  // HTTP middleware and writer both use the actual restricted backend role.
  pool.on('connect', client => { void client.query('SET ROLE mabhazi_api'); });
  const { default: app } = await import('../app');
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  const { pool } = await import('@workspace/db'); await pool.end();
  if (admin) {
    for (const id of accounts) await admin.query('DELETE FROM users WHERE id=$1', [id]);
    await admin.query('DELETE FROM sessions WHERE sid=ANY($1::varchar[])', [tokens]);
    // Shared anonymised lead/corridor tombstones retain city references by policy.
    await admin.end();
  }
});
function body() { return { schemaVersion:'1.0', clientSubmissionId:randomUUID(), entrySurface:'contribute_tab',
  target:{newLead:{originCityId:cities[0],destinationCityId:cities[1],departureTime:'00:00',operator:{name:'Reported API bus'}}},observations:[] }; }
async function request(path: string, input?: unknown, account: number | null = 0, extra: Record<string,string> = {}) {
  const headers: Record<string,string> = { ...(input === undefined ? {} : { 'Content-Type':'application/json' }), ...extra };
  if (account !== null) { headers.Authorization = `Bearer ${tokens[account]}`; headers['X-Mabhazi-Account'] ??= accounts[account]; }
  const response = await fetch(base+path, { method: input === undefined ? 'GET' : 'POST', headers, ...(input === undefined ? {} : {body:JSON.stringify(input)}) });
  return { status:response.status, value:await response.json() as TestPayload, headers:response.headers };
}
test('minimum API: capability defaults off and does not write legacy or v2', async () => {
  delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
  assert.deepEqual((await request('/v2/capabilities')).value,{schemaVersion:'1.0',minimumLeadEnabled:false,actualJourneyEnabled:false});
  assert.equal((await request('/v2/contributions',body())).status,503);
  process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';
  assert.equal((await request('/v2/capabilities')).value.minimumLeadEnabled,true);
});
test('minimum API: stable city IDs, deterministic list and bounded literal search', async () => {
  const result=await request('/v2/cities?q=API%20Origin%20fixture'); assert.equal(result.status,200);
  assert.deepEqual(result.value.cities,[{id:cities[0],name:'API Origin fixture',placeType:'city'}]);
  assert.equal((await request('/v2/cities?q='+ 'a'.repeat(81))).status,400);
  assert.equal((await request('/v2/cities?q[]=x')).status,400);
  assert.equal((await request('/v2/cities?q=%25')).value.cities.length,0);
});
test('minimum API: real authentication and live current Terms are required', async () => {
  assert.equal((await request('/v2/contributions',body(),null)).status,401);
  assert.equal((await request('/v2/contributions',body(),2)).status,428);
  await admin.query('UPDATE users SET terms_accepted_at=NULL WHERE id=$1',[accounts[0]]);
  assert.equal((await request('/v2/contributions',body())).status,428);
  await admin.query('UPDATE users SET terms_accepted_at=now() WHERE id=$1',[accounts[0]]);
});
test('minimum API: four answers commit a lead, two facts, receipt and durable job, no legacy journey', async () => {
  const input=body(), count=(await admin.query('SELECT count(*) FROM journeys')).rows[0].count;
  const saved=await request('/v2/contributions',input); assert.equal(saved.status,200);
  assert.equal(saved.value.saveStatus,'saved'); assert.equal(saved.value.processingStatus,'queued'); assert.equal(saved.value.publicationStatus,'pending');
  assert.equal(saved.value.replayed,false); assert.equal(saved.headers.get('cache-control'),'no-store');
  const contribution=(await admin.query('SELECT * FROM v2_contributions WHERE id=$1',[saved.value.contributionId])).rows[0];
  assert.equal(contribution.user_id,accounts[0]); assert.equal(contribution.payload.target.newLead.departureTime,'00:00');
  assert.equal((await admin.query('SELECT count(*) FROM v2_observations WHERE contribution_id=$1',[contribution.id])).rows[0].count,'2');
  assert.equal((await admin.query("SELECT count(*) FROM v2_jobs WHERE contribution_id=$1 AND kind='normalise' AND state='pending'",[contribution.id])).rows[0].count,'1');
  assert.equal((await admin.query('SELECT count(*) FROM journeys')).rows[0].count,count);
  assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId)).value,{found:true,initialReceipt:{...saved.value,replayed:true},currentLeadRevision:Number((await admin.query('SELECT revision FROM v2_subjects WHERE id=$1',[saved.value.subjectId])).rows[0].revision)});
});

test('minimum API: empty-search intake needs no approved route and preserves its surface on recovery', async () => {
  const input={...body(),entrySurface:'search_empty'}, count=(await admin.query('SELECT count(*) FROM journeys')).rows[0].count;
  const saved=await request('/v2/contributions',input);assert.equal(saved.status,200);assert.equal(saved.value.publicationStatus,'pending');
  const row=(await admin.query('SELECT entry_surface,payload FROM v2_contributions WHERE id=$1',[saved.value.contributionId])).rows[0];
  assert.equal(row.entry_surface,'search_empty');assert.equal(row.payload.entrySurface,'search_empty');
  assert.equal((await request('/v2/contributions',input)).value.contributionId,saved.value.contributionId);
  assert.equal((await request('/v2/receipts/'+input.clientSubmissionId)).value.initialReceipt?.contributionId,saved.value.contributionId);
  assert.equal((await request('/v2/contributions',{...input,entrySurface:'contribute_tab'})).status,409);
  assert.equal((await request('/v2/receipts/'+input.clientSubmissionId,undefined,1)).value.found,false);
  assert.equal((await request('/v2/contributions',{...body(),entrySurface:'search_empty'},null)).status,401);
  assert.equal((await request('/v2/contributions',{...body(),entrySurface:'search_empty'},2)).status,428);
  assert.equal((await admin.query('SELECT count(*) FROM journeys')).rows[0].count,count);
});
test('minimum API: other surfaces and null still fail in both HTTP and restricted facade', async () => {
  for(const entrySurface of [null,'route_detail','search_result','own_contribution','unknown']) {
    const input={...body(),entrySurface};
    assert.equal((await request('/v2/contributions',input)).status,422);
    await admin.query('SET ROLE mabhazi_api');
    try { await assert.rejects(admin.query('SELECT v2_api_submit_minimum_lead($1,$2,$3)',[accounts[0],'2026-09-12',input]), e=>(e as Error).message==='v2_minimum_capability_only'); }
    finally { await admin.query('RESET ROLE'); }
  }
});


test('own lead context: receipt stays immutable while live revision is private and unavailable targets are omitted', async () => {
  const input=body(), saved=await request('/v2/contributions',input);assert.equal(saved.status,200);
  const first=await request('/v2/receipts/'+input.clientSubmissionId);
  assert.ok(Number.isSafeInteger(first.value.currentLeadRevision));assert.ok(first.value.currentLeadRevision!>0);
  await admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[saved.value.subjectId]);
  const changed=await request('/v2/receipts/'+input.clientSubmissionId);
  assert.equal(changed.value.currentLeadRevision,first.value.currentLeadRevision!+1);assert.deepEqual(changed.value.initialReceipt,first.value.initialReceipt);
  assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId,undefined,1)).value,{found:false});
  await admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[saved.value.subjectId]);
  const retired=await request('/v2/receipts/'+input.clientSubmissionId);
  assert.equal(retired.value.found,true);assert.equal(retired.value.currentLeadRevision,undefined);assert.deepEqual(retired.value.initialReceipt,first.value.initialReceipt);
});

test('minimum API: strict fields and an explicit valid clock, never hidden defaults', async () => {
  for(const patch of [{departureTime:''},{departureTime:'8:30'},{departureTime:'24:00'},{departureTime:'Leaves when full'},
    {operator:{name:'unknown'}},{operator:{name:' bus '}},{operator:{name:'Bus\nline'}},{originCityId:1.5},{destinationCityId:cities[0]}, {price:0}]) {
    const input=body(); Object.assign(input.target.newLead,patch); assert.equal((await request('/v2/contributions',input)).status,422,JSON.stringify(patch));
  }
  for(const field of ['originCityId','destinationCityId','departureTime','operator']) {
    const input=body(); delete (input.target.newLead as Record<string,unknown>)[field]; assert.equal((await request('/v2/contributions',input)).status,422);
  }
  const input=body(); assert.equal((await request('/v2/contributions',{...input,actor:accounts[1]})).status,422);
  assert.equal((await request('/v2/contributions',{...input,observations:[{}]})).status,422);
});
test('minimum API: paused new intake still permits private committed receipt recovery', async () => {
  const input=body(), saved=await request('/v2/contributions',input);assert.equal(saved.status,200);
  delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
  try {
    assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId)).value,{found:true,initialReceipt:{...saved.value,replayed:true},currentLeadRevision:Number((await admin.query('SELECT revision FROM v2_subjects WHERE id=$1',[saved.value.subjectId])).rows[0].revision)});
    assert.equal((await request('/v2/contributions',body())).status,503);
    assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId,undefined,1)).value,{found:false});
  } finally { process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true'; }
});
test('minimum API: changed replay conflicts, identical concurrent retry has one logical receipt', async () => {
  const input=body(), results=await Promise.all([request('/v2/contributions',input),request('/v2/contributions',input)]);
  assert.equal(results[0].status,200);assert.equal(results[1].status,200);assert.equal(results[0].value.contributionId,results[1].value.contributionId);
  const changed=structuredClone(input);changed.target.newLead.departureTime='10:00';
  assert.equal((await request('/v2/contributions',changed)).status,409);
  assert.equal((await admin.query('SELECT count(*) FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[accounts[0],input.clientSubmissionId])).rows[0].count,'1');
});
test('minimum API: own lookup hides other-account references and token switches reject before save', async () => {
  const input=body(), saved=await request('/v2/contributions',input);
  assert.equal(saved.status,200);
  assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId,undefined,1)).value,{found:false});
  assert.deepEqual((await request('/v2/receipts/'+randomUUID(),undefined,1)).value,{found:false});
  assert.equal((await request('/v2/receipts/'+input.clientSubmissionId,undefined,1,{'X-Mabhazi-Account':accounts[0]})).status,409);
  assert.equal((await request('/v2/contributions',body(),1,{'X-Mabhazi-Account':accounts[0]})).status,409);
  // Same key in another legitimate account is its independent contribution.
  const other=await request('/v2/contributions',input,1);assert.equal(other.status,200);assert.notEqual(other.value.contributionId,saved.value.contributionId);
});
test('minimum API: erased receipt never survives account/contribution deletion or replay resurrects it', async () => {
  const input=body(), saved=await request('/v2/contributions',input);
  await admin.query('DELETE FROM v2_contributions WHERE id=$1',[saved.value.contributionId]);
  assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId)).value,{found:false});
  const oldUser=accounts[2], token=tokens[2];
  await admin.query('DELETE FROM users WHERE id=$1',[oldUser]);
  assert.equal((await request('/v2/receipts/'+input.clientSubmissionId,undefined,2)).status,401);
  assert.equal((await admin.query('SELECT count(*) FROM sessions WHERE sid=$1',[token])).rows[0].count,'0');
});
test('minimum API: raw byte limit, malformed JSON, JSON-only and browser-origin protections', async () => {
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${tokens[0]}`,'X-Mabhazi-Account':accounts[0]};
  const huge=await fetch(base+'/v2/contributions',{method:'POST',headers,body:' '.repeat(65537)+'{}'});assert.equal(huge.status,413);assert.equal((await huge.json() as {code:string}).code,'BODY_TOO_LARGE');
  const invalid=await fetch(base+'/v2/contributions',{method:'POST',headers,body:'{"secret":"unterminated'});assert.equal(invalid.status,400);assert.ok(!JSON.stringify(await invalid.json()).includes('unterminated'));
  assert.equal((await request('/v2/contributions',body(),0,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('/v2/contributions',body(),0,{Origin:'https://attacker.invalid'})).status,403);
  const cookieHeaders={'Content-Type':'application/json',Cookie:`sid=${tokens[0]}`,'X-Mabhazi-Account':accounts[0]};
  assert.equal((await fetch(base+'/v2/contributions',{method:'POST',headers:cookieHeaders,body:JSON.stringify(body())})).status,403);
  assert.equal((await fetch(base+'/v2/contributions',{method:'POST',headers:{...cookieHeaders,Origin:'https://mabhazi.com'},body:JSON.stringify(body())})).status,200);
});
test('minimum API: restricted facade cannot expose optional facts or privileged constructor', async () => {
  await admin.query('SET ROLE mabhazi_api');
  try {
    const result=await admin.query("SELECT has_function_privilege(current_user,'v2_submit_lead(varchar,text,jsonb)','EXECUTE') direct,has_function_privilege(current_user,'v2_api_submit_minimum_lead(varchar,text,jsonb)','EXECUTE') facade");
    assert.deepEqual(result.rows[0],{direct:false,facade:true});
    const invalid=body();(invalid.observations as unknown[]).push({fieldKey:'fare.quoted'});
    await assert.rejects(admin.query('SELECT v2_api_submit_minimum_lead($1,$2,$3)',[accounts[0],'2026-09-12',invalid]),e => (e as Error).message==='v2_minimum_capability_only');
  } finally { await admin.query('RESET ROLE'); }
});

test('own route history: authentication, account namespace and strict queries precede reads', async () => {
  assert.equal((await request('/v2/my-routes',undefined,null)).status,401);
  assert.equal((await request('/v2/my-routes',undefined,0,{'X-Mabhazi-Account':accounts[1]})).status,409);
  assert.equal((await request('/v2/my-routes?owner='+accounts[1])).status,400);
  for(const query of ['cursor=x','cursor[]=x','cursor=','cursor='+randomUUID()+'.'+randomUUID()]) assert.equal((await request('/v2/my-routes?'+query)).status,400);
  assert.equal((await request('/v2/my-routes/not-a-uuid')).status,400);
});
test('own route history: private precision-safe keyset pages exclude concurrent newer submissions', async () => {
  const keys:string[]=[];
  for(let i=0;i<22;i++) {const input=body();input.target.newLead.operator.name='History bus '+i;const saved=await request('/v2/contributions',input,3);assert.equal(saved.status,200);keys.push(input.clientSubmissionId);}
  const first=await request('/v2/my-routes',undefined,3);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(first.value.routes.length,20);assert.ok(first.value.nextCursor);
  const originalCursor=first.value.nextCursor!;
  const later=body();later.target.newLead.operator.name='History latest bus';assert.equal((await request('/v2/contributions',later,3)).status,200);
  const last=await request('/v2/my-routes?cursor='+encodeURIComponent(originalCursor),undefined,3);assert.equal(last.status,200);assert.equal(last.value.routes.length,2);assert.equal(last.value.nextCursor,undefined);
  const received=[...first.value.routes,...last.value.routes].map(row=>row.clientSubmissionId);assert.equal(new Set(received).size,22);assert.deepEqual(new Set(received),new Set(keys));assert.ok(!received.includes(later.clientSubmissionId));
  assert.equal((await request('/v2/my-routes?cursor='+encodeURIComponent(originalCursor),undefined,0)).status,400);
  assert.equal((await request('/v2/my-routes/'+keys[0],undefined,0)).status,404);
  assert.equal((await request('/v2/my-routes',undefined,3)).value.routes[0].clientSubmissionId,later.clientSubmissionId);
  const dto=first.value.routes[0];assert.deepEqual(Object.keys(dto).sort(),['availability','clientSubmissionId','currentLeadRevision','departureTime','destination','operator','origin','subjectId','submittedAt'].sort());assert.ok(!('payload' in dto));assert.equal(dto.origin.id,cities[0]);assert.equal(dto.departureTime,'00:00');assert.equal(dto.availability,'active');
});
test('own route history: recheck sees current revision and retirement, not historical receipt status', async () => {
  const input=body(),saved=await request('/v2/contributions',input,3);assert.equal(saved.status,200);
  const initial=(await request('/v2/receipts/'+input.clientSubmissionId,undefined,3)).value.initialReceipt;
  const old=(await request('/v2/my-routes/'+input.clientSubmissionId,undefined,3)).value.route;
  await admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[saved.value.subjectId]);
  const current=(await request('/v2/my-routes/'+input.clientSubmissionId,undefined,3)).value.route;assert.equal(current.currentLeadRevision,old.currentLeadRevision!+1);assert.equal(current.operator,input.target.newLead.operator.name);
  delete process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED;
  try {assert.equal((await request('/v2/my-routes',undefined,3)).status,200);assert.equal((await request('/v2/my-routes/'+input.clientSubmissionId,undefined,3)).status,200);} finally {process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED='true';}
  await admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[saved.value.subjectId]);
  const retired=(await request('/v2/my-routes/'+input.clientSubmissionId,undefined,3)).value.route;assert.equal(retired.availability,'unavailable');assert.equal(retired.currentLeadRevision,undefined);
  assert.deepEqual((await request('/v2/receipts/'+input.clientSubmissionId,undefined,3)).value.initialReceipt,initial);
  await admin.query('UPDATE v2_leads SET attribution_erased=true WHERE subject_id=$1',[saved.value.subjectId]);
  assert.equal((await request('/v2/my-routes/'+input.clientSubmissionId,undefined,3)).status,404);
  assert.ok(!(await request('/v2/my-routes',undefined,3)).value.routes.some(row=>row.clientSubmissionId===input.clientSubmissionId));
});
test('own route history: deleting a contribution removes list/detail and invalidates its cursor without disclosure', async () => {
  const page=(await request('/v2/my-routes',undefined,3)).value;assert.ok(page.nextCursor);
  const anchor=page.routes[0];await admin.query('DELETE FROM v2_contributions WHERE id=(SELECT contribution_id FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2)',[accounts[3],anchor.clientSubmissionId]);
  assert.equal((await request('/v2/my-routes/'+anchor.clientSubmissionId,undefined,3)).status,404);
  assert.equal((await request('/v2/my-routes?cursor='+encodeURIComponent(page.nextCursor!),undefined,3)).status,400);
  assert.equal((await request('/v2/my-routes/'+anchor.clientSubmissionId,undefined,1)).status,404);
});

registerActualApiTests(()=>({admin,cities,accounts,tokens,base,request,leadBody:body}));


registerPublicRouteTests(()=>({admin,cities,accounts,tokens,base}));
