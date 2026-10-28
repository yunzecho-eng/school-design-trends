// 로컬 수집용: 학교기본정보는 학교의 식별 근거이며 건물 준공 자료가 아니다.
import {isValidDate} from '../domain/dates.js';

export const NEIS_SOURCE = Object.freeze({
  id: 'neis-school-info', title: '나이스 학교기본정보 · 경기도교육청',
  url: 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2',
  endpoint: 'https://open.neis.go.kr/hub/schoolInfo', keyEnvironment: 'NEIS_API_KEY',
  rights: '이용허락범위 제한 없음 · 출처와 조회일 보존',
});

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const level = {초등학교: 'elementary', 중학교: 'middle', 고등학교: 'high', 특수학교: 'other', 각종학교: 'other'};
const normalizeName = value => (text(value) ?? '').normalize('NFKC').replace(/\s+/gu, '');

function compactDate(value) {
  const raw = text(value);
  if (!raw || !/^[1-9]\d{7}$/.test(raw)) return null;
  const result = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return isValidDate(result) ? result : null;
}

function safeWebsite(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function normalizeNeisSchool(row) {
  if (!record(row) || row.ATPT_OFCDC_SC_CODE !== 'J10' ||
      typeof row.SD_SCHUL_CODE !== 'string' || !/^\d{7}$/.test(row.SD_SCHUL_CODE) || !text(row.SCHUL_NM)) {
    throw new Error('나이스 응답의 경기 교육청·학교 코드·학교명을 확인하세요.');
  }
  const dateIssues = [];
  for (const field of ['FOND_YMD', 'FOAS_MEMRD', 'LOAD_DTM']) {
    if (row[field] !== null && row[field] !== undefined && row[field] !== '' && !compactDate(row[field])) {
      dateIssues.push(`${field}: 날짜 형식 확인 필요`);
    }
  }
  return {
    official_school_id: `neis:${row.ATPT_OFCDC_SC_CODE}:${row.SD_SCHUL_CODE}`,
    school_code: row.SD_SCHUL_CODE, education_office_code: row.ATPT_OFCDC_SC_CODE,
    education_office_name: text(row.ATPT_OFCDC_SC_NM), name: text(row.SCHUL_NM),
    school_level: level[text(row.SCHUL_KND_SC_NM)] ?? 'unknown',
    school_level_label: text(row.SCHUL_KND_SC_NM), establishment_type: text(row.FOND_SC_NM),
    region_name: text(row.LCTN_SC_NM), road_address: text(row.ORG_RDNMA),
    address_detail: text(row.ORG_RDNDA), postal_code: text(row.ORG_RDNZC),
    official_url: safeWebsite(row.HMPG_ADRES),
    establishment_date: compactDate(row.FOND_YMD), opening_anniversary_date: compactDate(row.FOAS_MEMRD),
    // LOAD_DTM은 포털 연계일이다. 원자료 검수일이나 건물 사용승인일로 해석하지 않는다.
    data_as_of: compactDate(row.LOAD_DTM), data_as_of_basis: 'LOAD_DTM · 포털 연계일',
    date_issues: dateIssues, source_id: NEIS_SOURCE.id, verified: false,
  };
}

export function parseNeisResponse(payload) {
  if (payload?.RESULT?.CODE === 'INFO-200') return {total: 0, rows: []};
  const parts = payload?.schoolInfo;
  if (!Array.isArray(parts) || !parts.every(record)) throw new Error('나이스 API 응답 오류: 인증·서비스 상태를 확인하세요.');
  const heads = parts.filter(part => Object.hasOwn(part, 'head'));
  const bodies = parts.filter(part => Object.hasOwn(part, 'row'));
  if (heads.length !== 1 || bodies.length !== 1 || !Array.isArray(heads[0].head) ||
      !heads[0].head.every(record) || !Array.isArray(bodies[0].row) || !bodies[0].row.every(record)) {
    throw new Error('나이스 API 건수·행 형식이 바뀌었습니다.');
  }
  const head = heads[0].head;
  if (head.find(item => item.RESULT)?.RESULT?.CODE !== 'INFO-000') throw new Error('나이스 API가 정상 응답하지 않았습니다.');
  const rawCount = head.find(item => Object.hasOwn(item, 'list_total_count'))?.list_total_count;
  if (!(typeof rawCount === 'number' || typeof rawCount === 'string' && /^\d+$/.test(rawCount.trim())) ||
      !Number.isSafeInteger(Number(rawCount)) || Number(rawCount) < 0) throw new Error('나이스 API 총건수 형식을 확인하세요.');
  return {total: Number(rawCount), rows: bodies[0].row};
}

async function requestJson(url, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, {signal: AbortSignal.timeout(25_000), redirect: 'error'}); }
  catch { throw new Error('나이스 API 연결에 실패했습니다. 이전 결과를 유지합니다.'); }
  if (!response.ok) {
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : '오류';
    throw new Error(`나이스 API HTTP ${status}: 인증·사용량·서비스 상태를 확인하세요.`);
  }
  try { return await response.json(); }
  catch { throw new Error('나이스 API가 JSON 형식으로 응답하지 않았습니다.'); }
}

