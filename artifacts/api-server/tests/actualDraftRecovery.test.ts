import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import type { ActualDraft } from '../../mobile/lib/actual-journey-model';
import type { DraftStorage, SecureDraftRecord } from '../../mobile/lib/secure-draft-store';
import type { V2ActualJourneyRequest } from '@workspace/api-client-react';
const require = createRequire(import.meta.url);
const { emptyActualDraft, actualErrors, prepareActual, fareErrors, toggleActualFact, validActualDraft, resetActualDraft } = require('../../mobile/lib/actual-journey-model.ts') as typeof import('../../mobile/lib/actual-journey-model');
const { ActualDraftStore } = require('../../mobile/lib/actual-draft-store.ts') as typeof import('../../mobile/lib/actual-draft-store');
const { LeadDraftStore } = require('../../mobile/lib/lead-draft-store.ts') as typeof import('../../mobile/lib/lead-draft-store');
const { recoverOrSubmit } = require('../../mobile/lib/minimum-lead-model.ts') as typeof import('../../mobile/lib/minimum-lead-model');
const city = (id: number) => ({ id, name: `City ${id}`, placeType: 'city' });
const operatorDraft = (): ActualDraft => ({ ...emptyActualDraft(), facts: ['operator'], operator: 'Observed bus' });
const fareDraft = (): ActualDraft => ({ ...emptyActualDraft(), facts: ['fare'], fare: { ...emptyActualDraft().fare, amount: '0', currency: 'USD', basis: 'paid', origin: city(1), destination: city(2), date: '2026-10-22', passenger: 'unknown', ticket: 'unknown' } });
const saved = (key: string) => ({ contributionId: randomUUID(), clientSubmissionId: key, subjectId: randomUUID(), saveStatus: 'saved' as const, processingStatus: 'queued' as const, associationStatus: 'unresolved' as const, publicationStatus: 'pending' as const, replayed: false });
function fixture() {
  const values = new Map<string, string>(); let failAt: string | undefined, now = 1000;
  const storage: DraftStorage = { get: async k => values.get(k) ?? null, set: async (k, v) => { if (k === failAt) throw new Error('storage-failure'); values.set(k, v); }, remove: async k => { values.delete(k); } };
  const store = new ActualDraftStore(storage, () => now);
  const record = (draft = operatorDraft(), owner: string | null = 'account-a'): SecureDraftRecord<ActualDraft, V2ActualJourneyRequest> => ({ version: 1, owner, updatedAt: now, draft });
  return { values, storage, store, record, fail: (k: string) => { failAt = k; }, advance: (ms: number) => { now += ms; } };
}
test('actual input: one operator is enough; no invented route, day, zone or intention', () => {
  assert.ok(actualErrors(emptyActualDraft()).facts);
  assert.deepEqual(actualErrors(operatorDraft()), {});
  const request = prepareActual(operatorDraft(), randomUUID());
  assert.deepEqual(request.target, { newActualJourney: {} });
  assert.deepEqual(request.observations, [{ fieldKey: 'operator.reported', value: { name: 'Observed bus' }, scope: {} }]);
});
test('actual input: header context never fills clocks; explicit overnight dates remain separate', () => {
  const d = emptyActualDraft(); d.facts = ['departure','arrival']; d.serviceDate = '2026-10-22'; d.timezone = 'Africa/Harare';
  d.departure = { time: '23:40', date: '', zone: '' }; d.arrival = { time: '01:15', date: '2026-10-23', zone: '+02:00' };
  const result = prepareActual(d, randomUUID());
  assert.deepEqual(result.observations[0].scope, { schemaVersion: '1.0' });
  assert.deepEqual(result.observations[1].scope, { schemaVersion: '1.0', serviceDate: '2026-10-23', utcOffset: '+02:00' });
  for (const [key, value] of [['time','24:00'],['date','2026-02-30'],['zone','+14:01']] as const) assert.ok(actualErrors({ ...d, departure: { ...d.departure, [key]: value } })[`departure.${key}`]);
});
test('focused fare: no automatic defaults; explicit free fare and unknown conditions survive', () => {
  const d = fareDraft(); assert.deepEqual(fareErrors(d.fare), {});
  const fare = prepareActual(d, randomUUID()).observations[0]; assert.deepEqual(fare.value, { amount: '0', currency: 'USD' });
  assert.equal((fare.scope as { passengerCategory: string }).passengerCategory, 'unknown');
  assert.equal(emptyActualDraft().fare.currency, ''); assert.equal(emptyActualDraft().fare.passenger, ''); assert.equal(emptyActualDraft().fare.ticket, '');
  for (const amount of ['', '01', '1e2', '-1', '0.001', '1,50', '99999999999']) assert.ok(fareErrors({ ...d.fare, amount })['fare.amount']);
  assert.ok(fareErrors({ ...d.fare, date: '' })['fare.date']);
  assert.ok(fareErrors({ ...d.fare, currency: 'XXX' })['fare.currency']);
  assert.ok(fareErrors({ ...d.fare, destination: city(1) })['fare.destination']);
});
test('focused fare: basis dates and two different Other labels cannot be conflated', () => {
  const d = fareDraft(); d.fare.passenger = 'other'; d.fare.ticket = 'other';
  assert.ok(fareErrors(d.fare)['fare.passengerLabel']); assert.ok(fareErrors(d.fare)['fare.ticketLabel']);
  d.fare.passengerLabel = 'Student'; d.fare.ticketLabel = 'Weekly'; d.fare.basis = 'quoted';
  const quoted = prepareActual(d, randomUUID()).observations[0];
  assert.deepEqual(quoted.scope, { schemaVersion: '1.0', segment: { kind: 'city_pair', originCityId: 1, destinationCityId: 2 }, passengerCategory: 'other', ticketBasis: 'other', passengerLabel: 'Student', ticketLabel: 'Weekly', quotationDate: '2026-10-22' });
  d.fare.basis = 'advertised'; d.fare.date = '';
  assert.equal('serviceDate' in prepareActual(d, randomUUID()).observations[0].scope, false);
});
test('actual input: removing a section clears hidden values; named place requires a real city', () => {
  const d = fareDraft(); const removed = toggleActualFact(d, 'fare');
  assert.deepEqual(toggleActualFact(removed, 'fare').fare, emptyActualDraft().fare);
  const place = emptyActualDraft(); place.facts = ['place']; place.place.kind = 'pickup'; place.place.name = 'Main rank';
  assert.ok(actualErrors(place)['place.city']); place.place.city = city(4);
  assert.deepEqual(prepareActual(place, randomUUID()).observations[0], { fieldKey: 'boarding.pickup', value: { cityId: 4, name: 'Main rank' }, scope: {} });
});
test('actual input: dated operator and place do not refresh another fact or inherit journey context', () => {
  const d = operatorDraft(); d.facts.push('place'); d.operatorDate = '2026-10-21'; d.serviceDate = '2026-10-22'; d.knowledgeBasis = 'operator_statement';
  d.place = { kind: 'dropoff', city: city(3), name: 'Main rank', instructions: '', date: '' };
  const r = prepareActual(d, randomUUID()); assert.equal(r.observations[0].observedDate, '2026-10-21'); assert.equal(r.observations[1].observedDate, undefined);
  assert.deepEqual(r.actualContext, { knowledgeBasis: 'operator_statement' }); assert.equal(r.observations[0].knowledgeBasis, undefined);
  assert.equal(toggleActualFact(d, 'operator').operatorDate, '');
  assert.ok(actualErrors({ ...d, operatorDate: '2026-02-30' }).operatorDate);
});
test('actual drafts: partial answers, pending body and account isolation survive a storage restart', async () => {
  const f = fixture(), record = f.record(); record.pending = { actor: 'account-a', request: prepareActual(record.draft, randomUUID()) };
  await f.store.write(record); assert.deepEqual(await new ActualDraftStore(f.storage, () => 1000).read('account-a'), record);
  assert.equal(await f.store.read('account-b'), null); assert.equal(await f.store.read(null), null);
  const partial = emptyActualDraft(); partial.facts = ['fare']; partial.fare.amount = '2.';
  await f.store.write(f.record(partial, null)); assert.equal((await f.store.read(null))?.draft.fare.amount, '2.');
  assert.equal(await new LeadDraftStore(f.storage, () => 1000).read('account-a'), null);
});
test('actual drafts: torn writes retain previous bank; tampered pending payload is not resumed', async () => {
  const f = fixture(), original = f.record(); await f.store.write(original);
  f.fail('mabhazi_actual_draft_v1_account_1_0'); await assert.rejects(f.store.write(f.record(fareDraft())), /storage-failure/);
  assert.deepEqual(await f.store.read('account-a'), original);
  const tampered = fixture(), record = tampered.record(); record.pending = { actor: 'account-b', request: prepareActual(record.draft, randomUUID()) };
  await tampered.store.write(record); assert.equal(await tampered.store.read('account-a'), null); assert.equal(tampered.values.size, 0);
  const altered = fixture(), second = altered.record(); second.pending = { actor: 'account-a', request: prepareActual(fareDraft(), randomUUID()) };
  await altered.store.write(second); assert.equal(await altered.store.read('account-a'), null);
});
test('actual drafts: malformed sections, expiry and clear never revive answers', async () => {
  assert.equal(validActualDraft({ ...operatorDraft(), fare: null }), false);
  const f = fixture(); await f.store.write(f.record()); f.advance(30 * 24 * 60 * 60 * 1000); assert.equal(await f.store.read('account-a'), null); assert.equal(f.values.size, 0);
  const g = fixture(); await g.store.write(g.record()); const queued = g.store.write(g.record(fareDraft())); const cleared = g.store.clear();
  await assert.rejects(queued, /DRAFT_CLEARED/); await cleared; assert.equal(g.values.size, 0);
});
test('actual retry: lost acknowledgement returns original receipt with no second POST', async () => {
  const pending = { actor: 'account-a', request: prepareActual(fareDraft(), randomUUID()) }, receipt = saved(pending.request.clientSubmissionId); let writes = 0;
  assert.deepEqual(await recoverOrSubmit(pending, { lookup: async () => ({ found: true, initialReceipt: receipt }), submit: async () => { writes++; return receipt; } }, () => 'account-a'), receipt);
  assert.equal(writes, 0);
});
test('actual retry: failed lookup, switched actor and malformed receipts cannot send or confirm', async () => {
  const pending = { actor: 'account-a', request: prepareActual(operatorDraft(), randomUUID()) }; let actor: string | null = 'account-a', writes = 0;
  const submit = async () => { writes++; return saved(pending.request.clientSubmissionId); };
  await assert.rejects(recoverOrSubmit(pending, { lookup: async () => { throw new Error('offline'); }, submit }, () => actor), /offline/);
  await assert.rejects(recoverOrSubmit(pending, { lookup: async () => { actor = 'account-b'; return { found: false }; }, submit }, () => actor), /ACCOUNT_CHANGED/);
  actor = 'account-a'; await assert.rejects(recoverOrSubmit(pending, { lookup: async () => ({ found: true, initialReceipt: saved(randomUUID()) }), submit }, () => actor), /SAVE_UNCONFIRMED/);
  assert.equal(writes, 0);
});

