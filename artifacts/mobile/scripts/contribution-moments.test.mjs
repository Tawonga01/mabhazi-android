import assert from 'node:assert/strict';
import test from 'node:test';
import { searchViewState, searchRoutePrefill } from '../lib/contribution-moments.ts';

const ready = { searched: true, loading: false, succeeded: true, failed: false, safetyLoading: false, safetyFailed: false, total: 0, visible: 0 };
test('empty-result invitation requires a completed successful search and loaded safety settings', () => {
  assert.equal(searchViewState(ready), 'empty');
  assert.equal(searchViewState({ ...ready, searched: false }), 'idle');
  assert.equal(searchViewState({ ...ready, loading: true }), 'loading');
  assert.equal(searchViewState({ ...ready, succeeded: false }), 'loading');
  assert.equal(searchViewState({ ...ready, succeeded: false, failed: true }), 'error');
  assert.equal(searchViewState({ ...ready, failed: true, total: 2, visible: 2 }), 'error');
  assert.equal(searchViewState({ ...ready, safetyLoading: true }), 'safety_loading');
  assert.equal(searchViewState({ ...ready, safetyFailed: true }), 'safety_error');
});
test('blocked results never become a missing-route invitation', () => {
  assert.equal(searchViewState({ ...ready, total: 2, visible: 0 }), 'hidden');
  assert.equal(searchViewState({ ...ready, total: 2, visible: 1 }), 'results');
});
test('prefill preserves explicit city identity and treats custom or stale names only as lookup hints', () => {
  const origin = { id: 11, name: 'Origin', placeType: 'city' };
  const destination = { id: 22, name: 'Destination', placeType: 'town' };
  const seed = searchRoutePrefill('Origin', 'Destination', origin, destination);
  assert.deepEqual(seed.origin, origin); assert.notEqual(seed.origin, origin);
  assert.deepEqual(seed.destination, destination);
  const stale = searchRoutePrefill('Different', 'Custom name', origin, null);
  assert.equal(stale.origin, null); assert.equal(stale.destination, null);
  assert.equal(stale.originQuery, 'Different'); assert.equal(stale.destinationQuery, 'Custom name');
  assert.equal('time' in seed, false); assert.equal('operator' in seed, false);
  assert.equal('day' in seed, false); assert.equal('price' in seed, false);
});
