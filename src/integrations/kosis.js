// KOSIS codes are selected in the official URL generator, never inferred from map codes.
export const KOSIS_SOURCE = Object.freeze({
  id: 'kosis-resident-population',
  title: '행정구역(시군구)별/1세별 주민등록인구',
  url: 'https://kosis.kr/statisticsList/mass/mass_list.jsp?list_id=A_7&org_id=101&process=statHtml&tbl_id=DT_1B04006&vw_cd=MT_ZTITLE',
  guide: 'https://kosis.kr/openapi/devGuide/devGuide_0201List.do',
  endpoint: 'https://kosis.kr/openapi/Param/statisticsParameterData.do',
  keyEnvironment: 'KOSIS_API_KEY',
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const code = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
const month = value => typeof value === 'string' && /^\d{4}(0[1-9]|1[0-2])$/.test(value);
const dimension = value => typeof value === 'string' && /^C[1-8]$/.test(value);
const fail = message => { throw new Error(`KOSIS ${message}`); };
const only = (object, fields) => plain(object) && Object.keys(object).every(key => fields.includes(key));
const unique = values => new Set(values).size === values.length;
const cleanName = value => text(value)?.replace(/\s+/gu, ' ');
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

// Explicit reviewed selections prevent a total, a sex-specific series, or a parent city
// plus its districts from silently becoming an apparent school-age population total.
export function validateKosisConfig(config) {
  if (!only(config, ['schema_version', 'verified', 'verified_at', 'selection_note', 'boundary_note', 'orgId', 'tblId', 'province', 'dimensions', 'regions', 'ages', 'item', 'months', 'fixedSelections'])) fail('설정 형식을 확인하세요. 인증키·전체 URL은 설정 파일에 넣지 않습니다.');
  if (config.schema_version !== 'kosis-population-config-1' || config.verified !== true || !validDate(config.verified_at)) fail('공식 URL 생성기에서 분류·항목 코드를 확인하고 verified와 verified_at을 기록하세요.');
  if (!text(config.selection_note) || !text(config.boundary_note)) fail('선택 코드와 지역 경계의 확인 근거를 기록하세요.');
  if (config.orgId !== '101' || config.tblId !== 'DT_1B04006' || config.province !== '경기도') fail('경기도 주민등록인구 통계표 설정이 아닙니다.');
  if (!only(config.dimensions, ['region', 'age']) || !dimension(config.dimensions.region) || !dimension(config.dimensions.age) || config.dimensions.region === config.dimensions.age) fail('지역·연령 분류축을 확인하세요.');
  if (!Array.isArray(config.regions) || config.regions.length < 1 || config.regions.length > 31 || !unique(config.regions.map(row => row?.code))) fail('서로 다른 경기도 시·군 1~31개를 지정하세요.');
  for (const row of config.regions) {
    if (!only(row, ['code', 'name', 'level']) || !code(row.code) || !text(row.name) || row.level !== 'municipality') fail('시·군 코드·명칭을 지정하세요. 시 전체와 하위 구를 섞지 않습니다.');
  }
  if (!Array.isArray(config.ages) || config.ages.length !== 12 || !unique(config.ages.map(row => row?.code)) || !unique(config.ages.map(row => row?.age))) fail('6~17세의 12개 분류 코드를 각각 지정하세요.');
  for (const row of config.ages) {
    if (!only(row, ['code', 'age']) || !code(row.code) || !Number.isInteger(row.age) || row.age < 6 || row.age > 17) fail('연령 코드와 6~17세 대응을 확인하세요.');
  }
  if (!only(config.item, ['code', 'name', 'meaning']) || !code(config.item.code) || !text(config.item.name) || config.item.meaning !== 'total_resident_population') fail('남녀 합계 주민등록인구 항목을 확인하세요.');
  if (!Array.isArray(config.months) || config.months.length < 1 || config.months.length > 36 || !unique(config.months) || !config.months.every(month)) fail('중복 없는 YYYYMM 조회 월을 1~36개 지정하세요.');
  const fixed = config.fixedSelections ?? {};
  if (!plain(fixed)) fail('추가 분류 선택 형식을 확인하세요.');
  for (const [field, value] of Object.entries(fixed)) {
    if (!dimension(field) || [config.dimensions.region, config.dimensions.age].includes(field) || !code(value)) fail('추가 분류는 사용하지 않은 축별로 한 코드만 선택하세요.');
  }
  return config;
}

function numericValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') fail('인구 수치 형식이 올바르지 않습니다.');
  const value = String(raw).trim();
  if (['', '-', '...', '…', '*', 'x', 'X'].includes(value)) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) fail('인구 수치 또는 통계부호를 확인하세요.');
  const number = Number(value.replaceAll(',', ''));
  if (!Number.isSafeInteger(number)) fail('인구 수치 범위를 확인하세요.');
  return number;
}

