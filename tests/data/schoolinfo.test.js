import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSchoolInfo, normalizeSchoolInfo, parseSchoolInfoResponse, SCHOOLINFO_SOURCE, SCHOOLINFO_SGG_CODES, SCHOOLINFO_GYEONGGI_DISTRICTS} from '../../src/integrations/schoolinfo.js';

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
  const result = await fetchSchoolInfo({key: 'synthetic-secret-key', year: 2025, requestIntervalMs: 0, apiTypes: ['0', '62', '17', '18', '20'], fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(url.searchParams.get('sidoCode'), '41');
    assert.equal(url.searchParams.get('apiKey'), 'synthetic-secret-key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const type = url.searchParams.get('apiType');
    const sgg = url.searchParams.get('sggCode');
    assert.ok(SCHOOLINFO_SGG_CODES.includes(sgg));
    assert.equal(url.searchParams.get('pbanYr'), type === '0' ? null : '2025');
    const kind = url.searchParams.get('schulKndCode');
    return response([{...base(kind), SCHUL_CODE: `S${sgg}${kind}`, ADRCD_CD: `${sgg}10100`}]);
  }});
  assert.equal(requests.length, 705);
  assert.equal(result.scope, 'complete');
  assert.equal(result.total, 705);
  assert.equal(result.source_total, null);
  assert.equal(result.queries.length, 705);
  assert.equal(result.completed_requests, result.planned_requests);
  assert.equal(result.geography.sgg_codes.length, 47);
  assert.equal(result.geography.boundary_basis, 'schoolinfo_current_query_codes');
  assert.equal(JSON.stringify(result).includes('synthetic-secret-key'), false);
});

test('공식 sample은 표본으로 표시하며 입력한 실키를 전송하지 않는다', async () => {
  const result = await fetchSchoolInfo({sample: true, key: 'do-not-send', requestIntervalMs: 0, fetchImpl: async url => {
    assert.equal(url.searchParams.get('apiKey'), 'sample');
    assert.equal(url.searchParams.get('sggCode'), '41111');
    return response([base(url.searchParams.get('schulKndCode'))]);
  }});
  assert.equal(result.scope, 'sample_only');
  assert.equal(result.total, 3);
  assert.deepEqual(result.geography.sgg_codes, ['41111']);
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

test('지역이 다른 응답과 중복 학교는 전체 조회 성공으로 처리하지 않는다', async () => {
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([{...base(), ADRCD_CD: '1111010100'}])}), /지역/);
  assert.throws(() => normalizeSchoolInfo(base('03'), {apiType: '0', schoolKind: '02'}), /학교급/);
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([base(), base()])}), /중복/);
});

test('공식 말단47코드는 부모도시·옛화성과 겹치지 않고 현재 화성4구를 포함한다', () => {
  assert.equal(SCHOOLINFO_SGG_CODES.length, 47);
  assert.equal(new Set(SCHOOLINFO_SGG_CODES).size, 47);
  for (const code of ['41110', '41130', '41170', '41190', '41270', '41280', '41460', '41590']) assert.equal(SCHOOLINFO_SGG_CODES.includes(code), false);
  assert.deepEqual(SCHOOLINFO_GYEONGGI_DISTRICTS.filter(region => region.name.startsWith('화성시')).map(region => region.code), ['41591', '41593', '41595', '41597']);
});

test('선택한 시군구만 조회하면 경기 전체 완료가 아니라 subset_only다', async () => {
  const result = await fetchSchoolInfo({key: 'synthetic', sggCodes: ['41111'], requestIntervalMs: 0, fetchImpl: async url => response([base(url.searchParams.get('schulKndCode'))])});
  assert.equal(result.scope, 'subset_only');
  assert.equal(result.planned_requests, 3);
  assert.equal(result.completed_requests, 3);
  assert.deepEqual(result.geography.sgg_codes, ['41111']);
  assert.equal(result.rows[0].requested_sgg_code, '41111');
});

test('잘못된 코드·부모구역·요청량 설정은 호출 전 거절한다', async () => {
  const fetchImpl = () => assert.fail('검증 전에 호출하지 않아야 합니다.');
  for (const config of [{sggCodes: []}, {sggCodes: ['41111', '41111']}, {sggCodes: ['41590']}, {sggCodes: ['11110']},
    {sggCodes: ['00000']}, {maxRequests: 1}, {maxRequests: 706}, {requestIntervalMs: -1}, {requestIntervalMs: 1.5}]) {
    await assert.rejects(fetchSchoolInfo({key: 'synthetic', ...config, fetchImpl}));
  }
});

test('시군구 필터가 무시되거나 과거 코드가 반환되면 조회 완료로 처리하지 않는다', async () => {
  await assert.rejects(fetchSchoolInfo({sample: true, sggCodes: ['41591'], fetchImpl: async () => response([{...base(), ADRCD_CD: '4159025933'}])}), /시군구/);
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([{...base(), ADRCD_CD: undefined}])}), /시군구/);
});

test('중간 요청 실패와 시군구 간 중복은 부분결과를 반환하지 않는다', async () => {
  let calls = 0;
  await assert.rejects(fetchSchoolInfo({key: 'synthetic', requestIntervalMs: 0, sggCodes: ['41111', '41113'], fetchImpl: async () => {
    if (++calls === 2) return {ok: false};
    return response([base()]);
  }}), /HTTP/);
  assert.equal(calls, 2);
  await assert.rejects(fetchSchoolInfo({key: 'synthetic', requestIntervalMs: 0, sggCodes: ['41111', '41113'], fetchImpl: async url => response([
    {...base(), ADRCD_CD: `${url.searchParams.get('sggCode')}10100`},
  ])}), /중복/);
});

