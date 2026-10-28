// 공식 API는 로컬 수집 작업에서 호출한다. 웹에는 키가 없는 결과만 공개한다.
import {isValidDate} from '../domain/dates.js';

export const OFFICIAL_SOURCES = Object.freeze({
  firms: Object.freeze({
    id: 'gg-buildofc', title: '경기도 건축사 사무소 현황',
    url: 'https://www.data.go.kr/data/15057636/openapi.do',
    portal: 'https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=7VV6IWKWGKZFH3PG0ELH19127436&infSeq=2',
    endpoint: 'https://openapi.gg.go.kr/Buildofc', keyEnvironment: 'GG_OPEN_API_KEY',
    rights: '이용허락범위 제한 없음 · 출처와 조회일 보존',
  }),
  buildings: Object.freeze({
    id: 'molit-building-title', title: '국토교통부 건축HUB 건축물대장 표제부',
    url: 'https://www.data.go.kr/data/15134735/openapi.do',
    endpoint: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
    keyEnvironment: 'DATA_GO_KR_SERVICE_KEY', updateFrequency: '월간',
    rights: '이용허락범위 제한 없음 · 출처와 조회일 보존',
  }),
});

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const finite = (value, min, max) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max ? null : Number(value);
const date = value => typeof value === 'string' && isValidDate(value) ? value : null;
const count = value => {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

export function normalizeFirmName(value) {
  return (text(value) ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR')
    .replace(/주식회사|유한회사|\(주\)|\(유\)|㈜/gu, '').replace(/\s+/gu, '');
}

export function normalizeOfficialFirm(row) {
  if (!text(row?.OFC_NM)) throw new Error('경기 사무소 응답의 OFC_NM이 없습니다.');
  const regionCode = text(String(row.SIGUN_CD ?? ''));
  if (!/^41\d{3}$/.test(regionCode ?? '')) throw new Error('경기 사무소 응답의 시군코드를 확인하세요.');
  return {
    name: text(row.OFC_NM), municipality_code: regionCode, municipality: text(row.SIGUN_NM),
    organization_type: text(row.STATMNT_DIV), representative: text(row.REPRSNTV_NM),
    road_address: text(row.REFINE_ROADNM_ADDR), lot_address: text(row.REFINE_LOTNO_ADDR),
    postal_code: text(String(row.REFINE_ZIP_CD ?? '')), latitude: finite(row.REFINE_WGS84_LAT, -90, 90),
    longitude: finite(row.REFINE_WGS84_LOGT, -180, 180), data_as_of: date(row.DATA_STD_DE),
    business_registration_number: null, official_url: null, source_id: OFFICIAL_SOURCES.firms.id,
  };
}

// 같은 상호만으로 다른 지역의 동명 사무소를 확정하지 않는다.
export function matchOfficialFirms(firms, officialRows) {
  const index = new Map();
  for (const row of officialRows) {
    const key = normalizeFirmName(row.name);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    if (!bucket.some(item => JSON.stringify(item) === JSON.stringify(row))) bucket.push(row);
    index.set(key, bucket);
  }
  return firms.map(firm => {
    const names = new Set([firm.name, ...(Array.isArray(firm.aliases) ? firm.aliases : [])].map(normalizeFirmName).filter(Boolean));
    const candidates = [...new Set([...names].flatMap(name => index.get(name) ?? []))];
    return {firm_id: firm.firm_id, name: firm.name,
      match_status: candidates.length > 1 ? 'ambiguous' : candidates.length ? 'candidate' : 'not_found',
      match_basis: 'normalized_name_only', verified: false, candidates};
  });
}

export function parseGgFirmResponse(payload) {
  const parts = payload?.Buildofc;
  if (!Array.isArray(parts)) {
    if (payload?.RESULT?.CODE === 'INFO-200') return {total: 0, rows: []};
    throw new Error('경기 사무소 API 응답 오류: 인증·서비스 상태를 확인하세요.');
  }
  const head = parts.flatMap(part => part.head ?? []);
  if (head.find(item => item.RESULT)?.RESULT?.CODE !== 'INFO-000') throw new Error('경기 사무소 API가 정상 응답하지 않았습니다.');
  const total = count(head.find(item => Object.hasOwn(item, 'list_total_count'))?.list_total_count);
  const rows = parts.flatMap(part => part.row ?? []);
  if (total === null || !rows.every(row => row && typeof row === 'object')) throw new Error('경기 사무소 API 건수·행 형식이 바뀌었습니다.');
  return {total, rows};
}

export function parseBuildingResponse(payload) {
  const response = payload?.response;
  if (!['00', '000', '0'].includes(String(response?.header?.resultCode))) throw new Error('건축물대장 API 응답 오류: 인증·서비스 상태를 확인하세요.');
  const total = count(response.body?.totalCount);
  const item = response.body?.items?.item;
  const rows = item === undefined || item === null ? [] : Array.isArray(item) ? item : [item];
  if (total === null || !rows.every(row => row && typeof row === 'object')) throw new Error('건축물대장 API 건수·행 형식이 바뀌었습니다.');
  return {total, rows};
}

export function validateParcel(parcel) {
  if (!text(parcel?.school_id) || !/^41\d{3}$/.test(parcel.sigunguCd ?? '') || !/^\d{5}$/.test(parcel.bjdongCd ?? '') ||
      !/^[012]$/.test(parcel.platGbCd ?? '0') || !/^\d{4}$/.test(parcel.bun ?? '') || !/^\d{4}$/.test(parcel.ji ?? '')) {
    throw new Error('건물 조회에는 학교 식별자와 확인된 경기 시군구·법정동·대지구분·본번/부번 코드가 필요합니다.');
  }
  return {school_id: parcel.school_id, sigunguCd: parcel.sigunguCd, bjdongCd: parcel.bjdongCd,
    platGbCd: parcel.platGbCd ?? '0', bun: parcel.bun, ji: parcel.ji};
}

export function normalizeOfficialBuilding(row, parcel, retrievedAt) {
  const p = validateParcel(parcel);
  if (!text(String(row?.mgmBldrgstPk ?? ''))) throw new Error('건축물대장 응답에 관리번호가 없습니다.');
  // API가 요청한 필지를 무시하거나 코드 형식이 달라지면 다른 학교에 연결하지 않는다.
  for (const key of ['sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji']) {
    const length = {sigunguCd: 5, bjdongCd: 5, platGbCd: 1, bun: 4, ji: 4}[key];
    if (String(row[key] ?? '').padStart(length, '0') !== p[key]) throw new Error('건축물대장 응답과 요청 필지가 다릅니다. 자동 연결을 중단합니다.');
  }
  const raw = String(row.useAprDay ?? '').trim();
  const approvalDate = /^[1-9]\d{7}$/.test(raw) ? date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`) : null;
  const dateIssue = !approvalDate ? '사용승인일 미확인·형식 확인 필요' : approvalDate > retrievedAt.slice(0, 10) ? '사용승인일이 조회일 이후 — 확인 필요' : null;
  return {
    official_building_id: String(row.mgmBldrgstPk), requested_school_id: p.school_id,
    name: text(row.bldNm), wing_name: text(row.dongNm), main_use: text(row.mainPurpsCdNm),
    road_address: text(row.newPlatPlc), lot_address: text(row.platPlc),
    use_approval_date: dateIssue ? null : approvalDate, raw_use_approval_date: text(raw),
    date_basis: 'useAprDay', data_created_date: text(row.crtnDay), retrieved_at: retrievedAt,
    match_status: 'parcel_candidate', verified: false, date_issue: dateIssue,
    source_id: OFFICIAL_SOURCES.buildings.id,
  };
}

// Count only usable normalized approval dates. Opening/registry-creation dates
// cannot fill a missing useAprDay, and this does not approve a school/building match.
export function buildingDateCoverage(records) {
  const available = records.filter(row => row.date_basis === 'useAprDay' && date(row.use_approval_date) && !row.date_issue).length;
  return {approval_date_available_count: available, approval_date_missing_count: records.length - available};
}

async function requestJson(url, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, {signal: AbortSignal.timeout(25_000)}); }
  catch { throw new Error('공식 API 연결에 실패했습니다. 이전 결과를 유지합니다.'); }
  if (!response.ok) throw new Error(`공식 API HTTP ${response.status}: 인증·사용량·서비스 상태를 확인하세요.`);
  try { return await response.json(); } catch { throw new Error('공식 API가 JSON 대신 다른 형식으로 응답했습니다. 이전 결과를 유지합니다.'); }
}

export async function fetchOfficialFirms({key, sample = false, fetchImpl = fetch, maxPages = 100} = {}) {
  if (!sample && !text(key)) throw new Error('GG_OPEN_API_KEY가 필요합니다. 키 없는 시험은 --sample을 사용하세요.');
  const all = []; let total = null; const seenPages = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(OFFICIAL_SOURCES.firms.endpoint);
    url.search = new URLSearchParams({...(!sample ? {KEY: key} : {}), Type: 'json', pIndex: String(page), pSize: sample ? '5' : '1000'});
    const parsed = parseGgFirmResponse(await requestJson(url, fetchImpl));
    if (total !== null && total !== parsed.total) throw new Error('수집 중 공식 사무소 총건수가 바뀌었습니다. 다시 실행하세요.');
    total = parsed.total;
    const signature = JSON.stringify(parsed.rows);
    if (seenPages.has(signature)) throw new Error('API가 같은 페이지를 반복했습니다. 인증·페이지 처리를 확인하세요.');
    seenPages.add(signature); all.push(...parsed.rows.map(normalizeOfficialFirm));
    if (sample || all.length === total) return {rows: all, total, scope: sample ? 'sample_only' : 'complete'};
    if (!parsed.rows.length || all.length > total) throw new Error('공식 사무소 응답 건수가 총건수와 일치하지 않습니다.');
  }
  throw new Error('공식 사무소 수집의 안전 페이지 한도를 넘었습니다.');
}

export async function fetchOfficialBuildings({key, parcels, fetchImpl = fetch, retrievedAt = new Date().toISOString(), maxPages = 100} = {}) {
  if (!text(key)) throw new Error('DATA_GO_KR_SERVICE_KEY가 필요합니다.');
  if (!Array.isArray(parcels) || !parcels.length) throw new Error('확인된 학교별 필지 목록이 필요합니다.');
  const validated = parcels.map(validateParcel); const result = [];
  for (const parcel of validated) {
    let count = 0; let total = null; let complete = false; const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const {school_id, ...codes} = parcel;
      const url = new URL(OFFICIAL_SOURCES.buildings.endpoint);
      // data.go.kr의 일반 인증키(Decoding)를 사용한다.
      url.search = new URLSearchParams({...codes, serviceKey: key, _type: 'json', numOfRows: '100', pageNo: String(page)});
      const parsed = parseBuildingResponse(await requestJson(url, fetchImpl));
      if (total !== null && total !== parsed.total) throw new Error('수집 중 건물 총건수가 바뀌었습니다. 다시 실행하세요.');
      total = parsed.total;
      const signature = JSON.stringify(parsed.rows);
      if (seen.has(signature)) throw new Error('건축물대장 API가 같은 페이지를 반복했습니다.');
      seen.add(signature); count += parsed.rows.length;
      result.push(...parsed.rows.map(row => normalizeOfficialBuilding(row, parcel, retrievedAt)));
      if (count === total) { complete = true; break; }
      if (!parsed.rows.length || count > total) throw new Error('건축물대장 응답 건수가 총건수와 다릅니다.');
    }
    if (!complete) throw new Error('건축물대장 수집의 안전 페이지 한도를 넘었습니다.');
  }
  return result;
}
