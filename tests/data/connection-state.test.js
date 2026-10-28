import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTIONS, createConnectionState, publicConnectionState, prerequisite} from '../../src/integrations/connection-state.js';
import {connectionText, buildingCoverageText} from '../../src/ui/official-status.js';

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

test('official KOSIS bulk delivery stays distinct from API authentication and is safe to reprocess', () => {
  const state = createConnectionState();
  state.services.kosis = {...successful, method: 'official_bulk_download', required_env: 'SECRET',
    source_url: 'https://example.com/?apiKey=SECRET', provenance: {key: 'SECRET', rows: ['PRIVATE']}};
  const output = publicConnectionState(state);
  assert.equal(output.services.kosis.method, 'official_bulk_download');
  assert.equal(Object.hasOwn(output.services.kosis, 'required_env'), false);
  assert.match(output.services.kosis.source_url, /^https:\/\/kosis\.kr\/statisticsList\/mass\/mass_list\.jsp\?/);
  assert.doesNotMatch(JSON.stringify(output), /SECRET|PRIVATE|example\.com/);
  assert.match(connectionText(output.services.kosis), /공식 CSV 다운로드/);
  assert.deepEqual(publicConnectionState(output), output);
});

test('SchoolInfo district scope survives public reload without publishing raw geography or keys', () => {
  const state = createConnectionState();
  state.services.schoolinfo = {...successful, geography: {boundary_basis: 'schoolinfo_current_query_codes',
    codes_checked_on: '2026-10-28', official_sgg_count: 47, sgg_codes: ['41111', '41113'], secret: 'SECRET'},
    planned_requests: 30, completed_requests: 30, status: 'subset_only', complete: false};
  const output = publicConnectionState(state);
  assert.deepEqual(output.services.schoolinfo.geography, {boundary_basis: 'schoolinfo_current_query_codes',
    codes_checked_on: '2026-10-28', official_sgg_count: 47, queried_districts: 2});
  assert.equal(output.services.schoolinfo.complete, false);
  assert.match(connectionText(output.services.schoolinfo), /전체 조회 아님/);
  assert.equal(output.services.schoolinfo.completed_requests, 30);
  assert.doesNotMatch(JSON.stringify(output), /SECRET|sgg_codes/);
  assert.deepEqual(publicConnectionState(output), output);
  state.services.schoolinfo.raw_count = 30;
  state.services.schoolinfo.retrieved_count = 20;
  state.services.schoolinfo.quarantined_count = 10;
  state.services.schoolinfo.normalization_complete = false;
  const partial = publicConnectionState(state);
  assert.match(connectionText(partial.services.schoolinfo), /선택 지역 응답 30행 · 정규화 20행 · 식별 검토 보류 10행 · 전체 조회 아님/);
  assert.deepEqual(publicConnectionState(partial), partial);
  state.services.schoolinfo.last_attempt = {status: 'error', checked_at: '2026-10-28T03:00:00.000Z'};
  const failed = publicConnectionState(state).services.schoolinfo;
  assert.equal(Object.hasOwn(failed, 'geography'), false);
  assert.equal(Object.hasOwn(failed, 'completed_requests'), false);
});

test('prerequisites distinguish keys, reviewed-parcel input and population configuration', () => {
  for (const kind of ['neis', 'schoolinfo', 'firms']) {
    assert.equal(prerequisite(kind, {}), 'key_required');
    assert.equal(prerequisite(kind, {[CONNECTIONS[kind].env]: '   '}), 'key_required');
    assert.equal(prerequisite(kind, {}, {sample: true}), null);
    assert.equal(prerequisite(kind, {[CONNECTIONS[kind].env]: 'present'}), null);
  }
  assert.equal(prerequisite('buildings', {}), 'key_and_parcel_required');
  assert.equal(prerequisite('buildings', {}, {parcels: 'reviewed.json'}), 'key_required');
  assert.equal(prerequisite('buildings', {}, {sample: true}), 'key_and_parcel_required');
  assert.equal(prerequisite('buildings', {DATA_GO_KR_SERVICE_KEY: 'present'}), 'parcel_required');
  assert.equal(prerequisite('buildings', {DATA_GO_KR_SERVICE_KEY: 'present'}, {parcels: 'local.json'}), null);
  assert.equal(prerequisite('kosis', {}), 'key_and_config_required');
  assert.equal(prerequisite('kosis', {}, {config: 'reviewed.json'}), 'key_required');
  assert.equal(prerequisite('kosis', {}, {bulk: true}), 'config_required');
  assert.equal(prerequisite('kosis', {}, {bulk: true, config: 'reviewed.json'}), null);
  assert.equal(prerequisite('kosis', {KOSIS_API_KEY: 'present'}), 'config_required');
  assert.equal(prerequisite('kosis', {KOSIS_API_KEY: 'present'}, {config: 'local.json'}), null);
  assert.throws(() => prerequisite('unknown', {}));
});