// JSON 객체의 필드 순서가 달라도 같은 행·페이지로 판별한다.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function partitionSchoolRows(rawRows) {
  const groups = new Map();
  for (const raw of rawRows) {
    // 다른 교육청 자료가 섞이면 조회 필터가 무시된 것일 수 있으므로 전체 작업을 중단한다.
    if (raw.ATPT_OFCDC_SC_CODE !== 'J10') throw new Error('나이스 응답의 교육청이 경기도 요청과 다릅니다.');
    if (typeof raw.SD_SCHUL_CODE !== 'string' || !/^\d{7}$/.test(raw.SD_SCHUL_CODE)) continue;
    const group = groups.get(raw.SD_SCHUL_CODE) ?? [];
    group.push(canonicalJson(raw));
    groups.set(raw.SD_SCHUL_CODE, group);
  }
  const rows = [], quarantine = [];
  rawRows.forEach((raw, index) => {
    const reasons = [];
    const validCode = typeof raw.SD_SCHUL_CODE === 'string' && /^\d{7}$/.test(raw.SD_SCHUL_CODE);
    if (!validCode) reasons.push(raw.SD_SCHUL_CODE == null || typeof raw.SD_SCHUL_CODE === 'string' && !raw.SD_SCHUL_CODE.trim() ? 'missing_school_code' : 'invalid_school_code');
    if (!text(raw.SCHUL_NM)) reasons.push('missing_school_name');
    const group = validCode ? groups.get(raw.SD_SCHUL_CODE) : null;
    if (group?.length > 1) {
      // 같은 코드를 서로 다른 과정·학교가 공유하거나 같은 행이 중복돼도 하나를 임의 선택하지 않는다.
      reasons.push('duplicate_school_code');
      const signature = canonicalJson(raw);
      if (group.filter(value => value === signature).length > 1) reasons.push('identical_duplicate_row');
    }
    if (reasons.length) quarantine.push({source_row: index + 1, reasons,
      source_id: NEIS_SOURCE.id, official_school_id: validCode ? `neis:J10:${raw.SD_SCHUL_CODE}` : null,
      raw: structuredClone(raw)});
    else rows.push(normalizeNeisSchool(raw));
  });
  return {rows, raw_count: rawRows.length, quarantined_count: quarantine.length, quarantine,
    normalization_complete: quarantine.length === 0};
}

export async function fetchNeisSchools({key, sample = false, fetchImpl = fetch, maxPages = 100} = {}) {
  if (!sample && (!text(key) || key.trim().toLowerCase() === 'sample')) throw new Error('NEIS_API_KEY가 필요합니다. 키 없는 시험은 --sample을 사용하세요.');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error('나이스 수집 페이지 한도는 1~1000 정수여야 합니다.');
  const rawRows = []; const seenPages = new Set(); let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(NEIS_SOURCE.endpoint);
    url.search = new URLSearchParams({Type: 'json', ATPT_OFCDC_SC_CODE: 'J10', pIndex: String(page),
      pSize: sample ? '5' : '1000', ...(!sample ? {KEY: key.trim()} : {})});
    const parsed = parseNeisResponse(await requestJson(url, fetchImpl));
    if (total !== null && total !== parsed.total) throw new Error('수집 중 나이스 학교 총건수가 바뀌었습니다. 다시 실행하세요.');
    total = parsed.total;
    const signature = canonicalJson(parsed.rows.map(canonicalJson).sort());
    if (seenPages.has(signature)) throw new Error('나이스 API가 같은 페이지를 반복했습니다. 인증·페이지 처리를 확인하세요.');
    seenPages.add(signature);
    rawRows.push(...parsed.rows);
    if (rawRows.length > total) throw new Error('나이스 응답 건수가 총건수와 일치하지 않습니다.');
    // 전체 수집 판정은 원시 응답 건수 기준이다. 정규화 보류 행은 별도로 보고한다.
    if (sample || rawRows.length === total) return {...partitionSchoolRows(rawRows), total,
      scope: sample ? 'sample_only' : 'complete', scope_basis: 'raw_response_rows_collected'};
    if (!parsed.rows.length) throw new Error('나이스 전체 조회가 끝나기 전에 응답이 비었습니다.');
  }
  throw new Error('나이스 수집의 안전 페이지 한도를 넘었습니다.');
}

// 이름이 완전히 같은 경우에도 동일 학교임을 확정하지 않는다. 가칭·개명·통합은 별도 검수한다.
export function matchNeisSchools(projects, rows, {scope = 'complete', normalizationComplete = true} = {}) {
  const index = new Map();
  for (const row of rows) {
    const name = normalizeName(row.name);
    if (!name) continue;
    const bucket = index.get(name) ?? [];
    if (!bucket.some(item => item.official_school_id === row.official_school_id)) bucket.push(row);
    index.set(name, bucket);
  }
  return projects.map(project => {
    const candidates = index.get(normalizeName(project.title)) ?? [];
    return {project_id: project.project_id, name: project.title,
      match_status: candidates.length > 1 ? 'ambiguous' : candidates.length ? 'candidate' : scope !== 'complete' || !normalizationComplete ? 'not_searched' : 'not_found',
      match_basis: 'normalized_exact_name_only', verified: false, candidates: [...candidates]};
  });
}