export function parseKosisPopulation(payload, config, requestedMonth) {
  validateKosisConfig(config);
  if (!config.months.includes(requestedMonth)) fail('설정에 없는 조회 월입니다.');
  if (!Array.isArray(payload)) fail('응답 오류입니다. 인증키·통계표·조회 조건을 확인하세요.');
  const expectedCount = config.regions.length * config.ages.length;
  if (payload.length !== expectedCount) fail('선택한 지역·연령의 응답이 불완전합니다. 누락을 0명으로 채우지 않습니다.');
  const regionField = config.dimensions.region;
  const ageField = config.dimensions.age;
  const regions = new Map(config.regions.map(row => [row.code, row]));
  const ages = new Map(config.ages.map(row => [row.code, row.age]));
  const seen = new Set();
  return payload.map(row => {
    if (!plain(row) || row.ORG_ID !== '101' || row.TBL_ID !== 'DT_1B04006' || row.PRD_SE !== 'M' || row.PRD_DE !== requestedMonth || row.ITM_ID !== config.item.code || cleanName(row.ITM_NM) !== cleanName(config.item.name) || row.UNIT_NM !== '명') fail('응답의 통계표·시점·항목·단위가 요청과 다릅니다.');
    const region = regions.get(row[regionField]);
    const age = ages.get(row[ageField]);
    if (!region || age === undefined || cleanName(row[`${regionField}_NM`]) !== cleanName(region.name) || !text(row[`${ageField}_NM`])) fail('응답의 지역·연령 분류가 확인한 선택과 다릅니다.');
    const ageLabel = cleanName(row[`${ageField}_NM`]);
    if (!new RegExp(`^(?:만\\s*)?${age}\\s*세$`, 'u').test(ageLabel)) fail('응답의 연령 명칭과 선택한 나이가 다릅니다.');
    const classifications = [];
    for (let index = 1; index <= 8; index += 1) {
      const field = `C${index}`;
      if (row[field] === undefined || row[field] === null || row[field] === '') continue;
      const fixedCode = config.fixedSelections?.[field];
      if (![regionField, ageField].includes(field) && fixedCode !== row[field]) fail('검토하지 않은 추가 분류가 응답에 있습니다.');
      if (fixedCode && fixedCode !== row[field]) fail('추가 분류 응답이 선택과 다릅니다.');
      classifications.push({dimension: field, code: row[field], name: text(row[`${field}_NM`]), label: text(row[`${field}_OBJ_NM`])});
    }
    for (const [field, value] of Object.entries(config.fixedSelections ?? {})) {
      if (row[field] !== value) fail('선택한 추가 분류가 응답에서 누락됐습니다.');
    }
    const id = [KOSIS_SOURCE.id, requestedMonth, region.code, row[ageField], row.ITM_ID].join(':');
    if (seen.has(id)) fail('같은 지역·연령·월의 응답이 중복되었습니다.');
    seen.add(id);
    const value = numericValue(row.DT);
    const changedAt = validDate(row.LST_CHN_DE) ? row.LST_CHN_DE : null;
    return {
      population_id: id, region_code: region.code, region_name: text(row[`${regionField}_NM`]),
      region_code_system: 'KOSIS:101:DT_1B04006', region_level: 'municipality',
      age_code: row[ageField], age, age_name: text(row[`${ageField}_NM`]),
      item_code: row.ITM_ID, item_name: text(row.ITM_NM), month: requestedMonth,
      value, raw_value: row.DT === undefined ? null : row.DT, missing: value === null, unit: '명',
      source_updated_at: changedAt, classifications, source_id: KOSIS_SOURCE.id,
      measure: 'resident_population', is_forecast: false,
    };
  });
}

export async function fetchKosisPopulation({key, config, fetchImpl = fetch} = {}) {
  if (!text(key)) fail('전체 조회에는 KOSIS_API_KEY가 필요합니다.');
  validateKosisConfig(config);
  const rows = [];
  for (const requestedMonth of [...config.months].sort()) {
    const url = new URL(KOSIS_SOURCE.endpoint);
    const parameters = {
      method: 'getList', apiKey: key.trim(), orgId: '101', tblId: 'DT_1B04006',
      itmId: config.item.code, prdSe: 'M', startPrdDe: requestedMonth, endPrdDe: requestedMonth,
      format: 'json', jsonVD: 'Y', smblChk: 'Y',
      [`objL${config.dimensions.region.slice(1)}`]: config.regions.map(row => row.code).join('+'),
      [`objL${config.dimensions.age.slice(1)}`]: config.ages.map(row => row.code).join('+'),
    };
    for (const [field, value] of Object.entries(config.fixedSelections ?? {})) parameters[`objL${field.slice(1)}`] = value;
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    let response;
    try { response = await fetchImpl(url, {signal: AbortSignal.timeout(25000), redirect: 'error'}); }
    catch { fail('연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.'); }
    if (!response?.ok) fail('HTTP 응답 오류입니다. 서비스 상태와 인증을 확인하세요.');
    let payload;
    try { payload = await response.json(); }
    catch { fail('JSON 응답이 아닙니다. 서비스 상태를 확인하세요.'); }
    rows.push(...parseKosisPopulation(payload, config, requestedMonth));
  }
  return {
    rows, total: rows.length, scope: 'complete', scope_basis: 'configured_municipalities_ages_months',
    source_id: KOSIS_SOURCE.id, source_url: KOSIS_SOURCE.url,
    selection: {province: '경기도', municipalities: config.regions.length, ages: '6–17', months: [...config.months].sort()},
    limitations: [
      '선택한 시·군·월의 6–17세 주민등록인구이며 재학생 수나 미래 예측이 아닙니다.',
      '시·군과 하위 구를 함께 합산하지 않습니다. KOSIS 코드를 지도 행정코드로 자동 간주하지 않습니다.',
      '지역 경계가 달라진 시점은 같은 경계로 대조하기 전 증감을 계산하지 않습니다.',
      '통계부호와 결측은 null로 보존하며 0명으로 바꾸지 않습니다.',
    ],
  };
}