test('공식 빈 결과 메시지는 no_data로 남기고 다른 fail은 성공으로 바꾸지 않는다', async () => {
  const noData = {resultCode: 'fail', resultMsg: '해당 시도 및 시군구에 데이터가 존재하지 않습니다.'};
  assert.deepEqual(parseSchoolInfoResponse(noData), []);
  assert.throws(() => parseSchoolInfoResponse({...noData, list: [base()]}));
  assert.throws(() => parseSchoolInfoResponse({...noData, resultMsg: '인증키가 유효하지 않습니다.'}));
  assert.throws(() => parseSchoolInfoResponse({...noData, resultMsg: `${noData.resultMsg} apiKey=secret`}));
  const result = await fetchSchoolInfo({key: 'synthetic', requestIntervalMs: 0, sggCodes: ['41290'], fetchImpl: async () => ({ok: true, json: async () => noData})});
  assert.equal(result.total, 0);
  assert.equal(result.scope, 'subset_only');
  assert.equal(result.queries.length, 3);
  assert.ok(result.queries.every(query => query.data_status === 'no_data'));
});

test('방송통신중학교 kind25를 일반 중학교로 바꾸지 않고 격리·대조 건수를 보존한다', async () => {
  const broadcast = {...base('25'), SCHUL_CODE: 'S_SYNTHETIC_BROADCAST', SCHUL_NM: '검증용중학교부설방송통신중학교', COL_FGR_SUM: '100'};
  const result = await fetchSchoolInfo({key: 'synthetic', apiTypes: ['62'], year: 2025, sggCodes: ['41111'], requestIntervalMs: 0,
    fetchImpl: async url => {
      const kind = url.searchParams.get('schulKndCode');
      return response(kind === '03' ? [base(kind), broadcast] : [base(kind)]);
    }});
  assert.equal(result.raw_count, 4);
  assert.equal(result.usable_count, 3);
  assert.equal(result.quarantined_count, 1);
  assert.equal(result.raw_count, result.rows.length + result.quarantine.length);
  assert.equal(result.total, result.rows.length);
  assert.equal(result.normalization_complete, false);
  assert.equal(result.collection_complete, true);
  assert.equal(result.scope, 'subset_only');
  assert.equal(result.scope_basis, 'raw_response_rows_collected');
  assert.equal(result.quarantine[0].reason, 'requested_school_kind_mismatch');
  assert.equal(result.quarantine[0].requested_school_kind_code, '03');
  assert.equal(result.quarantine[0].source_school_kind_code, '25');
  assert.deepEqual(result.quarantine[0].raw, broadcast);
  assert.equal(result.quarantine[0].source_row_index, 2);
  assert.equal(result.quarantine[0].query.sgg_code, '41111');
  assert.equal(result.quarantine[0].query.disclosure_year, 2025);
  assert.ok(result.rows.every(row => row.official_school_code !== broadcast.SCHUL_CODE));
  assert.equal(result.queries.reduce((sum, query) => sum + query.raw_count, 0), result.raw_count);
  for (const query of result.queries) assert.equal(query.raw_count, query.usable_count + query.quarantined_count);
  assert.throws(() => normalizeSchoolInfo(broadcast, {apiType: '62', year: 2025}), /지원 범위/);
  broadcast.SCHUL_NM = '나중에 변경';
  assert.notEqual(result.quarantine[0].raw.SCHUL_NM, broadcast.SCHUL_NM);
});

test('공식47지역 수집 완료여도 미지원·누락 학교급은 정규화 완료가 아니다', async () => {
  const result = await fetchSchoolInfo({key: 'synthetic', requestIntervalMs: 0, fetchImpl: async url => {
    const kind = url.searchParams.get('schulKndCode');
    const region = url.searchParams.get('sggCode');
    return response([{...base(kind), SCHUL_CODE: `S${region}${kind}`, SCHUL_KND_SC_CODE: null, ADRCD_CD: `${region}10100`}]);
  }});
  assert.equal(result.scope, 'complete');
  assert.equal(result.collection_complete, true);
  assert.equal(result.normalization_complete, false);
  assert.equal(result.completed_requests, 141);
  assert.equal(result.raw_count, 141);
  assert.equal(result.usable_count, 0);
  assert.equal(result.quarantined_count, 141);
  assert.ok(result.queries.every(query => query.data_status === 'returned' && query.raw_count === 1 && query.usable_count === 0));
});

test('격리 대상도 지역·식별자와 중복 응답 검사를 우회하지 못한다', async () => {
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([{...base('25'), ADRCD_CD: '4111310100'}])}), /시군구/);
  await assert.rejects(fetchSchoolInfo({sample: true, fetchImpl: async () => response([{...base('25'), SCHUL_CODE: null}])}), /식별자/);
  await assert.rejects(fetchSchoolInfo({sample: true, requestIntervalMs: 0, sggCodes: ['41111', '41113'], fetchImpl: async url => response([
    {...base('25'), ADRCD_CD: `${url.searchParams.get('sggCode')}10100`},
  ])}), /중복/);
});
