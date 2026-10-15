import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
export function registerProcessingTests(context: () => Context) {
  const q = (sql: string, args: unknown[] = []) => context().db.query(sql,args);
  async function fresh(owner=context().user, time='08:00', name='Reported   BUS') {
    await q("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=clock_timestamp() WHERE id=$1",[owner]);
    const request={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:context().origin,destinationCityId:context().destination,departureTime:time,operator:{name}}},observations:[]};
    const r=(await q('SELECT v2_api_submit_minimum_lead($1,$2,$3) r',[owner,'2026-09-12',request])).rows[0].r;
    const job=(await q("SELECT * FROM v2_jobs WHERE contribution_id=$1 AND kind='normalise'",[r.contributionId])).rows[0];
    await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND id<>$1",[job.id]);
    return {...r,job,request};
  }
  const claim=async()=> (await q('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;
  const finish=async(w:Record<string,unknown>)=> (await q('SELECT v2_worker_finish_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r;
  const effectCount=async(id:string)=> (await q('SELECT count(*) n FROM v2_job_effects WHERE job_id=$1',[id])).rows[0].n;
  const projection=async(id:string)=> (await q('SELECT * FROM v2_normalised_leads WHERE subject_id=$1',[id])).rows[0];
  async function invalid(action:()=>Promise<unknown>,code='42501') {
    await q('SAVEPOINT rejected_worker');
    try {await assert.rejects(action,(e:unknown)=>e instanceof Error && 'code' in e && String(e.code)===code);}
    finally {await q('ROLLBACK TO SAVEPOINT rejected_worker');await q('RELEASE SAVEPOINT rejected_worker');}
  }
  test('worker: minimum input normalises privately without changing originals, support or publication',async()=>{
    const r=await fresh(),before=(await q('SELECT id,value FROM v2_observations WHERE contribution_id=$1 ORDER BY id',[r.contributionId])).rows;
    const w=await claim();assert.equal(w.id,r.job.id);assert.equal(w.attempt,1);assert.equal(await finish(w),'done');
    const p=await projection(r.subjectId);assert.equal(p.operator_key,'reported bus');assert.equal(p.departure_seconds,28800);assert.equal(p.time_basis,'unspecified');assert.equal(p.operator_subject_id,null);
    assert.deepEqual((await q('SELECT id,value FROM v2_observations WHERE contribution_id=$1 ORDER BY id',[r.contributionId])).rows,before);
    assert.equal(await effectCount(w.id),'1');assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='associate'",[r.subjectId])).rows[0].n,'1');
    assert.equal((await q('SELECT initial_response FROM v2_receipts WHERE contribution_id=$1',[r.contributionId])).rows[0].initial_response.publicationStatus,'pending');
    assert.equal((await q("SELECT count(*) n FROM v2_observations WHERE contribution_id=$1 AND field_key LIKE 'fare.%'",[r.contributionId])).rows[0].n,'0');
  });
  test('worker: explicit midnight is valid, basis stays unspecified and no calendar is invented',async()=>{
    const r=await fresh(context().user,'00:00');await finish(await claim());const p=await projection(r.subjectId);
    assert.equal(p.departure_seconds,0);assert.equal(p.time_basis,'unspecified');assert.ok(!('calendar' in p));
  });
  test('worker: repeat completion cannot replay effects or advance evidence generation',async()=>{
    const r=await fresh(),w=await claim();await finish(w);const p=await projection(r.subjectId);
    assert.equal(await finish(w),'lease_lost');assert.equal(await effectCount(w.id),'1');assert.deepEqual(await projection(r.subjectId),p);
  });
  test('worker: different trigger IDs coalesce next-stage work without increasing witness counts',async()=>{
    const r=await fresh();await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('normalise',$1,$2,'intake/1',gen_random_uuid())",[r.subjectId,r.job.requested_generation]);
    await finish(await claim());await finish(await claim());
    assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE kind='associate' AND subject_id=$1",[r.subjectId])).rows[0].n,'1');
    assert.equal((await q('SELECT count(*) n FROM v2_observations WHERE contribution_id=$1',[r.contributionId])).rows[0].n,'2');
  });
  test('worker: wrong tokens cannot heartbeat, fail or commit another lease',async()=>{
    const r=await fresh(),w=await claim(),bad=randomUUID();assert.equal(await finish({...w,lease_token:bad}),'lease_lost');
    for(const sql of ['SELECT v2_worker_heartbeat_normalise($1,$2) r',"SELECT v2_worker_fail_normalise($1,$2,'processing_error') r"])assert.equal((await q(sql,[w.id,bad])).rows[0].r,false);
    assert.equal(await effectCount(w.id),'0');assert.equal(await projection(r.subjectId),undefined);
    assert.equal((await q('SELECT v2_worker_heartbeat_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r,true);
  });
  test('worker: expired leases cannot renew, fail or write',async()=>{
    const r=await fresh(),w=await claim();await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);
    assert.equal(await finish(w),'lease_lost');assert.equal((await q('SELECT v2_worker_heartbeat_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r,false);
    assert.equal((await q("SELECT v2_worker_fail_normalise($1,$2,'processing_error') r",[w.id,w.lease_token])).rows[0].r,false);assert.equal(await projection(r.subjectId),undefined);
  });
  test('worker: rollback midway through effects leaves lease and evidence recoverable',async()=>{
    const r=await fresh(),w=await claim();await q('SAVEPOINT interrupted_effect');await finish(w);await q('ROLLBACK TO SAVEPOINT interrupted_effect');await q('RELEASE SAVEPOINT interrupted_effect');
    assert.equal(await effectCount(w.id),'0');assert.equal(await projection(r.subjectId),undefined);assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='associate'",[r.subjectId])).rows[0].n,'0');
    assert.equal(await finish(w),'done');assert.equal(await effectCount(w.id),'1');
  });
  test('worker: expiry during a write rolls back projection, effect and next-stage intent',{timeout:10_000},async()=>{
    const r=await fresh(),w=await claim();
    await q("CREATE FUNCTION worker_test_slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1); RETURN NEW; END; $$");
    await q('CREATE TRIGGER worker_test_slow BEFORE INSERT ON v2_normalised_leads FOR EACH ROW EXECUTE FUNCTION worker_test_slow_insert()');
    await q("UPDATE v2_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1",[w.id]);await invalid(()=>finish(w),'40001');
    assert.equal(await projection(r.subjectId),undefined);assert.equal(await effectCount(w.id),'0');
    assert.equal((await q("SELECT count(*) n FROM v2_jobs WHERE subject_id=$1 AND kind='associate'",[r.subjectId])).rows[0].n,'0');
  });
  test('worker: failure uses bounded jitter and sanitises messages',async()=>{
    await fresh();const w=await claim();assert.equal((await q('SELECT v2_worker_fail_normalise($1,$2,$3) r',[w.id,w.lease_token,'private://do-not-store-secret'])).rows[0].r,true);
    const j=(await q('SELECT *,extract(epoch FROM available_at-clock_timestamp()) delay FROM v2_jobs WHERE id=$1',[w.id])).rows[0];
    assert.equal(j.last_error_code,'processing_error');assert.equal(j.state,'pending');assert.ok(Number(j.delay)>28 && Number(j.delay)<=33);assert.equal(j.lease_token,null);
  });
  test('worker: eight failures stay inspectable and explicit owner retry preserves lifetime attempts',async()=>{
    const r=await fresh();for(let n=1;n<=8;n++){const w=await claim();assert.equal(w.attempt,n);await q("SELECT v2_worker_fail_normalise($1,$2,'invalid_input')",[w.id,w.lease_token]);if(n<8)await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[w.id]);}
    let j=(await q('SELECT * FROM v2_jobs WHERE id=$1',[r.job.id])).rows[0];assert.equal(j.state,'failed');assert.equal(j.attempt,8);assert.equal(await claim(),null);
    const health=(await q('SELECT v2_worker_health() h')).rows[0].h;assert.ok(health.failedJobs.some((v:{id:string})=>v.id===j.id));assert.ok(!JSON.stringify(health).includes(r.contributionId));
    assert.equal((await q('SELECT v2_worker_retry_normalise($1) r',[j.id])).rows[0].r,true);j=(await q('SELECT * FROM v2_jobs WHERE id=$1',[j.id])).rows[0];assert.equal(j.attempt,8);assert.equal(j.max_attempts,16);
    assert.equal(await finish(await claim()),'done');
  });
  test('worker: exhausted crashed lease becomes failed without being claimed again',async()=>{
    const r=await fresh(),w=await claim();await q("UPDATE v2_jobs SET attempt=8,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);assert.equal(await claim(),null);
    const j=(await q('SELECT * FROM v2_jobs WHERE id=$1',[r.job.id])).rows[0];assert.equal(j.state,'failed');assert.equal(j.last_error_code,'lease_expired');assert.equal(j.lease_token,null);
  });
  test('worker: a newer input generation fences old effects and queues current input',async()=>{
    const r=await fresh(),w=await claim();await q('UPDATE v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=$1',[r.subjectId]);
    assert.equal((await q('SELECT v2_worker_heartbeat_normalise($1,$2) r',[w.id,w.lease_token])).rows[0].r,false);assert.equal(await finish(w),'superseded');assert.equal(await effectCount(w.id),'0');
    const newest=(await q("SELECT * FROM v2_jobs WHERE subject_id=$1 AND kind='normalise' AND requested_generation>$2",[r.subjectId,w.requested_generation])).rows;assert.equal(newest.length,1);assert.equal(await finish(await claim()),'done');
  });
  test('worker: retirement cancels processing without creating a replacement service',async()=>{
    const r=await fresh(),w=await claim();await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[r.subjectId]);assert.equal(await finish(w),'superseded');assert.equal(await projection(r.subjectId),undefined);
  });
  test('worker: withdrawal removes normalisation immediately; missing facts are never reconstructed',async()=>{
    const r=await fresh();await finish(await claim());const p=await projection(r.subjectId);await q('SELECT v2_withdraw_observation($1,$2,1,$3,NULL)',[context().user,p.operator_observation_id,randomUUID()]);
    assert.equal(await projection(r.subjectId),undefined);assert.equal(await finish(await claim()),'superseded');assert.equal(await projection(r.subjectId),undefined);
  });
  test('worker: physical observation erasure cascades the copied normalised value',async()=>{
    const r=await fresh();await finish(await claim());const p=await projection(r.subjectId);await q('DELETE FROM v2_observations WHERE id=$1',[p.operator_observation_id]);assert.equal(await projection(r.subjectId),undefined);
  });
  test('worker: backend account erasure removes projection and preserves another contributor',async()=>{
    const a=await fresh();await finish(await claim());const b=await fresh(context().other);await finish(await claim());await q('SET LOCAL ROLE mabhazi_api');await q('DELETE FROM users WHERE id=$1',[context().user]);await q('RESET ROLE');
    assert.equal(await projection(a.subjectId),undefined);assert.ok(await projection(b.subjectId));assert.equal((await q('SELECT count(*) n FROM v2_receipts WHERE contribution_id=$1',[a.contributionId])).rows[0].n,'0');await q('SET CONSTRAINTS ALL IMMEDIATE');
  });
  test('worker: erasure of a leased contribution prevents old token resurrection',async()=>{
    const r=await fresh(),w=await claim();await q('DELETE FROM users WHERE id=$1',[context().user]);assert.equal(await finish(w),'lease_lost');assert.equal(await effectCount(w.id),'0');assert.equal(await projection(r.subjectId),undefined);
  });
  test('worker: unsupported policies, stages and future work stay pending',async()=>{
    const r=await fresh();await q("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE id=$1",[r.job.id]);
    await q("INSERT INTO v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('normalise',$1,$2,'future/2',gen_random_uuid()),('assess',$1,$2,'evidence/1',gen_random_uuid())",[r.subjectId,r.job.requested_generation]);assert.equal(await claim(),null);
  });
  test('worker: bounded drain and checkpoint rollback do not silently consume the rest of the backlog',async()=>{
    const a=await fresh(),b=await fresh(context().other);await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[a.job.id]);
    await q('SAVEPOINT lost_tick');const tick=(await q('SELECT v2_worker_drain_normalise(1) r')).rows[0].r;assert.equal(tick.done,1);await q('ROLLBACK TO SAVEPOINT lost_tick');await q('RELEASE SAVEPOINT lost_tick');
    assert.equal(await projection(a.subjectId),undefined);assert.equal(await projection(b.subjectId),undefined);
    assert.equal((await q('SELECT v2_worker_drain_normalise(1) r')).rows[0].r.done,1);assert.equal((await q('SELECT count(*) n FROM v2_normalised_leads WHERE subject_id=ANY($1::uuid[])',[[a.subjectId,b.subjectId]])).rows[0].n,'1');
    const h=(await q('SELECT v2_worker_health() h')).rows[0].h;assert.ok(h.normalise.lastCompletedAt);assert.ok(h.normalise.pending>=1);
    for(const n of [null,0,21])await invalid(()=>q('SELECT v2_worker_drain_normalise($1)',[n]),'23514');
  });
  test('worker: backend gets fenced facades and read-only projections; no direct queue mutation or owner retry',async()=>{
    const r=await fresh();await q('SET LOCAL ROLE mabhazi_api');const w=await claim();assert.equal(await finish(w),'done');assert.ok(await projection(r.subjectId));
    await invalid(()=>q('UPDATE v2_jobs SET state=state'));await invalid(()=>q('DELETE FROM v2_job_effects'));await invalid(()=>q('DELETE FROM v2_normalised_leads'));await invalid(()=>q('SELECT v2_worker_retry_normalise($1)',[w.id]));await q('RESET ROLE');
  });
  test('worker: hosted clients cannot invoke worker functions or read private projections',async()=>{
    const r=await fresh();for(const role of ['anon','authenticated']){await q(`SET LOCAL ROLE ${role}`);
      for(const sql of ['SELECT v2_worker_claim_normalise()','SELECT v2_worker_drain_normalise(1)','SELECT v2_worker_health()','SELECT * FROM v2_normalised_leads','SELECT * FROM v2_worker_status'])await invalid(()=>q(sql));
      await invalid(()=>q('SELECT v2_worker_finish_normalise($1,$2)',[r.job.id,randomUUID()]));await q('RESET ROLE');}
  });
  test('worker: crashed process leaves a committed lease reclaimable with a different token',{timeout:15_000},async()=>{
    const r=await fresh();await q('COMMIT');const dead=new pg.Client({connectionString:context().connectionString});await dead.connect();dead.on('error',()=>{});
    try{const w=(await dead.query('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;const pid=(await dead.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await q('SELECT pg_terminate_backend($1)',[pid]);assert.equal((await q('SELECT state FROM v2_jobs WHERE id=$1',[w.id])).rows[0].state,'leased');
      // Owner-only fixture advances120s expiry without slowing CI; not a production control.
      await q("UPDATE v2_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[w.id]);const newer=await claim();assert.equal(newer.id,w.id);assert.notEqual(newer.lease_token,w.lease_token);assert.equal(newer.attempt,2);
      assert.equal(await finish(w),'lease_lost');assert.equal(await finish(newer),'done');assert.equal(await effectCount(w.id),'1');assert.ok(await projection(r.subjectId));
    }finally{await dead.end().catch(()=>{});await q('BEGIN');}
  });
  test('worker: concurrent claimers skip locked work instead of sharing a lease',{timeout:15_000},async()=>{
    const a=await fresh(),b=await fresh(context().other);await q('UPDATE v2_jobs SET available_at=clock_timestamp() WHERE id=$1',[a.job.id]);await q('COMMIT');
    const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
    try{await left.query('BEGIN');await right.query('BEGIN');const l=(await left.query('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;
      const r=(await right.query('SELECT to_jsonb(v2_worker_claim_normalise()) w')).rows[0].w;assert.notEqual(l.id,r.id);assert.deepEqual(new Set([l.id,r.id]),new Set([a.job.id,b.job.id]));await left.query('COMMIT');await right.query('COMMIT');
    }finally{await left.query('ROLLBACK');await right.query('ROLLBACK');await left.end();await right.end();await q('BEGIN');}
  });
  for(const isolation of ['READ COMMITTED','REPEATABLE READ'])test(`worker: generation invalidation races an effect at ${isolation}`,{timeout:15_000},async()=>{
    const r=await fresh(),w=await claim();await q('COMMIT');const writer=new pg.Client({connectionString:context().connectionString}),worker=new pg.Client({connectionString:context().connectionString});await writer.connect();await worker.connect();
    try{await writer.query('BEGIN');await worker.query(`BEGIN ISOLATION LEVEL ${isolation}`);await worker.query("SET LOCAL statement_timeout='5s'");await worker.query('SELECT count(*) FROM v2_subjects');
      await writer.query('UPDATE v2_transport_guard SET toggle=NOT toggle WHERE id');await writer.query('UPDATE v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=$1',[r.subjectId]);
      const pending=worker.query('SELECT v2_worker_finish_normalise($1,$2) r',[w.id,w.lease_token]).then(v=>({r:v.rows[0].r,code:null}),e=>({r:null,code:e.code}));await writer.query('COMMIT');const result=await pending;
      if(isolation==='READ COMMITTED'){assert.equal(result.r,'superseded');await worker.query('COMMIT');}else{assert.equal(result.code,'40001');await worker.query('ROLLBACK');}
      assert.equal(await effectCount(w.id),'0');assert.equal(await projection(r.subjectId),undefined);
    }finally{await writer.query('ROLLBACK');await worker.query('ROLLBACK');await writer.end();await worker.end();await q('BEGIN');}
  });
}
