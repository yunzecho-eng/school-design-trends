import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNeisSchool, parseNeisResponse, fetchNeisSchools, matchNeisSchools} from '../../src/integrations/neis.js';

const school = (code = '7652009', name = '가곡초등학교') => ({
  ATPT_OFCDC_SC_CODE: 'J10', ATPT_OFCDC_SC_NM: '경기도교육청', SD_SCHUL_CODE: code, SCHUL_NM: name,
  SCHUL_KND_SC_NM: '초등학교', LCTN_SC_NM: '경기도', FOND_SC_NM: '공립', ORG_RDNZC: '12032 ',
  ORG_RDNMA: '경기도 남양주시 화도읍 비룡로379번길 3', ORG_RDNDA: '(화도읍, 가곡초등학교)',
  HMPG_ADRES: 'https://gagok-e.goegn.kr', FOND_YMD: '19691205', FOAS_MEMRD: '19691205', LOAD_DTM: '20260423',
});
const payload = (rows, total = rows.length) => ({schoolInfo: [{head: [{list_total_count: total}, {RESULT: {CODE: 'INFO-000'}}]}, {row: rows}]});
const response = p => ({ok: true, json: async () => p});

test('NEIS retains a source-qualified string ID and keeps school dates separate from building age', () => {
  const row = normalizeNeisSchool(school());
  assert.equal(row.official_school_id, 'neis:J10:7652009');
  assert.equal(row.school_code, '7652009');
  assert.equal(row.school_level, 'elementary');
  assert.equal(row.postal_code, '12032');
  assert.equal(row.establishment_date, '1969-12-05');
  assert.equal(row.opening_anniversary_date, '1969-12-05');
  assert.equal(row.data_as_of, '2026-04-23');
  assert.match(row.data_as_of_basis, /포털 연계일/);
  assert.equal(row.verified, false);
  assert.equal(Object.hasOwn(row, 'completion_date'), false);
  assert.equal(Object.hasOwn(row, 'building_age'), false);
  assert.throws(() => normalizeNeisSchool({...school(), ATPT_OFCDC_SC_CODE: 'B10'}));
  assert.throws(() => normalizeNeisSchool({...school(), SD_SCHUL_CODE: 7652009}));
});

test('missing or invalid dates remain missing, unsafe homepage links do not pass through', () => {
  const row = normalizeNeisSchool({...school(), FOND_YMD: '20230229', FOAS_MEMRD: null, LOAD_DTM: '', ORG_RDNMA: null, HMPG_ADRES: 'javascript:alert(1)'});
  assert.equal(row.establishment_date, null);
  assert.equal(row.opening_anniversary_date, null);
  assert.equal(row.data_as_of, null);
  assert.equal(row.road_address, null);
  assert.equal(row.official_url, null);
  assert.deepEqual(row.date_issues, ['FOND_YMD: 날짜 형식 확인 필요']);
  assert.equal(normalizeNeisSchool({...school(), FOND_YMD: '20240229'}).establishment_date, '2024-02-29');
  assert.equal(normalizeNeisSchool({...school(), HMPG_ADRES: 'https://user:secret@example.com'}).official_url, null);
});

test('NEIS service errors and malformed schemas fail, only INFO-200 means no rows', () => {
  assert.deepEqual(parseNeisResponse({RESULT: {CODE: 'INFO-200'}}), {total: 0, rows: []});
  assert.throws(() => parseNeisResponse({RESULT: {CODE: 'ERROR-290', MESSAGE: 'secret'}}), /응답 오류/);
  for (const total of [undefined, null, '', ' ', true, false, [], {}, -1, 0.5, NaN, Infinity, '1e3']) {
    const p = payload([]); p.schoolInfo[0].head[0].list_total_count = total;
    assert.throws(() => parseNeisResponse(p));
  }
  for (const rows of [null, {}, [null], [[]]]) {
    const p = payload([]); p.schoolInfo[1].row = rows;
    assert.throws(() => parseNeisResponse(p));
  }
});

