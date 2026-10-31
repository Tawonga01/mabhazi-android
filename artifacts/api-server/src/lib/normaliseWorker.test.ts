import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drainNormalise, drainAssociation, drainAssessment, drainTasks } from './normaliseWorker';
test('worker adapter: an unconfirmed COMMIT never returns success and always releases the connection',async()=>{
  const calls:string[]=[];let released=false;
  const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql==='COMMIT')throw new Error('connection lost');return {rows:[{result:{done:1,superseded:0,failedAttempts:0}}]};},release:()=>{released=true;}})};
  await assert.rejects(()=>drainNormalise(pool,1));assert.equal(released,true);assert.equal(calls.at(-1),'ROLLBACK');
});
test('association adapter: a continued scan is acknowledged only after commit',async()=>{
  const calls:string[]=[];let released=false;
  const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);return {rows:[{result:{done:0,superseded:0,failedAttempts:0,continued:1}}]};},release:()=>{released=true;}})};
  assert.equal((await drainAssociation(pool,1)).continued,1);assert.ok(calls.includes('SELECT public.v2_worker_drain_associate($1) result'));assert.equal(calls.at(-1),'COMMIT');assert.equal(released,true);
});
test('association adapter: unknown commit and invalid continuation results never report success',async()=>{
  for(const uncertain of [true,false]){let released=false;const calls:string[]=[];
    const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql==='COMMIT' && uncertain)throw new Error('lost acknowledgement');return {rows:[{result:{done:0,superseded:0,failedAttempts:0,...(uncertain?{continued:1}:{})}}]};},release:()=>{released=true;}})};
    await assert.rejects(()=>drainAssociation(pool,1));assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,true);
  }
});
test('worker adapter: statement timeout rolls back the entire tick and keeps the connection reusable',async()=>{
  const calls:string[]=[];let released=false;
  const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql.startsWith('SELECT'))throw Object.assign(new Error('timeout'),{code:'57014'});return {rows:[]};},release:()=>{released=true;}})};
  await assert.rejects(()=>drainNormalise(pool,1));assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,true);
});

test('assessment adapter: scoped continuation, timeouts and ambiguous commits remain fenced',async()=>{
 for(const mode of ['success','timeout','commit','invalid']){const calls:string[]=[];let released=false;
 const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(mode==='timeout'&&sql.startsWith('SELECT'))throw new Error('timeout');if(mode==='commit'&&sql==='COMMIT')throw new Error('lost acknowledgement');return{rows:[{result:{done:0,superseded:0,failedAttempts:0,...(mode==='invalid'?{}:{continued:1})}}]};},release:()=>{released=true;}})};
 if(mode==='success')assert.equal((await drainAssessment(pool,1)).continued,1);else await assert.rejects(()=>drainAssessment(pool,1));
 assert.ok(calls.includes('SELECT public.v2_worker_drain_assess($1) result'));assert.equal(calls.at(-1),mode==='success'?'COMMIT':'ROLLBACK');assert.equal(released,true);
 }
});

test('task refresh adapter: scoped continuation, timeouts and ambiguous commits remain fenced',async()=>{
 for(const mode of ['success','timeout','commit','invalid']){const calls:string[]=[];let released=false;
 const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(mode==='timeout'&&sql.startsWith('SELECT'))throw new Error('timeout');if(mode==='commit'&&sql==='COMMIT')throw new Error('lost acknowledgement');return{rows:[{result:{done:0,superseded:0,failedAttempts:0,...(mode==='invalid'?{}:{continued:1})}}]};},release:()=>{released=true;}})};
 if(mode==='success')assert.equal((await drainTasks(pool,1)).continued,1);else await assert.rejects(()=>drainTasks(pool,1));
 assert.ok(calls.includes('SELECT public.v2_worker_drain_tasks($1) result'));assert.equal(calls.at(-1),mode==='success'?'COMMIT':'ROLLBACK');assert.equal(released,true);
 }
});
