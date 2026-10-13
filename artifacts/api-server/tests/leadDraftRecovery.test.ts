import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { draftErrors, emptyLeadDraft, prepareLead, recoverOrSubmit, type LeadDraft } from '../../mobile/lib/minimum-lead-model';
import { LeadDraftStore, type DraftRecord, type DraftStorage } from '../../mobile/lib/lead-draft-store';
const city=(id:number)=>({id,name:'City '+id,placeType:'city'});
const draft:LeadDraft={origin:city(1),destination:city(2),time:'00:00',operator:'Known bus'};
const frozen=()=>({actor:'account-a',request:prepareLead(draft,randomUUID())});
const saved=(key:string)=>({contributionId:randomUUID(),clientSubmissionId:key,subjectId:randomUUID(),saveStatus:'saved' as const,processingStatus:'queued' as const,associationStatus:'unresolved' as const,publicationStatus:'pending' as const,replayed:false});
function fixture() {
  const values=new Map<string,string>();let failAt:string|undefined;
  const storage:DraftStorage={get:async k=>values.get(k)??null,set:async(k,v)=>{if(k===failAt)throw new Error('storage-failure');values.set(k,v);},remove:async k=>{values.delete(k);}};
  let now=1000;const store=new LeadDraftStore(storage,()=>now);
  const record=(owner:string|null='account-a'):DraftRecord=>({version:1,owner,updatedAt:now,draft});
  return {store,values,storage,record,fail:(k:string)=>{failAt=k;},advance:(ms:number)=>{now+=ms;}};
}
test('minimum form: no hidden clock default; exactly four required answers',()=>{
  assert.equal(emptyLeadDraft().time,'');assert.deepEqual(Object.keys(draftErrors(emptyLeadDraft())),['origin','destination','time','operator']);
  assert.deepEqual(draftErrors(draft),{});assert.equal(prepareLead(draft,randomUUID()).target.newLead.departureTime,'00:00');
  assert.equal('price' in prepareLead(draft,randomUUID()).target.newLead,false);
  for(const time of ['','8:30','24:00','Leaves when full','08:60'])assert.ok(draftErrors({...draft,time}).time);
  assert.ok(draftErrors({...draft,destination:city(1)}).destination);
  for(const operator of ['','unknown','N/A','-','Bad\nname'])assert.ok(draftErrors({...draft,operator}).operator);
});
test('minimum retry: receipt recovery after lost response does not resend or change key',async()=>{
  const pending=frozen(), receipt=saved(pending.request.clientSubmissionId);let writes=0;
  assert.deepEqual(await recoverOrSubmit(pending,{lookup:async()=>({found:true,initialReceipt:receipt}),submit:async()=>{writes++;return receipt;}},()=>pending.actor),receipt);
  assert.equal(writes,0);
});
test('minimum retry: missing receipt sends exactly the frozen answers after lookup',async()=>{
  const pending=frozen(), order:string[]=[];
  await recoverOrSubmit(pending,{lookup:async key=>{assert.equal(key,pending.request.clientSubmissionId);order.push('lookup');return {found:false};},submit:async input=>{order.push('submit');assert.deepEqual(input,pending.request);return saved(input.clientSubmissionId);}},()=>pending.actor);
  assert.deepEqual(order,['lookup','submit']);
});
test('minimum retry: failed lookup never sends, and a changed account cannot submit old answers',async()=>{
  const pending=frozen();let writes=0,actor:string|null=pending.actor;
  const submit=async()=>{writes++;return saved(pending.request.clientSubmissionId);};
  await assert.rejects(recoverOrSubmit(pending,{lookup:async()=>{throw new Error('offline');},submit},()=>actor),/offline/);
  await assert.rejects(recoverOrSubmit(pending,{lookup:async()=>{actor='account-b';return {found:false};},submit},()=>actor),/ACCOUNT_CHANGED/);
  await assert.rejects(recoverOrSubmit(pending,{lookup:async()=>({found:false}),submit},()=>null),/ACCOUNT_CHANGED/);assert.equal(writes,0);
});
test('minimum retry: mismatched/absent receipt is not save confirmation',async()=>{
  const pending=frozen();await assert.rejects(recoverOrSubmit(pending,{lookup:async()=>({found:true}),submit:async()=>saved(randomUUID())},()=>pending.actor),/SAVE_UNCONFIRMED/);
});
test('native draft: restart/navigation retains exact pending reference and account ownership',async()=>{
  const f=fixture(),pending=frozen(),record={...f.record(),pending};await f.store.write(record);
  const restarted=new LeadDraftStore(f.storage,()=>1000);assert.deepEqual(await restarted.read('account-a'),record);assert.equal(await restarted.read('account-b'),null);
  await f.store.write(f.record(null));assert.deepEqual((await restarted.read(null))?.draft,draft);assert.equal((await restarted.read(null))?.pending,undefined);
});
test('native draft: partial encrypted-bank failure keeps the previous complete answers',async()=>{
  const f=fixture();await f.store.write(f.record());f.fail('mabhazi_lead_draft_v1_account_1_0');
  await assert.rejects(f.store.write({...f.record(),draft:{...draft,operator:'New bus'}}));assert.deepEqual((await f.store.read('account-a'))?.draft,draft);
});
test('native draft: partial manifest failure never activates incomplete new content',async()=>{
  const f=fixture();await f.store.write(f.record());f.fail('mabhazi_lead_draft_v1_account_manifest');
  await assert.rejects(f.store.write({...f.record(),draft:{...draft,time:'10:00'}}));assert.equal((await f.store.read('account-a'))?.draft.time,'00:00');
});
test('native draft: explicit resume does not auto-send, malformed pending is rejected',async()=>{
  const f=fixture();await f.store.write({...f.record(),pending:{...frozen(),actor:'account-b'}});assert.equal(await f.store.read('account-a'),null);assert.equal(f.values.size,0);
});
test('native draft: encrypted chunks bound Unicode byte sizes; no unbounded/plaintext fallback',async()=>{
  const f=fixture(),record={...f.record(),draft:{...draft,operator:'🚌'.repeat(120)}};await f.store.write(record);
  for(const value of f.values.values())assert.ok(Buffer.byteLength(value,'utf8')<=1200);
  await assert.rejects(f.store.write({...record,draft:{...draft,operator:'🚌'.repeat(5000)}}),/too large/);
});
test('native draft: 30-day expiry purges both banks, not merely its manifest',async()=>{
  const f=fixture();await f.store.write(f.record());f.advance(30*24*60*60*1000);assert.equal(await f.store.read('account-a'),null);assert.equal(f.values.size,0);
});
test('native draft: sign-out/deletion clears guest/account drafts and invalidates queued writes',async()=>{
  const f=fixture();await f.store.write(f.record(null));await f.store.write(f.record());
  const late=f.store.write(f.record()),clear=f.store.clear();await assert.rejects(late,/DRAFT_CLEARED/);await clear;assert.equal(f.values.size,0);
});