const routeContext = () => ({ ownerId:'account-a', subjectId:randomUUID(), clientSubmissionId:randomUUID(), expectedRevision:7, origin:city(1), destination:city(2), operator:'Submitted bus', departureTime:'08:30' });
test('own-route draft: target survives secure close/resume and frozen request while old independent drafts remain compatible', async () => {
  const f=fixture(), draft={...operatorDraft(),entrySurface:'own_contribution' as const,route:routeContext()};
  const request=prepareActual(draft,randomUUID());
  assert.deepEqual(request.target.newActualJourney.intendedSubject,{kind:'lead',id:draft.route.subjectId,expectedRevision:7});
  assert.equal(request.entrySurface,'own_contribution');assert.equal(request.observations.length,1);
  const record={...f.record(draft),pending:{actor:'account-a',request}};await f.store.write(record);
  assert.deepEqual(await f.store.read('account-a'),record);assert.equal(await f.store.read('account-b'),null);
  assert.equal(prepareActual(operatorDraft(),randomUUID()).entrySurface,'contribute_tab');
  assert.equal('intendedSubject' in prepareActual(operatorDraft(),randomUUID()).target.newActualJourney,false);
});
test('own-route draft: no inferred trip facts and Fare carries only city identity, never price/basis/date', () => {
  const draft={...emptyActualDraft(),entrySurface:'own_contribution' as const,route:routeContext()};
  assert.ok(actualErrors(draft).facts);assert.deepEqual(draft.facts,[]);
  const fare=toggleActualFact(draft,'fare');
  assert.deepEqual(fare.fare.origin,draft.route.origin);assert.deepEqual(fare.fare.destination,draft.route.destination);
  assert.equal(fare.fare.amount,'');assert.equal(fare.fare.basis,'');assert.equal(fare.fare.date,'');assert.equal(fare.fare.currency,'');
  const removed=toggleActualFact({...fare,fare:{...fare.fare,amount:'25'}},'fare');assert.equal(removed.fare.amount,'');
});
test('own-route draft: malformed selection, changed frozen target and foreign owner are never resumed', async () => {
  const draft={...operatorDraft(),entrySurface:'own_contribution' as const,route:routeContext()};
  assert.equal(validActualDraft({...draft,route:{...draft.route,expectedRevision:0}}),false);
  assert.equal(validActualDraft({...draft,route:{...draft.route,subjectId:'legacy-42'}}),false);
  const f=fixture();await f.store.write(f.record({...draft,route:{...draft.route,ownerId:'account-b'}}));assert.equal(await f.store.read('account-a'),null);
  const g=fixture(), record=g.record(draft);record.pending={actor:'account-a',request:prepareActual({...draft,route:{...draft.route,subjectId:randomUUID()}},randomUUID())};
  await g.store.write(record);assert.equal(await g.store.read('account-a'),null);
  const {route:omitted,...independent}=draft;
  assert.equal(prepareActual(independent,randomUUID()).entrySurface,'own_contribution');
  assert.equal('intendedSubject' in prepareActual(independent,randomUUID()).target.newActualJourney,false);
});

