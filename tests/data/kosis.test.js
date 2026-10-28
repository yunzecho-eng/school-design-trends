import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {KOSIS_SOURCE, validateKosisConfig, parseKosisPopulation, fetchKosisPopulation} from '../../src/integrations/kosis.js';

// Synthetic identifiers exercise the documented response shape; these are not production selection codes.
const config = () => ({
  schema_version: 'kosis-population-config-1', verified: true, verified_at: '2026-10-28',
  selection_note: '테스트용 합계 항목·코드 확인 기록', boundary_note: '테스트용 동일 시 경계',
  orgId: '101', tblId: 'DT_1B04006', province: '경기도', dimensions: {region: 'C1', age: 'C2'},
  regions: [{code: 'REGION_FIXTURE', name: '수원시', level: 'municipality'}],
  ages: Array.from({length: 12}, (_, index) => ({code: `AGE_${index + 6}`, age: index + 6})),
  item: {code: 'TOTAL_FIXTURE', name: '총인구수', meaning: 'total_resident_population'},
  months: ['202509', '202609'], fixedSelections: {},
});
const payload = (month = '202609') => config().ages.map(({code, age}) => ({
  ORG_ID: '101', TBL_ID: 'DT_1B04006', TBL_NM: KOSIS_SOURCE.title,
  C1: 'REGION_FIXTURE', C1_NM: '수원시', C1_OBJ_NM: '행정구역(시군구)별',
  C2: code, C2_NM: `${age}세`, C2_OBJ_NM: '연령별',
  ITM_ID: 'TOTAL_FIXTURE', ITM_NM: '총인구수', UNIT_NM: '명', PRD_SE: 'M',
  PRD_DE: month, DT: '1,234', LST_CHN_DE: '2026-10-06',
}));
const response = data => ({ok: true, json: async () => data});

test('normalizes source-qualified region, age, month and actual zeros without confusing missing values', () => {
  const rows = payload();
  rows[0].DT = '0'; rows[1].DT = '-'; rows[2].DT = ''; rows[3].DT = '...'; rows[4].DT = null;
  const actual = parseKosisPopulation(rows, config(), '202609');
  assert.equal(actual[0].value, 0);
  assert.equal(actual[0].missing, false);
  for (let index = 1; index <= 4; index += 1) { assert.equal(actual[index].value, null); assert.equal(actual[index].missing, true); }
  assert.equal(actual[5].value, 1234);
  assert.equal(actual[5].age, 11);
  assert.equal(actual[5].month, '202609');
  assert.equal(actual[5].source_updated_at, '2026-10-06');
  assert.equal(actual[5].region_code_system, 'KOSIS:101:DT_1B04006');
  assert.equal(actual[5].is_forecast, false);
  assert.equal(actual[5].measure, 'resident_population');
});

test('example config deliberately cannot call the API before official selections are confirmed', async () => {
  const example = JSON.parse(await readFile(new URL('../../data/config/kosis-population.example.json', import.meta.url), 'utf8'));
  assert.throws(() => validateKosisConfig(example), /URL 생성기/);
  assert.throws(() => validateKosisConfig({...config(), apiKey: 'not-allowed'}), /인증키/);
  assert.throws(() => validateKosisConfig({...config(), url: 'https://example.org'}), /설정 형식/);
  assert.throws(() => validateKosisConfig({...config(), verified_at: '2026-02-30'}));
});

test('rejects mixed city/district scope, duplicate codes, totals mistaken for age and non-total item', () => {
  const mixed = config(); mixed.regions.push({code: 'DISTRICT', name: '장안구', level: 'district'});
  assert.throws(() => validateKosisConfig(mixed), /하위 구/);
  const duplicate = config(); duplicate.regions.push({...duplicate.regions[0]});
  assert.throws(() => validateKosisConfig(duplicate));
  const ages = config(); ages.ages[0].age = 0;
  assert.throws(() => validateKosisConfig(ages));
  const male = config(); male.item.meaning = 'male_population';
  assert.throws(() => validateKosisConfig(male), /남녀 합계/);
});

