import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSchoolInfo, normalizeSchoolInfo, parseSchoolInfoResponse, SCHOOLINFO_SOURCE} from '../../src/integrations/schoolinfo.js';

// Fixtures use the documented fields and shapes observed from the official
// apiKey=sample endpoint. Names/codes below are synthetic, not reviewed matches.
const base = (kind = '02') => ({SCHUL_CODE: `S0900000${kind}`, SCHUL_NM: '검증용학교', SCHUL_KND_SC_CODE: kind,
  ADRCD_CD: '4111110100', ADRCD_NM: '경기도 수원시 장안구', ATPT_OFCDC_ORG_CODE: 'J100000001',
  ATPT_OFCDC_ORG_NM: '경기도교육청', PBAN_EXCP_YN: 'N'});
const response = list => ({ok: true, json: async () => ({resultCode: 'success', resultMsg: '성공', list})});

test('기본정보의 공식코드·주소·개교일은 원래 의미를 보존하고 건물 연령을 만들지 않는다', () => {
  const result = normalizeSchoolInfo({...base(), ADRCD_ID: '4111110100', FOND_YMD: '19530113', FOAS_MEMRD: '19530415',
    LTTUD: 37.3, LGTUD: 127.1, SCHUL_RDNMA: '경기도 수원시 검증로 1', SCHUL_RDNDA: '본교',
    HMPG_ADRES: 'https://example.org/school', ABSCH_YN: 'Y', ABSCH_YMD: '20260301', CLOSE_YN: 'N', BNHH_YN: 'N'},
  {apiType: '0', year: 2025, schoolKind: '02'});
  assert.equal(result.official_school_id, 'schoolinfo:S090000002');
  assert.equal(result.disclosure_year, null);
  assert.equal(result.establishment_date, '1953-01-13');
  assert.equal(result.opening_anniversary, '1953-04-15');
  assert.equal(result.closure_date, '2026-03-01');
  assert.equal(result.is_closed, true);
  assert.equal(result.verified, false);
  assert.equal(result.source_id, SCHOOLINFO_SOURCE.id);
  assert.equal(result.completion_date, undefined);
  assert.equal(result.age, undefined);
});

test('잘못된 날짜·좌표와 실행 URL은 결측으로 보존한다', () => {
  const row = normalizeSchoolInfo({...base(), FOND_YMD: '20250229', FOAS_MEMRD: '        ',
    LTTUD: '', LGTUD: false, HMPG_ADRES: 'javascript:alert(1)'}, {apiType: '0'});
  assert.equal(row.establishment_date, null);
  assert.equal(row.opening_anniversary, null);
  assert.equal(row.latitude, null);
  assert.equal(row.longitude, null);
  assert.equal(row.website, null);
});

test('학생수 총계의 괄호는 포함된 수이며 가산하지 않는다', () => {
  const row = normalizeSchoolInfo({...base(), COL_FGR_SUM: '1,052(5)', COL_SUM: '7(1)', AVG_FGR_SUM: 7.4}, {apiType: '62', year: 2025});
  assert.equal(row.disclosure_year, 2025);
  assert.deepEqual(row.metrics[0], {field: 'COL_FGR_SUM', label: '학생수계', unit: '명', raw: '1,052(5)', value: 1052, status: 'reported', included_special_itinerant: 5});
  assert.equal(row.metrics[1].value, 7);
  assert.equal(row.metrics[2].value, 7.4);
  assert.equal(row.metrics[3].value, null);
  assert.equal(row.metrics[3].status, 'missing');
});

test('빈값·0·해석불가·공시제외를 각각 구분한다', () => {
  const row = normalizeSchoolInfo({...base(), COL_1: 0, COL_2: '', COSE_CNSRM_FGR: '미공시'}, {apiType: '18', year: 2025});
  assert.equal(row.metrics[0].value, 0);
  assert.equal(row.metrics[0].status, 'reported');
  assert.equal(row.metrics[1].value, null);
  assert.equal(row.metrics[1].status, 'missing');
  assert.equal(row.metrics[4].status, 'unparsed');
  const excluded = normalizeSchoolInfo({...base(), PBAN_EXCP_YN: 'Y', PBAN_EXCP_RSN: '교육통계 자료 없음', COL_1: 10}, {apiType: '17', year: 2025});
  assert.equal(excluded.metrics[0].raw, 10);
  assert.equal(excluded.metrics[0].value, null);
  assert.equal(excluded.metrics[0].status, 'excluded');
  assert.equal(excluded.exclusion_reason, '교육통계 자료 없음');
  for (const invalid of ['12,34', '3(4)', '1e3', '-1', true]) {
    const metric = normalizeSchoolInfo({...base(), COL_FGR_SUM: invalid}, {apiType: '62', year: 2025}).metrics[0];
    assert.equal(metric.value, null);
  }
});

