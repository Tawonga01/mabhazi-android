import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drainNormalise } from './normaliseWorker';
test('worker adapter: an unconfirmed COMMIT never returns success and always releases the connection',async()=>{
  const calls:string[]=[];let released=false;
  const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql==='COMMIT')throw new Error('connection lost');return {rows:[{result:{done:1,superseded:0,failedAttempts:0}}]};},release:()=>{released=true;}})};
  await assert.rejects(()=>drainNormalise(pool,1));assert.equal(released,true);assert.equal(calls.at(-1),'ROLLBACK');
});
test('worker adapter: statement timeout rolls back the entire tick and keeps the connection reusable',async()=>{
  const calls:string[]=[];let released=false;
  const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql.startsWith('SELECT'))throw Object.assign(new Error('timeout'),{code:'57014'});return {rows:[]};},release:()=>{released=true;}})};
  await assert.rejects(()=>drainNormalise(pool,1));assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,true);
});
