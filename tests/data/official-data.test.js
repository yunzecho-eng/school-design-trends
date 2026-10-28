import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFirmName, normalizeOfficialFirm, matchOfficialFirms, parseGgFirmResponse, parseBuildingResponse,
  validateParcel, normalizeOfficialBuilding, buildingDateCoverage, fetchOfficialFirms, fetchOfficialBuildings} from '../../src/integrations/official-data.js';

const office = (name = '(주)예시건축사사무소', code = '41110') => ({OFC_NM: name, SIGUN_CD: code, SIGUN_NM: '수원시', REFINE_ROADNM_ADDR: '경기도 수원시 예시로 1', DATA_STD_DE: null});
const gg = (rows, total = rows.length) => ({Buildofc: [{head: [{list_total_count: total}, {RESULT: {CODE: 'INFO-000'}}]}, {row: rows}]});
const response = payload => ({ok: true, json: async () => payload});
const parcel = {school_id: 's1', sigunguCd: '41111', bjdongCd: '10100', platGbCd: '0', bun: '0012', ji: '0000'};
const building = () => ({...parcel, mgmBldrgstPk: 'PK-1', useAprDay: '19861019', dongNm: '본관'});
const hub = (rows, total = rows.length) => ({response: {header: {resultCode: '00'}, body: {totalCount: total, items: rows.length ? {item: rows} : ''}}});

test('official firm normalization preserves missing metadata and never infers a business number', () => {
  const result = normalizeOfficialFirm({...office(), STATMNT_DIV: '법인', REFINE_WGS84_LAT: '', REFINE_WGS84_LOGT: 'invalid', BUSINESS_NO: 'untrusted'});
  assert.equal(result.business_registration_number, null);
  assert.equal(result.official_url, null);
  assert.equal(result.data_as_of, null);
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
  assert.throws(() => normalizeOfficialFirm(office('서울사무소', '11680')));
});

test('candidate matching only normalizes corporate markers and spacing, with ambiguity retained', () => {
  assert.equal(normalizeFirmName('㈜ 예시 건축사사무소'), normalizeFirmName('주식회사예시건축사사무소'));
  const a = normalizeOfficialFirm(office());
  const b = {...a, road_address: '경기도 성남시 다른로 2'};
  const firms = [{firm_id: 'one', name: '예시 건축사사무소'}, {firm_id: 'short', name: '예시'}, {firm_id: 'alias', name: '다른 이름', aliases: ['(주)예시건축사사무소']}];
  const original = JSON.stringify(firms);
  const result = matchOfficialFirms(firms, [a, {...a}, b]);
  assert.equal(result[0].match_status, 'ambiguous');
  assert.equal(result[0].candidates.length, 2);
  assert.equal(result[1].match_status, 'not_found');
  assert.equal(result[2].verified, false);
  assert.equal(JSON.stringify(firms), original);
  assert.equal(matchOfficialFirms(firms, [a])[0].match_status, 'candidate');
});

test('service errors and malformed counts fail instead of reporting an empty dataset', () => {
  assert.throws(() => parseGgFirmResponse({RESULT: {CODE: 'ERROR-290', MESSAGE: 'secret-url'}}), /응답 오류/);
  assert.throws(() => parseGgFirmResponse(gg([], -1)));
  assert.deepEqual(parseGgFirmResponse({RESULT: {CODE: 'INFO-200'}}), {total: 0, rows: []});
  assert.throws(() => parseBuildingResponse({response: {header: {resultCode: '30'}}}));
  assert.deepEqual(parseBuildingResponse(hub([])), {total: 0, rows: []});
});

test('null, blank and coercible nonnumeric totals never become complete empty data', () => {
  for (const invalid of [null, undefined, '', ' ', false, true, [], {}, NaN, Infinity, -1, 0.5, '1e3', '1.0']) {
    const ggPayload = gg([]);
    ggPayload.Buildofc[0].head[0].list_total_count = invalid;
    const hubPayload = hub([]);
    hubPayload.response.body.totalCount = invalid;
    assert.throws(() => parseGgFirmResponse(ggPayload), /건수·행 형식/);
    assert.throws(() => parseBuildingResponse(hubPayload), /건수·행 형식/);
  }
  for (const zero of [0, '0', ' 0 ']) {
    assert.deepEqual(parseGgFirmResponse(gg([], zero)), {total: 0, rows: []});
    assert.deepEqual(parseBuildingResponse(hub([], zero)), {total: 0, rows: []});
  }
});