test('sample mode makes one keyless request and never claims complete coverage', async () => {
  const urls = [];
  const result = await fetchNeisSchools({sample: true, key: 'SECRET', fetchImpl: async (url, options) => {
    urls.push(url); assert.ok(options.signal); assert.equal(options.redirect, 'error');
    return response(payload([school()], 2667));
  }});
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get('ATPT_OFCDC_SC_CODE'), 'J10');
  assert.equal(urls[0].searchParams.get('pSize'), '5');
  assert.equal(urls[0].searchParams.has('KEY'), false);
  assert.equal(result.scope, 'sample_only');
  assert.equal(result.rows.length, 1);
  assert.equal(result.total, 2667);
});

test('full mode follows pages until the declared total is reached with unique IDs', async () => {
  const pages = [];
  const result = await fetchNeisSchools({key: 'a+b/=', fetchImpl: async url => {
    assert.equal(url.searchParams.get('KEY'), 'a+b/=');
    const page = Number(url.searchParams.get('pIndex')); pages.push(page);
    return response(payload([school(String(7652008 + page))], 2));
  }});
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.scope, 'complete');
  assert.equal(result.rows.length, 2);
});

test('changing totals, overlapping pages, truncated lists and page bounds fail closed', async () => {
  let calls = 0;
  await assert.rejects(fetchNeisSchools({key: 'KEY', fetchImpl: async () => response(payload([school()], ++calls === 1 ? 2 : 3))}), /총건수/);
  await assert.rejects(fetchNeisSchools({key: 'KEY', fetchImpl: async () => response(payload([school()], 2))}), /코드가 반복/);
  calls = 0;
  await assert.rejects(fetchNeisSchools({key: 'KEY', fetchImpl: async () => response(payload(++calls === 1 ? [school()] : [], 2))}), /응답이 비었/);
  await assert.rejects(fetchNeisSchools({key: 'KEY', maxPages: 1, fetchImpl: async () => response(payload([school()], 2))}), /안전 페이지/);
  await assert.rejects(fetchNeisSchools({sample: true, fetchImpl: async () => response(payload([school()], 0))}), /총건수/);
});

test('missing keys make no request and network, HTTP, service, parsing errors do not expose secrets', async () => {
  let calls = 0;
  const failingFetch = async () => { calls++; throw new Error('SECRET https://host?KEY=SECRET'); };
  for (const key of [undefined, '', ' ', 'sample']) {
    await assert.rejects(fetchNeisSchools({key, fetchImpl: failingFetch}), /NEIS_API_KEY/);
  }
  assert.equal(calls, 0);
  for (const fetchImpl of [failingFetch,
    async () => ({ok: false, status: 401, statusText: 'SECRET'}),
    async () => response({RESULT: {CODE: 'ERROR-290', MESSAGE: 'SECRET'}}),
    async () => ({ok: true, json: async () => {throw new Error('SECRET');}})]) {
    await assert.rejects(fetchNeisSchools({key: 'SECRET', fetchImpl}), error => !/SECRET|https:/.test(error.message));
  }
});

test('exact name matches remain candidates, ambiguity and sample absence remain explicit', () => {
  const projects = [{project_id: 'a', title: '가곡 초등학교'}, {project_id: 'b', title: '가곡초등학교 신축'}, {project_id: 'c', title: '가칭 가곡초등학교'}];
  const source = [normalizeNeisSchool(school()), normalizeNeisSchool(school('7652010'))];
  const before = JSON.stringify({projects, source});
  const result = matchNeisSchools(projects, source, {scope: 'sample_only'});
  assert.equal(result[0].match_status, 'ambiguous');
  assert.equal(result[0].verified, false);
  assert.equal(result[1].match_status, 'not_searched');
  assert.equal(result[2].candidates.length, 0);
  assert.equal(matchNeisSchools(projects, [source[0]])[0].match_status, 'candidate');
  assert.equal(matchNeisSchools(projects, [source[0]])[1].match_status, 'not_found');
  assert.equal(JSON.stringify({projects, source}), before);
});
