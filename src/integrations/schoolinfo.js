// 학교알리미 공식 API. 인증키가 필요한 수집은 로컬에서만 실행한다.
// 규격: https://www.schoolinfo.go.kr/download/OpenAPI_Output.xlsx
// 시도 41: https://www.schoolinfo.go.kr/download/sido_sggCode.xlsx
import {isValidDate} from '../domain/dates.js';

export const SCHOOLINFO_SOURCE = Object.freeze({
  id: 'schoolinfo', title: '학교알리미 학교·학생·시설 공시',
  url: 'https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l0.do',
  endpoint: 'https://www.schoolinfo.go.kr/openApi.do', keyEnvironment: 'SCHOOLINFO_API_KEY',
  rights: '출처표시 · 항목별 이용조건 확인',
});
export const SCHOOLINFO_API_TYPES = Object.freeze(['0', '62', '17', '18', '20']);
const KINDS = Object.freeze({'02': 'elementary', '03': 'middle', '04': 'high'});
const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null;
const scalar = value => typeof value === 'number' && Number.isFinite(value) ? value : text(value);
const flag = value => value === 'Y' ? true : value === 'N' ? false : null;
const date = value => {
  const input = text(value);
  if (!/^\d{8}$/.test(input ?? '')) return null;
  const normalized = `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6)}`;
  return isValidDate(normalized) ? normalized : null;
};
function coordinate(value, min, max) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function website(value) {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// 학생·학급 총계의 괄호는 전체에 포함된 특수·순회 수다. 절대 더하지 않는다.
// 공식 항목 설명: pnnggo_a01_l0.do?goNo=62&groupNo=1
function metric(row, field, label, unit, excluded, {parenthesized = false, decimal = false} = {}) {
  const raw = scalar(row[field]);
  let value = null;
  let includedSpecialItinerant = null;
  if (raw !== null) {
    const source = String(raw).trim();
    const pattern = parenthesized ? /^(\d+|\d{1,3}(?:,\d{3})+)(?:\((\d+|\d{1,3}(?:,\d{3})+)\))?$/ : decimal ? /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/ : /^(\d+|\d{1,3}(?:,\d{3})+)$/;
    const match = source.match(pattern);
    const number = match ? Number((parenthesized ? match[1] : source).replaceAll(',', '')) : NaN;
    if (match && (decimal ? Number.isFinite(number) : Number.isSafeInteger(number))) {
      value = number;
      if (parenthesized && match[2] !== undefined) {
        includedSpecialItinerant = Number(match[2].replaceAll(',', ''));
        if (!Number.isSafeInteger(includedSpecialItinerant) || includedSpecialItinerant > value) value = null;
      }
    }
  }
  return {
    field, label, unit, raw, value: excluded ? null : value,
    status: excluded ? 'excluded' : raw === null ? 'missing' : value === null ? 'unparsed' : 'reported',
    ...(parenthesized ? {included_special_itinerant: excluded || value === null ? null : includedSpecialItinerant} : {}),
  };
}
const ROOM_FIELDS = Object.freeze([
  ['COL_1', '일반교실'], ['CURR_CCCLA_FGR', '교과교실'], ['COL_5', '특별교실'], ['COL_4', '수준별교실'],
  ['COL_6', '교수학습공간 기타'], ['COL_3', '시청각실'], ['COM_CCCLA_FGR', '컴퓨터실'], ['MMA_CCCLA_FGR', '멀티미디어실'],
  ['LRN_SPORT_ETC_CCCLA_FGR', '학습지원공간 기타'], ['COL_7', '교원지원공간'], ['COL_8', '관리행정공간'],
  ['COL_9', '체육집회공간'], ['COL_10', '보건실'], ['COL_16', '학생탈의실'], ['STDNT_SWRM_FGR', '학생샤워실'],
  ['ML_TOI_FGR', '남자화장실'], ['FML_TOI_FGR', '여자화장실'], ['COMUS_TOI_FGR', '공용화장실'],
  ['COL_12', '학생식당'], ['COL_13', '기숙사실수'], ['COL_14', '기타공간'],
]);
const OPENING_FIELDS = Object.freeze([
  ['COL_1', '체육장'], ['COL_3', '체육관'], ['COL_5', '강당'], ['COL_7', '일반·교과교실'], ['COL_9', '특별교실'], ['COL_11', '시청각실'],
]);

export function normalizeSchoolInfo(row, {apiType, year = null, schoolKind} = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !SCHOOLINFO_API_TYPES.includes(apiType)) throw new Error('학교알리미 응답 형식을 확인하세요.');
  const code = text(row.SCHUL_CODE);
  const name = text(row.SCHUL_NM);
  const kind = text(row.SCHUL_KND_SC_CODE);
  const region = text(row.ADRCD_CD);
  if (!/^[A-Za-z0-9_-]+$/.test(code ?? '') || !name || !(kind in KINDS)) throw new Error('학교알리미 학교 식별자·학교급이 없습니다.');
  if (schoolKind && kind !== schoolKind || region && !/^41\d{3,8}$/.test(region)) throw new Error('학교알리미 응답의 지역·학교급이 요청 조건과 다릅니다.');
  const excluded = flag(row.PBAN_EXCP_YN);
  const base = {
    source_id: SCHOOLINFO_SOURCE.id, official_school_id: `schoolinfo:${code}`, official_school_code: code,
    api_type: apiType, disclosure_year: apiType === '0' ? null : Number(year), name, school_kind_code: kind, school_level: KINDS[kind],
    education_office_code: text(row.ATPT_OFCDC_ORG_CODE), education_office: text(row.ATPT_OFCDC_ORG_NM),
    source_region_code: region, source_region_name: text(row.ADRCD_NM),
    excluded, exclusion_reason: text(row.PBAN_EXCP_RSN), match_status: 'unlinked', verified: false,
  };
  if (apiType === '0') return {
    ...base, legal_dong_code: text(row.ADRCD_ID), road_address: text(row.SCHUL_RDNMA), road_address_detail: text(row.SCHUL_RDNDA),
    lot_address: text(row.ADRES_BRKDN), lot_address_detail: text(row.DTLAD_BRKDN),
    latitude: coordinate(row.LTTUD, -90, 90), longitude: coordinate(row.LGTUD, -180, 180), website: website(row.HMPG_ADRES),
    establishment_date: date(row.FOND_YMD), opening_anniversary: date(row.FOAS_MEMRD),
    date_note: '학교 설립일·개교기념일이며 건물 준공일·사용승인일이 아닙니다.',
    is_closed: flag(row.ABSCH_YN), closure_date: date(row.ABSCH_YMD), is_suspended: flag(row.CLOSE_YN), is_branch: flag(row.BNHH_YN),
  };
  let metrics;
  if (apiType === '62') metrics = [
    metric(row, 'COL_FGR_SUM', '학생수계', '명', excluded, {parenthesized: true}),
    metric(row, 'COL_SUM', '학급수계', '개', excluded, {parenthesized: true}),
    metric(row, 'AVG_FGR_SUM', '학급당학생수', '명', excluded, {decimal: true}),
    metric(row, 'SP_FGR_SUM', '특수학급 학생수계', '명', excluded), metric(row, 'SP_SUM', '특수학급 학급수계', '개', excluded),
  ];
  if (apiType === '17') metrics = ROOM_FIELDS.map(([field, label]) => metric(row, field, label, '실', excluded));
  if (apiType === '18') metrics = [
    metric(row, 'COL_1', '체육관', '실', excluded), metric(row, 'COL_2', '강당', '실', excluded),
    metric(row, 'BRHS_RCPTN_NMPR_FGR', '기숙사 재실인원', '명', excluded),
    metric(row, 'SWMPL_FGR', '수영장', '실', excluded), metric(row, 'COSE_CNSRM_FGR', '진로상담실', '실', excluded),
  ];
  if (apiType === '20') return {...base, facility_opening: OPENING_FIELDS.map(([field, label]) => {
    const raw = text(row[field]);
    const state = {'유': 'open', 'O': 'open', '○': 'open', '무': 'closed', 'X': 'closed', '×': 'closed', '시설없음': 'absent'}[raw] ?? 'unknown';
    return {field, label, raw, state: excluded ? 'excluded' : state};
  })};
  return {...base, metrics};
}