test('missing keys make no request; errors never echo a secret or remote response', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('SECRET'); };
  await assert.rejects(fetchOfficialFirms({fetchImpl}), /GG_OPEN_API_KEY/);
  await assert.rejects(fetchOfficialBuildings({parcels: [parcel], fetchImpl}), /DATA_GO_KR_SERVICE_KEY/);
  assert.equal(calls, 0);
  await assert.rejects(fetchOfficialFirms({key: 'SECRET', fetchImpl}), error => !error.message.includes('SECRET'));
  await assert.rejects(fetchOfficialFirms({key: 'SECRET', fetchImpl: async () => ({ok: false, status: 401})}), /401/);
});

test('sample requests stop at the first five records and are never complete', async () => {
  const urls = [];
  const result = await fetchOfficialFirms({sample: true, fetchImpl: async url => { urls.push(url); return response(gg([office()], 3421)); }});
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.has('KEY'), false);
  assert.equal(result.scope, 'sample_only');
  assert.equal(result.total, 3421);
});

test('full office pagination completes only when its row count equals total', async () => {
  const pages = [gg([office()], 2), gg([office('다른 사무소')], 2)];
  const result = await fetchOfficialFirms({key: 'test', fetchImpl: async () => response(pages.shift())});
  assert.equal(result.scope, 'complete');
  assert.equal(result.rows.length, 2);
  await assert.rejects(fetchOfficialFirms({key: 'test', fetchImpl: async () => response(gg([office()], 2))}), /반복/);
  const changed = [gg([office()], 2), gg([office('다른 사무소')], 3)];
  await assert.rejects(fetchOfficialFirms({key: 'test', fetchImpl: async () => response(changed.shift())}), /총건수/);
});

test('office collection rejects reordered whole pages but quarantines every member of individual duplicate groups', async () => {
  const a = {...office('A'), metadata: {left: 1, right: {one: 1, two: 2}}};
  const aReordered = {metadata: {right: {two: 2, one: 1}, left: 1}, ...Object.fromEntries(Object.entries(office('A')).reverse())};
  const b = office('B'), c = office('C');
  const repeated = [gg([a, b], 4), gg([b, aReordered], 4)];
  await assert.rejects(fetchOfficialFirms({key: 'test', fetchImpl: async () => response(repeated.shift())}), /반복/);
  const overlapping = [gg([a, b], 4), gg([aReordered, c], 4)];
  const result = await fetchOfficialFirms({key: 'test', fetchImpl: async () => response(overlapping.shift())});
  assert.equal(result.scope, 'complete');
  assert.equal(result.scope_basis, 'raw_response_rows_collected');
  assert.equal(result.total, 4);
  assert.equal(result.raw_count, 4);
  assert.equal(result.rows.length, 2);
  assert.equal(result.quarantined_count, 2);
  assert.equal(result.normalization_complete, false);
  assert.deepEqual(result.rows.map(row => row.name), ['B', 'C']);
  assert.deepEqual(result.quarantine.map(row => row.raw), [a, aReordered]);
  assert.deepEqual(result.quarantine.map(row => [row.source_row, row.source_page, row.row_in_page]), [[1, 1, 1], [3, 2, 1]]);
  assert.ok(result.quarantine.every(row => row.reasons.includes('duplicate_raw_record') && !Object.hasOwn(row, 'fingerprint')));
  for (const sample of [false, true]) {
    const duplicate = await fetchOfficialFirms({key: 'test', sample, fetchImpl: async () => response(gg([a, aReordered], sample ? 3421 : 2))});
    assert.equal(duplicate.scope, sample ? 'sample_only' : 'complete');
    assert.equal(duplicate.raw_count, 2);
    assert.equal(duplicate.quarantined_count, 2);
    assert.equal(duplicate.rows.length, 0);
    assert.equal(duplicate.normalization_complete, false);
    assert.deepEqual(duplicate.quarantine.map(row => row.raw), [a, aReordered]);
  }
  // Distinct addresses for the same office name must remain distinct candidates.
  const sameName = [{...office('A'), REFINE_ROADNM_ADDR: '경기도 수원시 1'}, {...office('A'), REFINE_ROADNM_ADDR: '경기도 수원시 2'}];
  const distinct = await fetchOfficialFirms({key: 'test', fetchImpl: async () => response(gg(sameName))});
  assert.equal(distinct.scope, 'complete');
  assert.equal(distinct.normalization_complete, true);
  assert.equal(distinct.raw_count, 2);
  assert.equal(distinct.quarantined_count, 0);
  assert.deepEqual(distinct.quarantine, []);
  assert.equal(matchOfficialFirms([{firm_id: 'a', name: 'A'}], distinct.rows)[0].match_status, 'ambiguous');
});

