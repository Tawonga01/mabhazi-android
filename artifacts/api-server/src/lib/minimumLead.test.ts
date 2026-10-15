import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import { pool } from '@workspace/db';
import { saveMinimumLead, saveIntake, type IntakePool } from './minimumLead';
after(() => pool.end());
const receipt = {contributionId:randomUUID(),clientSubmissionId:randomUUID(),subjectId:randomUUID(),saveStatus:'saved',processingStatus:'queued',associationStatus:'unresolved',publicationStatus:'pending',replayed:false};
test('actual save: uses the selected server facade and never acknowledges a lost commit',async()=>{
  const events:string[]=[];
  const database:IntakePool={connect:async()=>({query:async(sql,values)=>{events.push(sql);if(sql.startsWith('SELECT')){assert.ok(sql.includes('v2_api_submit_actual_journey'));assert.deepEqual(values,['server-actor','2026-09-12',JSON.stringify({frozen:true})]);return {rows:[{receipt}]};}if(sql==='COMMIT')throw new Error('actual-commit-lost');return {rows:[]};},release:()=>events.push('release')})};
  await assert.rejects(saveIntake('server-actor',{frozen:true},'v2_api_submit_actual_journey',database),/actual-commit-lost/);assert.deepEqual(events.slice(-3),['COMMIT','ROLLBACK','release']);
});
test('minimum save: acknowledgement waits for COMMIT and releases connection',async () => {
  let releaseCommit!:()=>void, commitStarted!:()=>void, returned=false, released=false;
  const begun=new Promise<void>(resolve=>{commitStarted=resolve}), gate=new Promise<void>(resolve=>{releaseCommit=resolve});
  const events:string[]=[];
  const database:IntakePool={connect:async()=>({query:async sql=>{events.push(sql);if(sql==='COMMIT'){commitStarted();await gate;}return {rows:sql.startsWith('SELECT')?[{receipt}]:[]};},release:()=>{released=true;}})};
  const saving=saveMinimumLead('server-actor',{body:'fixture'},database).then(value=>{returned=true;return value;});
  await begun; assert.equal(returned,false);assert.equal(released,false);releaseCommit();assert.deepEqual(await saving,receipt);assert.equal(released,true);assert.equal(events.at(-1),'COMMIT');
});
test('minimum save: uncertain COMMIT is never acknowledged and rollback/release run',async () => {
  const events:string[]=[];
  const database:IntakePool={connect:async()=>({query:async sql=>{events.push(sql);if(sql==='COMMIT')throw new Error('connection-lost');return {rows:sql.startsWith('SELECT')?[{receipt}]:[]};},release:()=>{events.push('release');}})};
  await assert.rejects(saveMinimumLead('actor',{},database),/connection-lost/);assert.deepEqual(events.slice(-3),['COMMIT','ROLLBACK','release']);
});
test('minimum save: serialisation retries use the same actor, Terms and frozen input; attempts are bounded',async () => {
  let connections=0;const parameters:unknown[][]=[];
  const database:IntakePool={connect:async()=>{connections++;return {query:async(sql,values)=>{if(sql.startsWith('SELECT')){parameters.push(values!);if(connections<3)throw Object.assign(new Error('retry'),{code:'40001'});return {rows:[{receipt}]};}return {rows:[]};},release:()=>{}};}};
  const input={key:'unchanged'};assert.deepEqual(await saveMinimumLead('server-actor',input,database),receipt);assert.equal(connections,3);assert.deepEqual(parameters,Array(3).fill(['server-actor','2026-09-12',JSON.stringify(input)]));
  const failing:IntakePool={connect:async()=>({query:async()=>{throw Object.assign(new Error('retry'),{code:'40001'});},release:()=>{connections++;}})};
  connections=0;await assert.rejects(saveMinimumLead('actor',{},failing));assert.equal(connections,3);
});