test('rejects incomplete/duplicate observations instead of producing misleading full coverage', () => {
  assert.throws(() => parseKosisPopulation(payload().slice(1), config(), '202609'), /불완전/);
  const duplicate = payload(); duplicate[11] = {...duplicate[0]};
  assert.throws(() => parseKosisPopulation(duplicate, config(), '202609'), /중복/);
  const mismatch = payload(); mismatch[0].C2_NM = '5세';
  assert.throws(() => parseKosisPopulation(mismatch, config(), '202609'), /연령 명칭/);
  const wrongUnit = payload(); wrongUnit[0].UNIT_NM = '%';
  assert.throws(() => parseKosisPopulation(wrongUnit, config(), '202609'), /단위/);
  const extra = payload(); extra[0].C3 = 'MALE';
  assert.throws(() => parseKosisPopulation(extra, config(), '202609'), /추가 분류/);
});

test('fetches only configured months/selection on fixed official host and preserves leading-zero codes', async () => {
  const settings = config(); settings.regions[0].code = '00123';
  const seen = [];
  const actual = await fetchKosisPopulation({key: 'test-secret+/=', config: settings, fetchImpl: async (input, options) => {
    const url = new URL(input); seen.push(url);
    assert.equal(url.origin, 'https://kosis.kr');
    assert.equal(url.searchParams.get('objL1'), '00123');
    assert.equal(url.searchParams.get('objL2'), settings.ages.map(row => row.code).join('+'));
    assert.equal(url.searchParams.get('apiKey'), 'test-secret+/=');
    assert.equal(url.searchParams.get('startPrdDe'), url.searchParams.get('endPrdDe'));
    assert.equal(options.redirect, 'error');
    return response(payload(url.searchParams.get('startPrdDe')).map(row => ({...row, C1: '00123'})));
  }});
  assert.equal(seen.length, 2);
  assert.equal(actual.rows[0].region_code, '00123');
  assert.equal(actual.total, 24);
  assert.equal(actual.scope, 'complete');
  assert.equal(actual.scope_basis, 'configured_municipalities_ages_months');
  assert.ok(!JSON.stringify(actual).includes('test-secret'));
});

test('fails closed without keys/config and never echoes raw network/API failure credentials', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('https://kosis.kr/?apiKey=test-secret'); };
  await assert.rejects(fetchKosisPopulation({config: config(), fetchImpl}), /KOSIS_API_KEY/);
  await assert.rejects(fetchKosisPopulation({key: 'test-secret', config: {...config(), verified: false}, fetchImpl}), /URL 생성기/);
  assert.equal(calls, 0);
  await assert.rejects(fetchKosisPopulation({key: 'test-secret', config: config(), fetchImpl}), error => !error.message.includes('test-secret') && /연결하지 못했습니다/.test(error.message));
  for (const badResponse of [
    {ok: false, statusText: 'test-secret'},
    {ok: true, json: async () => { throw new Error('test-secret'); }},
    response({err: 'test-secret', errMsg: 'apiKey=test-secret'}),
  ]) {
    await assert.rejects(fetchKosisPopulation({key: 'test-secret', config: config(), fetchImpl: async () => badResponse}), error => !error.message.includes('test-secret'));
  }
});

test('invalid population values are not accepted as known counts and unknown source dates stay null', () => {
  for (const invalid of ['-12', '1.2', '1,23', 'NaN', 'unknown', false, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const rows = payload(); rows[0].DT = invalid;
    assert.throws(() => parseKosisPopulation(rows, config(), '202609'));
  }
  const rows = payload(); rows[0].LST_CHN_DE = '2026-02-30';
  assert.equal(parseKosisPopulation(rows, config(), '202609')[0].source_updated_at, null);
});
