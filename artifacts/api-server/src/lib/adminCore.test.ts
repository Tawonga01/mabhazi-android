import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCorePreview,readCorePreview,parseCoreProposal,type CoreProposal} from './adminCore';
const actor='00000000-0000-4000-8000-000000000001',secret='synthetic-admin-core-signing-key';
const proposal:CoreProposal={routeId:actor,operation:'correct',field:'departure.reported',value:{time:'08:00',basis:'scheduled'},
 basis:'observed_sign',observedDate:'2026-10-31',reason:'source_checked',reversedActionId:null};
test('core preview binds actor, property, value, basis, date and reason',()=>{
 const token=createCorePreview(proposal,actor,'3',secret,1000000),read=readCorePreview(token,actor,secret,1000010);
 assert.equal(read?.value?.time,'08:00');assert.equal(read?.basis,'observed_sign');assert.equal(read?.observedDate,'2026-10-31');
 assert.equal(readCorePreview(token,'other',secret,1000010),null);
 const [body,sig]=token.split('.'),data=JSON.parse(Buffer.from(body,'base64url').toString());data.value.time='09:00';
 assert.equal(readCorePreview(Buffer.from(JSON.stringify(data)).toString('base64url')+'.'+sig,actor,secret,1000010),null);
 assert.equal(readCorePreview(token,actor,secret+'changed',1000010),null);
});
test('expired proof can only reach SQL exact-receipt-before-expiry check',()=>{
 const token=createCorePreview(proposal,actor,'3',secret,1000000);
 assert.ok(readCorePreview(token,actor,secret,2000000));
 assert.equal(readCorePreview(token,actor,secret,900000),null);
});
test('core proposal rejects actor injection, missing knowledge, impossible dates and non-clock values',()=>{
 assert.equal(parseCoreProposal({...proposal,actor}),null);assert.equal(parseCoreProposal({...proposal,basis:undefined}),null);
 assert.equal(parseCoreProposal({...proposal,observedDate:'2026-02-30'}),null);
 assert.equal(parseCoreProposal({...proposal,value:{time:'when full',basis:'scheduled'}}),null);
 assert.equal(parseCoreProposal({...proposal,value:{time:'08:00'}}),null);
 assert.ok(parseCoreProposal({...proposal,observedDate:null,basis:'unprovided'}));
});
test('each of the four core properties validates exact typed values',()=>{
 for(const field of ['route.origin','route.destination'] as const){assert.ok(parseCoreProposal({...proposal,field,value:{cityId:1}}));assert.equal(parseCoreProposal({...proposal,field,value:{cityId:'1'}}),null);}
 assert.ok(parseCoreProposal({...proposal,field:'operator.reported',value:{name:'Operator'}}));
 assert.equal(parseCoreProposal({...proposal,field:'operator.reported',value:{name:' Operator '}}),null);
 assert.equal(parseCoreProposal({...proposal,field:'operator.reported',value:{name:'Operator\nNext'}}),null);
 assert.equal(parseCoreProposal({...proposal,field:'fare.paid',value:{amount:'15',currency:'USD'}}),null);
});
test('reversal names one exact property correction without supplying replacement facts',()=>{
 const reverse={...proposal,operation:'reverse',value:null,basis:'unprovided',observedDate:null,reversedActionId:actor};
 assert.ok(parseCoreProposal(reverse));assert.equal(parseCoreProposal({...reverse,value:{time:'08:00',basis:'scheduled'}}),null);
 assert.equal(parseCoreProposal({...reverse,reversedActionId:null}),null);
});