export function parseSchoolInfoResponse(payload) {
  // Do not include provider messages: gateways can echo an authenticated URL.
  if (payload?.resultCode !== 'success') throw new Error('학교알리미 API가 요청을 거절했습니다. 인증키·공시연도·서비스 상태를 확인하세요.');
  if (!Array.isArray(payload.list)) throw new Error('학교알리미 list 응답이 없습니다.');
  if (payload.list.length > 10000) throw new Error('학교알리미 응답이 수집 한도를 넘었습니다.');
  return payload.list;
}

export async function fetchSchoolInfo({key, year, apiTypes = ['0'], sample = false, fetchImpl = fetch} = {}) {
  if (typeof sample !== 'boolean') throw new Error('학교알리미 sample 설정을 확인하세요.');
  if (!sample && (!text(key) || key.trim() === 'sample')) throw new Error('SCHOOLINFO_API_KEY가 필요합니다. 공개 표본은 sample 옵션을 사용하세요.');
  if (!Array.isArray(apiTypes) || !apiTypes.length || apiTypes.length > 5 || apiTypes.some(type => !SCHOOLINFO_API_TYPES.includes(type)) || new Set(apiTypes).size !== apiTypes.length) throw new Error('학교알리미 apiTypes는 0, 62, 17, 18, 20 중 중복 없이 선택하세요.');
  if (apiTypes.some(type => type !== '0') && !/^(?:19|20)\d{2}$/.test(String(year ?? ''))) throw new Error('학교알리미 공시자료에는 네 자리 공시연도가 필요합니다.');
  const rows = [];
  const queries = [];
  const seen = new Set();
  // This API documents no pagination. Each of the bounded kind/type requests
  // returns one list. "complete" describes successful requested queries only;
  // excluded schools and unpublished years are not a complete population census.
  for (const apiType of apiTypes) for (const schoolKind of Object.keys(KINDS)) {
    const url = new URL(SCHOOLINFO_SOURCE.endpoint);
    url.search = new URLSearchParams({apiKey: sample ? 'sample' : key.trim(), apiType, sidoCode: '41', schulKndCode: schoolKind}).toString();
    if (apiType !== '0') url.searchParams.set('pbanYr', String(year));
    let response;
    try { response = await fetchImpl(url, {signal: AbortSignal.timeout(25000), redirect: 'error'}); }
    catch { throw new Error('학교알리미 연결에 실패했습니다. 네트워크 또는 서비스 상태를 확인하세요.'); }
    if (!response.ok) throw new Error('학교알리미 HTTP 요청이 실패했습니다. 서비스 상태를 확인하세요.');
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('학교알리미 JSON 응답을 읽지 못했습니다.'); }
    const normalized = parseSchoolInfoResponse(payload).map(row => normalizeSchoolInfo(row, {apiType, year, schoolKind}));
    for (const row of normalized) {
      const identity = `${apiType}|${row.official_school_code}`;
      if (seen.has(identity)) throw new Error('학교알리미 응답에 중복된 학교·항목이 있습니다. 이전 수집 결과를 유지하세요.');
      seen.add(identity);
      rows.push(row);
    }
    queries.push({api_type: apiType, school_kind_code: schoolKind, disclosure_year: apiType === '0' ? null : Number(year), retrieved_count: normalized.length});
  }
  return {
    rows, total: rows.length, source_total: null, scope: sample ? 'sample_only' : 'complete', queries,
    region_code: '41', school_kinds: Object.keys(KINDS),
    limitations: [
      ...(sample ? ['공식 sample 키의 제한된 표본이며 경기도 전체 학교를 조회한 결과가 아닙니다.'] : []),
      '초·중·고만 요청합니다. 특수·각종·기타학교는 포함하지 않습니다.',
      '기본정보는 조회 시점 자료이며 공시연도 자료와 기준시점이 다를 수 있습니다.',
      '전체 건수는 반환 레코드 수이며 기본정보와 공시항목을 합한 고유 학교 수가 아닙니다.',
      '공시 제외·미제공 값은 실제 0이 아닙니다. 학교코드는 NEIS와 별도 매핑하고 동일성 검수 후 연결합니다.',
    ],
  };
}
