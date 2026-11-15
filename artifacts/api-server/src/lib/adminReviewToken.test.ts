import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createReviewPreview,readReviewPreview,validReviewItems,type AdminReviewItem} from './adminReviewToken';
const secret='synthetic-only-preview-test-secret',actor=randomUUID(),now=1800000000000;
function item():AdminReviewItem{return {routeId:randomUUID(),subjectId:randomUUID(),contributionId:randomUUID(),observationId:randomUUID(),fieldKey:'fare.paid',
 subjectRevision:'4',observationRevision:'1',targetRevision:'1',assessmentId:randomUUID(),caseRevision:'0'};}
test('admin preview: exact named actor, field and revision vectors are signed without a second role',()=>{
 const i=item(),token=createReviewPreview(actor,'approve',[i],secret,now),r=readReviewPreview(token,actor,secret,now+1);
 assert.deepEqual(r?.value.items,[i]);assert.equal(r?.expired,false);assert.ok(!token.includes(secret));
 assert.equal(readReviewPreview(token,randomUUID(),secret,now),null);
});
test('admin preview: changing an item, operation, date or signature invalidates the token',()=>{
 const token=createReviewPreview(actor,'approve',[item()],secret,now),[body,signature]=token.split('.');
 const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
 for(const change of [{...value,operation:'reverse'},{...value,expiresAt:now+600000},{...value,items:[{...value.items[0],subjectRevision:'5'}]}]){
  assert.equal(readReviewPreview(Buffer.from(JSON.stringify(change)).toString('base64url')+'.'+signature,actor,secret,now),null);
 }
 assert.equal(readReviewPreview(body+'.'+'A'.repeat(43),actor,secret,now),null);
});
test('admin preview: expiry remains explicit for receipt-first replay and future tokens fail closed',()=>{
 const token=createReviewPreview(actor,'approve',[item()],secret,now);
 assert.equal(readReviewPreview(token,actor,secret,now+300000)?.expired,true);
 assert.equal(readReviewPreview(token,actor,secret,now-30001),null);
});
test('admin preview: strict vectors reject unknown fields, spoofed actors and unsafe numbers',()=>{
 const i=item();for(const bad of [{...i,actor},{...i,fieldKey:'user.administrator'},{...i,subjectRevision:'9007199254740992'},{...i,subjectRevision:'4.0'},{...i,observationId:null}]){
  assert.equal(validReviewItems([bad],'approve'),false);
 }
 assert.equal(validReviewItems([i,i],'approve'),false);assert.equal(validReviewItems([],'approve'),false);
});
test('admin preview: endpoint assertions bind the initial report without fake observation IDs',()=>{
 const i=item(),core={...i,fieldKey:'route.origin',subjectId:i.routeId,observationId:null,observationRevision:null,targetRevision:null,assessmentId:null};
 assert.equal(validReviewItems([core],'approve'),true);assert.equal(validReviewItems([{...core,observationId:randomUUID()}],'approve'),false);
});
test('admin preview: reversal freezes an exact decision and malformed tokens do not throw',()=>{
 const i=item();assert.equal(validReviewItems([i],'reverse'),false);
 assert.equal(validReviewItems([{...i,reviewId:randomUUID()}],'reverse'),true);
 for(const bad of [null,{},'', 'a.b','a.b.c','A'.repeat(900001)])assert.equal(readReviewPreview(bad,actor,secret,now),null);
});
