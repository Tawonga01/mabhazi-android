import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { emptyPlaceDraft, emptyPlaceAnswer, placeErrors, preparePlaces, togglePlace, validPlaceDraft } = require('../../mobile/lib/route-place-model.ts') as typeof import('../../mobile/lib/route-place-model');
const { RoutePlaceDraftStore } = require('../../mobile/lib/route-place-draft-store.ts') as typeof import('../../mobile/lib/route-place-draft-store');
const { newPickupQuestion, reservationFor, acceptPickupQuestion, queuePickupEvent, acknowledgePickupEvent, independentPlaces } = require('../../mobile/lib/pickup-question-model.ts') as typeof import('../../mobile/lib/pickup-question-model');
function draft() { return { ...emptyPlaceDraft(), route: { subjectId: randomUUID(), revision: 4, identityKey: 'a'.repeat(64), ownerId: 'account-a', origin: {id:1,name:'Bulawayo',placeType:'city'}, destination: {id:2,name:'Gweru',placeType:'city'}, operatorName: 'Location coach', departureTime: '08:45' }, pickup: { ...emptyPlaceAnswer(), name: '  Main rank  ' } }; }
function storage() { const values = new Map<string,string>(); return { values, get: async(k:string)=>values.get(k)??null, set:async(k:string,v:string)=>{values.set(k,v);}, remove:async(k:string)=>{values.delete(k);} }; }
test('place capture: named pickup uses displayed endpoint identity without inventing travel/date/source',()=>{const d=draft(),r=preparePlaces(d,randomUUID());assert.deepEqual(placeErrors(d),{});assert.deepEqual(r.target,{existing:{subjectId:d.route.subjectId,expectedRevision:4,identityKey:'a'.repeat(64)}});assert.deepEqual(r.observations,[{fieldKey:'boarding.pickup',value:{cityId:1,name:'Main rank'},scope:{}}]);assert.ok(!JSON.stringify(r).includes('ActualJourney'));});
test('place capture: two endpoint facts retain their own directions, dates and knowledge',()=>{const d={...draft(),selected:['dropoff','pickup'] as ('pickup'|'dropoff')[],dropoff:{name:'Market stop',instructions:'South gate',date:'2026-10-25',knowledge:'observed_sign' as const}};const r=preparePlaces(d,randomUUID());assert.equal(r.observations[1].fieldKey,'alighting.dropoff');assert.equal(r.observations[1].value.cityId,2);assert.equal(r.observations[1].knowledgeBasis,'observed_sign');assert.equal(r.observations[1].observedDate,'2026-10-25');assert.ok(!('observedDate' in r.observations[0]));});
test('place capture: deselecting clears hidden answers; unknown date stays blank',()=>{const d=draft();d.pickup.date='2026-02-30';assert.ok(placeErrors(d)['pickup.date']);const off=togglePlace(d,'pickup');assert.deepEqual(off.pickup,emptyPlaceAnswer());assert.ok(placeErrors(off).selected);assert.deepEqual(togglePlace(off,'pickup').pickup,emptyPlaceAnswer());assert.ok(placeErrors(emptyPlaceDraft()).route);});
test('place capture: secure resume retains original target and frozen request',async()=>{const mem=storage(),store=new RoutePlaceDraftStore(mem),d=draft(),r=preparePlaces(d,randomUUID());await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:d,pending:{actor:'account-a',request:r}});assert.equal(await store.read('account-b'),null);const saved=await store.read('account-a');assert.deepEqual(saved?.pending?.request,r);assert.deepEqual(saved?.draft.route,d.route);});
test('place capture: mismatched pending endpoint or owner cannot resume',async()=>{for(const wrong of ['request','owner']){const mem=storage(),store=new RoutePlaceDraftStore(mem),d=draft(),r=preparePlaces(d,randomUUID());if(wrong==='request')r.observations[0].value.cityId=2;else d.route.ownerId='other';await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:d,pending:{actor:'account-a',request:r}});assert.equal(await store.read('account-a'),null);}});
test('place capture: explicit changed-context recovery blocks save until new context reviewed',()=>{const d={...draft(),needsContextRefresh:true};assert.ok(validPlaceDraft(d));assert.ok(placeErrors(d).route);assert.throws(()=>preparePlaces(d,randomUUID()));assert.equal(preparePlaces({...d,needsContextRefresh:false,route:{...d.route,identityKey:'b'.repeat(64),revision:5}},randomUUID()).target.existing.identityKey,'b'.repeat(64));});
test('place capture: logout clearing removes all location content and references',async()=>{const mem=storage(),store=new RoutePlaceDraftStore(mem),d=draft();await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:d});await store.clear();assert.equal(await store.read('account-a'),null);assert.equal(mem.values.size,0);assert.equal(validPlaceDraft({...d,selected:['pickup','pickup']}),false);assert.throws(()=>preparePlaces(d,'not-a-uuid'));});