test('NEIS publishes response and usable counts but never its quarantined rows or reasons', () => {
  const state = createConnectionState();
  state.school_quarantine = [{source_row: 3, reasons: ['PRIVATE-REASON'], raw: {name: 'PRIVATE-SCHOOL'}}];
  state.services.neis = {...successful, source_total: 2667, raw_count: 2667, retrieved_count: 2660,
    quarantined_count: 7, normalization_complete: false, scope_basis: 'raw_response_rows_collected',
    quarantine: state.school_quarantine};
  const result = publicConnectionState(state);
  assert.equal(result.services.neis.complete, true);
  assert.equal(result.services.neis.raw_count, 2667);
  assert.equal(result.services.neis.retrieved_count, 2660);
  assert.equal(result.services.neis.quarantined_count, 7);
  assert.equal(result.services.neis.normalization_complete, false);
  assert.equal(result.services.neis.scope_basis, 'raw_response_rows_collected');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|school_quarantine|"quarantine"|"reasons"|"raw"/);
  assert.equal(connectionText(result.services.neis), '응답 2,667행 · 정규화 2,660행 · 식별 검토 보류 7행 · 학교·사업 연결 검토 전');
});

test('NEIS sample, zero quarantine and failed refresh communicate distinct collection states', () => {
  const state = createConnectionState();
  state.services.neis = {...successful, status: 'sample_only', raw_count: 5, retrieved_count: 4,
    quarantined_count: 1, normalization_complete: false};
  const sample = publicConnectionState(state).services.neis;
  assert.equal(sample.complete, false);
  assert.equal(connectionText(sample), '시험 응답 5행 · 정규화 4행 · 식별 검토 보류 1행 · 전체 조회 아님');
  state.services.neis = {...successful, raw_count: 5, retrieved_count: 5, quarantined_count: 0, normalization_complete: true};
  const complete = publicConnectionState(state).services.neis;
  assert.equal(complete.normalization_complete, true);
  assert.match(connectionText(complete), /식별 검토 보류 0행 · 학교·사업 연결 검토 전/);
  state.services.neis.last_attempt = {status: 'error', checked_at: '2026-10-28T03:00:00.000Z'};
  const failed = publicConnectionState(state).services.neis;
  for (const field of ['raw_count', 'quarantined_count', 'normalization_complete', 'scope_basis']) assert.equal(Object.hasOwn(failed, field), false);
  assert.equal(connectionText(failed), '조회 실패 · 재확인 필요');
});

test('NEIS normalization metadata cannot assert success with quarantined rows or inconsistent counts', () => {
  const state = createConnectionState();
  state.services.neis = {...successful, raw_count: 6, retrieved_count: 5, quarantined_count: 1,
    normalization_complete: true, scope_basis: 'SECRET-UNSUPPORTED'};
  let result = publicConnectionState(state).services.neis;
  assert.equal(result.normalization_complete, false);
  assert.equal(Object.hasOwn(result, 'scope_basis'), false);
  for (const raw_count of ['6', null, -1, 5, 7]) {
    state.services.neis.raw_count = raw_count;
    result = publicConnectionState(state).services.neis;
    for (const field of ['raw_count', 'quarantined_count', 'normalization_complete']) assert.equal(Object.hasOwn(result, field), false);
  }
});

test('building status shows missing approval dates without publishing candidates or claiming age readiness', () => {
  const state = createConnectionState();
  state.building_candidates = [{name: 'PRIVATE-BUILDING'}];
  state.services.buildings = {...successful, retrieved_count: 3, queried_parcels: 2,
    approval_date_available_count: 0, approval_date_missing_count: 3, approval_dates: ['PRIVATE-DATE']};
  const output = publicConnectionState(state);
  assert.equal(output.services.buildings.approval_date_available_count, 0);
  assert.equal(output.services.buildings.approval_date_missing_count, 3);
  assert.equal(buildingCoverageText(output.services.buildings), '건물 후보 3건 · 사용승인일 제공 0건 · 미확인 3건. 사용승인일이 없어 건물 연령을 계산할 수 없습니다.');
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|building_candidates|approval_dates/);
  assert.deepEqual(publicConnectionState(output), output);
  state.services.buildings.approval_date_available_count = 1;
  state.services.buildings.approval_date_missing_count = 2;
  assert.match(buildingCoverageText(publicConnectionState(state).services.buildings), /사용승인일 제공 1건 · 미확인 2건.*동일성을 확인한 뒤/);
  state.services.buildings = {...successful, retrieved_count: 0, approval_date_available_count: 0, approval_date_missing_count: 0};
  assert.match(buildingCoverageText(publicConnectionState(state).services.buildings), /학교 전체의 건물 수를 뜻하지 않습니다/);
});

test('building coverage excludes inconsistent or stale counts and cannot leak through other providers', () => {
  const state = createConnectionState();
  for (const available of [undefined, null, '0', -1, 4, 0.5]) {
    state.services.buildings = {...successful, retrieved_count: 3, approval_date_available_count: available, approval_date_missing_count: 3};
    const output = publicConnectionState(state).services.buildings;
    assert.equal(Object.hasOwn(output, 'approval_date_available_count'), false);
    assert.equal(Object.hasOwn(output, 'approval_date_missing_count'), false);
    assert.equal(buildingCoverageText(output), null);
  }
  state.services.buildings = {...successful, retrieved_count: 3, approval_date_available_count: 0, approval_date_missing_count: 3,
    last_attempt: {status: 'error', checked_at: '2026-10-28T03:00:00.000Z'}};
  const failed = publicConnectionState(state).services.buildings;
  assert.equal(failed.status, 'error');
  assert.equal(Object.hasOwn(failed, 'approval_date_available_count'), false);
  assert.equal(buildingCoverageText(failed), null);
  state.services.neis = {...successful, approval_date_available_count: 0, approval_date_missing_count: 5};
  assert.equal(Object.hasOwn(publicConnectionState(state).services.neis, 'approval_date_available_count'), false);
});