test('another report: preserve the current target or explicit independent choice, never stale entry context or reported facts', () => {
  const original={...operatorDraft(),entrySurface:'own_contribution' as const,route:routeContext()};
  const next=resetActualDraft(original);assert.deepEqual(next.route,original.route);assert.deepEqual(next.facts,[]);assert.equal(next.operator,'');
  const {route:omitted,...independent}=original, fresh=resetActualDraft(independent);
  assert.equal(fresh.route,undefined);assert.equal(fresh.entrySurface,'own_contribution');assert.deepEqual(fresh.facts,[]);
});


test('public route draft: secure persistence retains a public selection without a private receipt identifier or inferred journey facts',async()=>{
 const {clientSubmissionId:omitted,...base}=routeContext(),route={...base,source:'public' as const};
 const draft={...operatorDraft(),entrySurface:'route_detail' as const,route};assert.equal(validActualDraft(draft),true);
 const request=prepareActual(draft,randomUUID());assert.equal(request.entrySurface,'route_detail');assert.deepEqual(request.target.newActualJourney.intendedSubject,{kind:'lead',id:route.subjectId,expectedRevision:route.expectedRevision});assert.equal(request.observations.length,1);assert.equal(request.target.newActualJourney.reportedServiceDate,undefined);
 const f=fixture(),record={...f.record(draft),pending:{actor:'account-a',request}};await f.store.write(record);assert.deepEqual(await f.store.read('account-a'),record);
 assert.equal(validActualDraft({...draft,entrySurface:'own_contribution'}),false);assert.equal(validActualDraft({...draft,route:{...route,source:'forged'}}),false);
 const fare=toggleActualFact({...emptyActualDraft(),entrySurface:'route_detail',route},'fare');assert.deepEqual(fare.fare.origin,route.origin);assert.equal(fare.fare.amount,'');assert.equal(fare.fare.basis,'');assert.equal(fare.fare.date,'');
});