test('시설개방은 미개방과 시설없음, 자료없음을 분리한다', () => {
  const row = normalizeSchoolInfo({...base(), COL_1: '유', COL_3: '무', COL_5: '시설없음', COL_7: 'O', COL_9: 'X'}, {apiType: '20', year: 2025});
  assert.deepEqual(row.facility_opening.map(item => item.state), ['open', 'closed', 'absent', 'open', 'closed', 'unknown']);
});

test('경기 초중고와 선택한 공시항목만 요청하고 인증값을 결과에 남기지 않는다', async () => {
  const requests = [];
  const result = await fetchSchoolInfo({key: 'synthetic-secret-key', year: 2025, apiTypes: ['0', '62', '17', '18', '20'], fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(url.searchParams.get('sidoCode'), '41');
    assert.equal(url.searchParams.get('apiKey'), 'synthetic-secret-key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const type = url.searchParams.get('apiType');
    assert.equal(url.searchParams.get('pbanYr'), type === '0' ? null : '2025');
    return response([base(url.searchParams.get('schulKndCode'))]);
  }});
  assert.equal(requests.length, 15);
  assert.equal(result.scope, 'complete');
  assert.equal(result.total, 15);
  assert.equal(result.source_total, null);
  assert.equal(result.queries.length, 15);
  assert.equal(JSON.stringify(result).includes('synthetic-secret-key'), false);
});

test('공식 sample은 표본으로 표시하며 입력한 실키를 전송하지 않는다', async () => {
  const result = await fetchSchoolInfo({sample: true, key: 'do-not-send', fetchImpl: async url => {
    assert.equal(url.searchParams.get('apiKey'), 'sample');
    return response([base(url.searchParams.get('schulKndCode'))]);
  }});
  assert.equal(result.scope, 'sample_only');
  assert.equal(result.total, 3);
  assert.match(result.limitations[0], /표본/);
});

test('잘못된 키·연도·항목 설정은 호출 전에 거절한다', async () => {
  const fetchImpl = () => assert.fail('설정 오류는 API를 호출하지 않아야 합니다.');
  for (const config of [{}, {key: 'sample'}, {key: 'x', apiTypes: ['17']}, {key: 'x', year: '2025x', apiTypes: ['17']}, {key: 'x', apiTypes: ['0', '0']}, {key: 'x', apiTypes: ['999']}, {sample: 'true'}]) {
    await assert.rejects(fetchSchoolInfo({...config, fetchImpl}));
  }
});

test('서버·네트워크·JSON 오류에 포함된 인증 URL을 출력하지 않는다', async () => {
  const secret = 'never-print-this-token';
  for (const fetchImpl of [async () => { throw new Error(`https://example.org?apiKey=${secret}`); },
    async () => ({ok: false, status: 500}),
    async () => ({ok: true, json: async () => { throw new Error(secret); }}),
    async () => ({ok: true, json: async () => ({resultCode: 'fail', resultMsg: secret})})]) {
    await assert.rejects(fetchSchoolInfo({key: secret, fetchImpl}), error => !String(error).includes(secret) && /학교알리미/.test(error.message));
  }
  assert.throws(() => parseSchoolInfoResponse({resultCode: 'success', list: null}), /list/);
});

test('지역·학교급이 다른 응답과 중복 학교는 전체 조회 성공으로 처리하지 않는다', async () => {
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([{...base(), ADRCD_CD: '1111010100'}])}), /지역·학교급/);
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([base('03')])}), /지역·학교급/);
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([base(), base()])}), /중복/);
});
