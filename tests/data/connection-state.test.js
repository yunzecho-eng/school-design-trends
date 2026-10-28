import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTIONS, createConnectionState, publicConnectionState, prerequisite} from '../../src/integrations/connection-state.js';

const successful = {status: 'candidates_ready', complete: true, checked_at: '2026-10-28T01:00:00.000Z', last_success_at: '2026-10-28T01:00:00.000Z', retrieved_count: 5, source_total: 2667};

test('public status is an allowlist and cannot publish credentials, records, custom URLs or raw errors', () => {
  const state = createConnectionState();
  Object.assign(state, {checked_at: successful.checked_at, apiKey: 'SECRET-TOP', school_registry: [{name: 'PRIVATE-SCHOOL'}], firm_matches: [{name: 'PRIVATE-FIRM'}]});
  state.services.neis = {...successful, source_url: 'https://example.com/?KEY=SECRET-URL', required_env: 'SECRET-ENV', key: 'SECRET-KEY', raw_error: 'SECRET-ERROR', candidates: ['PRIVATE-CANDIDATE'], review_status: 'verified'};
  state.services.unknown = {status: 'candidates_ready', key: 'SECRET-UNKNOWN'};
  const original = JSON.stringify(state);
  const result = publicConnectionState(state);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET|PRIVATE|example\.com/);
  assert.deepEqual(Object.keys(result.services), Object.keys(CONNECTIONS));
  assert.equal(result.services.neis.source_url, CONNECTIONS.neis.url);
  assert.equal(result.services.neis.required_env, 'NEIS_API_KEY');
  assert.equal(result.services.neis.review_status, 'candidate_only');
  assert.equal(result.services.neis.complete, true);
  assert.equal(result.services.neis.retrieved_count, 5);
  assert.equal(result.checked_at, successful.checked_at);
  assert.equal(JSON.stringify(state), original);
});

test('latest failed attempt overrides an older success and its counts without losing last-success time', () => {
  const state = createConnectionState();
  state.services.neis = {...successful, last_attempt: {status: 'error', checked_at: '2026-10-28T03:00:00.000Z', message: 'SECRET'}};
  const result = publicConnectionState(state).services.neis;
  assert.equal(result.status, 'error');
  assert.equal(result.complete, false);
  assert.equal(result.checked_at, '2026-10-28T03:00:00.000Z');
  assert.equal(result.last_success_at, successful.last_success_at);
  assert.equal(Object.hasOwn(result, 'retrieved_count'), false);
  assert.equal(Object.hasOwn(result, 'source_total'), false);
  assert.equal(Object.hasOwn(result, 'last_attempt'), false);
});

test('sample success cannot become complete and missing prerequisites do not carry successful counts', () => {
  const state = createConnectionState();
  state.services.neis = {...successful, status: 'sample_only', sample_count: 5};
  state.services.firms = {...successful, status: 'key_required'};
  const result = publicConnectionState(state);
  assert.equal(result.services.neis.status, 'sample_only');
  assert.equal(result.services.neis.complete, false);
  assert.equal(result.services.neis.sample_count, 5);
  assert.equal(result.services.firms.complete, false);
  assert.equal(Object.hasOwn(result.services.firms, 'retrieved_count'), false);
});

test('invalid schema, status, counts and dates fall back without coercing missing values to zero', () => {
  assert.deepEqual(publicConnectionState(null), createConnectionState());
  assert.deepEqual(publicConnectionState({schema_version: 'future', services: {neis: successful}}), createConnectionState());
  const state = createConnectionState();
  state.services.neis = {...successful, status: 'SECRET-UNSUPPORTED'};
  assert.equal(publicConnectionState(state).services.neis.status, 'key_required');
  for (const value of [null, undefined, '', '5', -1, 1.2, Infinity, true, 10000001]) {
    state.services.neis = {...successful, retrieved_count: value, source_total: value};
    const result = publicConnectionState(state).services.neis;
    assert.equal(Object.hasOwn(result, 'retrieved_count'), false);
    assert.equal(Object.hasOwn(result, 'source_total'), false);
  }
  state.services.neis = {...successful, retrieved_count: 0, checked_at: 'SECRET-DATE'};
  const result = publicConnectionState(state).services.neis;
  assert.equal(result.retrieved_count, 0);
  assert.equal(Object.hasOwn(result, 'checked_at'), false);
});

test('KOSIS selection publishes only a bounded safe scope, never configuration contents', () => {
  const state = createConnectionState();
  state.services.kosis = {...successful, selection: {municipalities: 2, ages: 'SECRET-AGE', months: ['202509', '202609', '202613', 'SECRET-MONTH'], key: 'SECRET-KEY', config: 'PRIVATE-CONFIG'}};
  assert.deepEqual(publicConnectionState(state).services.kosis.selection, {municipalities: 2, ages: '6–17', months: ['202509', '202609']});
});

test('prerequisites distinguish keys, reviewed-parcel input and population configuration', () => {
  for (const kind of ['neis', 'schoolinfo', 'firms']) {
    assert.equal(prerequisite(kind, {}), 'key_required');
    assert.equal(prerequisite(kind, {[CONNECTIONS[kind].env]: '   '}), 'key_required');
    assert.equal(prerequisite(kind, {}, {sample: true}), null);
    assert.equal(prerequisite(kind, {[CONNECTIONS[kind].env]: 'present'}), null);
  }
  assert.equal(prerequisite('buildings', {}), 'key_and_parcel_required');
  assert.equal(prerequisite('buildings', {}, {sample: true}), 'key_and_parcel_required');
  assert.equal(prerequisite('buildings', {DATA_GO_KR_SERVICE_KEY: 'present'}), 'parcel_required');
  assert.equal(prerequisite('buildings', {DATA_GO_KR_SERVICE_KEY: 'present'}, {parcels: 'local.json'}), null);
  assert.equal(prerequisite('kosis', {}), 'key_and_config_required');
  assert.equal(prerequisite('kosis', {KOSIS_API_KEY: 'present'}), 'config_required');
  assert.equal(prerequisite('kosis', {KOSIS_API_KEY: 'present'}, {config: 'local.json'}), null);
  assert.throws(() => prerequisite('unknown', {}));
});