test('firm raw collection never uses quarantine to conceal malformed unique source rows', async () => {
  for (const invalid of [office('', '41110'), office('Invalid', '11680')]) {
    await assert.rejects(fetchOfficialFirms({key: 'test', fetchImpl: async () => response(gg([office(), {...office()}, invalid]))}), /OFC_NM|시군코드/);
  }
});

test('sample scope cannot hide inconsistent totals or an empty nonempty source', async () => {
  for (const sample of [true, false]) {
    await assert.rejects(fetchOfficialFirms({key: 'test', sample, fetchImpl: async () => response(gg([office()], 0))}), /총건수/);
    await assert.rejects(fetchOfficialFirms({key: 'test', sample, fetchImpl: async () => response(gg([], 2))}), /총건수/);
    const empty = await fetchOfficialFirms({key: 'test', sample, fetchImpl: async () => response(gg([], 0))});
    assert.equal(empty.scope, sample ? 'sample_only' : 'complete');
    assert.equal(empty.rows.length, 0);
  }
});

test('official authenticated requests reject redirects and sanitize key-bearing transport and JSON failures', async () => {
  const secret = 'SECRET-KEY-FOR-MOCK';
  for (const operation of [
    fetchImpl => fetchOfficialFirms({key: secret, fetchImpl}),
    fetchImpl => fetchOfficialBuildings({key: secret, parcels: [parcel], fetchImpl}),
  ]) {
    for (const failure of ['transport', 'json']) {
      await assert.rejects(operation(async (url, options) => {
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal);
        if (failure === 'transport') throw new Error(`Redirected private URL: ${url.href}`);
        return {ok: true, json: async () => { throw new Error(`Invalid private payload ${secret}`); }};
      }), error => !error.message.includes(secret) && !error.message.includes('https://'));
    }
  }
});

test('building queries require an exact Gyeonggi parcel rather than a school-name guess', () => {
  assert.deepEqual(validateParcel(parcel), parcel);
  assert.throws(() => validateParcel({...parcel, sigunguCd: '11680'}));
  assert.throws(() => validateParcel({...parcel, bun: '12'}));
  assert.throws(() => normalizeOfficialBuilding({...building(), bun: '0013'}, parcel, '2026-10-19T00:00:00Z'), /필지/);
});

test('building age input uses approval date only and retains unknown, invalid and future dates', () => {
  const valid = normalizeOfficialBuilding(building(), parcel, '2026-10-19T00:00:00Z');
  assert.equal(valid.use_approval_date, '1986-10-19');
  assert.equal(valid.match_status, 'parcel_candidate');
  assert.equal(valid.verified, false);
  for (const useAprDay of ['', '19860230', '20271019', '00010101']) {
    const result = normalizeOfficialBuilding({...building(), useAprDay, FOND_YMD: '19600101'}, parcel, '2026-10-19T00:00:00Z');
    assert.equal(result.use_approval_date, null);
    assert.ok(result.date_issue);
  }
});

test('building date coverage counts valid useAprDay only and never substitutes opening or creation dates', () => {
  const records = ['19861019', '', '19860230', '20271019'].map((useAprDay, index) => normalizeOfficialBuilding({
    ...building(), mgmBldrgstPk: `PK-${index}`, useAprDay, FOND_YMD: '19200401', crtnDay: '20220909',
  }, parcel, '2026-10-28T00:00:00Z'));
  assert.deepEqual(buildingDateCoverage(records), {approval_date_available_count: 1, approval_date_missing_count: 3});
  assert.deepEqual(buildingDateCoverage(records.slice(1)), {approval_date_available_count: 0, approval_date_missing_count: 3});
  assert.deepEqual(buildingDateCoverage([]), {approval_date_available_count: 0, approval_date_missing_count: 0});
  assert.deepEqual(buildingDateCoverage([{...records[0], date_basis: 'FOND_YMD'}, {...records[0], date_issue: '검토 필요'}]),
    {approval_date_available_count: 0, approval_date_missing_count: 2});
  assert.ok(records.every(row => row.verified === false && row.match_status === 'parcel_candidate'));
});

test('building fetch preserves distinct wings and rejects paging duplication', async () => {
  const rows = await fetchOfficialBuildings({key: 'test', parcels: [parcel], retrievedAt: '2026-10-19T00:00:00Z',
    fetchImpl: async url => {assert.equal(url.searchParams.get('bun'), '0012'); return response(hub([building(), {...building(), mgmBldrgstPk: 'PK-2', dongNm: '체육관'}])); }});
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].official_building_id, rows[1].official_building_id);
  await assert.rejects(fetchOfficialBuildings({key: 'test', parcels: [parcel], fetchImpl: async () => response(hub([building()], 2))}), /반복/);
});