function questionDraft() { const d = draft(); return { ...d, question: { ...newPickupQuestion(d, randomUUID()), declaration: 'knows_route' as const } }; }
function offered() { const d = questionDraft(); return acceptPickupQuestion(d, { status: 'offered', invitationId: randomUUID(), questionKey: 'pickup_place', formSchemaId: 'boarding-pickup/1', expiresAt: '2026-10-28T00:00:00Z', route: d.route }); }
function answeredDraft() { let d = offered(); for (const outcome of ['shown','opened'] as const) { const id = randomUUID(); d = acknowledgePickupEvent(queuePickupEvent(d, outcome, id, 'Africa/Harare'), id); } return d; }
test('pickup question: reservation requires volunteered context and retains its request ID without creating evidence', () => {
  const d = questionDraft(), first = reservationFor(d); assert.deepEqual(reservationFor(d), first); assert.deepEqual(first.declaredContext, ['knows_route']);
  assert.equal(d.pickup.knowledge, ''); assert.equal(d.pickup.date, ''); assert.throws(() => reservationFor({ ...d, question: { ...d.question, declaration: '' } }));
});
test('pickup question: compatible revision advances preserve identity; wrong subject or identity never retargets', () => {
  const d = questionDraft();
  for (const change of [{ revision: 5 }, { subjectId: randomUUID() }, { identityKey: 'b'.repeat(64) }]) {
    const next = acceptPickupQuestion(d, { status: 'offered', invitationId: randomUUID(), questionKey: 'pickup_place', formSchemaId: 'boarding-pickup/1', expiresAt: '2026-10-28T00:00:00Z', route: { ...d.route, ...change } });
    if ('revision' in change) assert.equal(next.route?.revision,5); else { assert.equal(next.question?.phase,'none'); assert.equal(next.route?.subjectId,d.route.subjectId); assert.equal(next.question?.reason,'reconfirm_identity'); }
  }
});
test('pickup question: no-question result has no invitation and keeps manual reporting available', () => {
  const d = acceptPickupQuestion(questionDraft(), { status: 'none' }); assert.equal(d.question?.phase,'none'); assert.ok(placeErrors(d).question); const normal = independentPlaces(d);
  assert.equal(normal.question,undefined); assert.deepEqual(preparePlaces(normal,randomUUID()).observations[0].value,{cityId:1,name:'Main rank'});
});
test('pickup question: shown/opened event replay preserves the exact stored event ID and timezone', () => {
  const d = offered(), id = randomUUID(), queued = queuePickupEvent(d,'shown',id,'Africa/Harare');
  assert.deepEqual(queuePickupEvent(queued,'shown',randomUUID(),'UTC'),queued); assert.equal(queued.question?.events[0].sent,false); assert.ok(placeErrors(queued).question);
  assert.equal(acknowledgePickupEvent(queued,id).question?.events[0].sent,true); assert.throws(() => queuePickupEvent(d,'shown',randomUUID(),'not/a/timezone'));
});
test('pickup question: answer payload stays strictly unchanged; declaration is not observation knowledge', () => {
  const d = answeredDraft(), request = preparePlaces(d,randomUUID()); assert.deepEqual(Object.keys(request),['schemaVersion','clientSubmissionId','entrySurface','target','observations']); assert.equal(request.observations[0].fieldKey,'boarding.pickup');
  assert.equal(request.observations[0].knowledgeBasis,undefined); assert.equal(request.observations[0].observedDate,undefined); assert.ok(!JSON.stringify(request).includes(d.question!.invitationId!)); assert.deepEqual(placeErrors(d),{});
});
test('pickup question: unacknowledged open and unrelated drop-off cannot be saved as the answer', () => {
  const d = queuePickupEvent(offered(),'opened',randomUUID(),'UTC'); assert.ok(placeErrors(d).question); assert.throws(() => preparePlaces(d,randomUUID()));
  assert.ok(placeErrors({...answeredDraft(),selected:['dropoff']}).question);
});
test('pickup question: skip/dismiss/unknown produce feedback only and retain unsent place answers', () => {
  for (const outcome of ['skip','dismiss','unknown'] as const) { const id=randomUUID(), d=acknowledgePickupEvent(queuePickupEvent(answeredDraft(),outcome,id,'UTC'),id); assert.equal(d.question?.phase,'ended'); assert.equal(d.pickup.name,'  Main rank  '); assert.throws(()=>preparePlaces(d,randomUUID())); const normal=independentPlaces(d); assert.equal(normal.pickup.name,d.pickup.name); assert.equal(normal.question,undefined); }
});
test('pickup question: encrypted account draft retains invitation, pending event and answer reference across interruption', async () => {
  const mem=storage(),store=new RoutePlaceDraftStore(mem),d=answeredDraft(),request=preparePlaces(d,randomUUID()); await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:d,pending:{actor:'account-a',request}});
  assert.equal(await store.read('account-b'),null); const saved=await store.read('account-a'); assert.equal(saved?.draft.question?.invitationId,d.question?.invitationId); assert.deepEqual(saved?.pending?.request,request);
  await store.clear(); assert.equal(await store.read('account-a'),null);
});
test('pickup question: mismatched question identity cannot resume; ordinary old drafts remain compatible', async () => {
  const mem=storage(),store=new RoutePlaceDraftStore(mem),d=answeredDraft(); d.question!.identityKey='b'.repeat(64); await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:d}); assert.equal(await store.read('account-a'),null);
  const old=draft(); await store.write({version:1,owner:'account-a',updatedAt:Date.now(),draft:old}); assert.deepEqual((await store.read('account-a'))?.draft,old);
});
