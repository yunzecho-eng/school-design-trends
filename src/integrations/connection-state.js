// Browser-safe connection metadata. Never pass process.env or raw API errors here.
export const CONNECTIONS = Object.freeze({
  neis: {title: '나이스 · 학교 기본정보', env: 'NEIS_API_KEY', url: 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2', purpose: '학교 코드·주소·홈페이지를 대조합니다. 설립일은 건물 나이가 아닙니다.'},
  schoolinfo: {title: '학교알리미 · 학생·시설', env: 'SCHOOLINFO_API_KEY', url: 'https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_m0.do', purpose: '경기 초·중·고의 기본정보와 학생·교실·지원시설·개방 5개 항목입니다. 수집 건수는 항목별 레코드 합입니다.'},
  firms: {title: '경기데이터드림 · 사무소', env: 'GG_OPEN_API_KEY', url: 'https://www.data.go.kr/data/15057636/openapi.do', purpose: '경기 소재 사무소의 이름·주소를 대조합니다. 사업자번호는 제공하지 않습니다.'},
  buildings: {title: '건축HUB · 건물 연령', env: 'DATA_GO_KR_SERVICE_KEY', url: 'https://www.data.go.kr/data/15134735/openapi.do', purpose: '확인된 학교 지번의 동별 사용승인일을 조회합니다.'},
  kosis: {title: 'KOSIS · 학령기 인구', env: 'KOSIS_API_KEY', url: 'https://kosis.kr/openapi/devGuide/devGuide_0201List.do', purpose: '시군구별 6–17세 주민등록인구를 비교합니다. 재학생 수·예측값과 구분합니다.'},
});

export const STATUS_LABELS = Object.freeze({
  key_required: '인증키 필요', key_and_parcel_required: '인증키·학교 지번 필요',
  key_and_config_required: '인증키·통계 조건 필요', parcel_required: '학교 지번 확인 필요',
  config_required: '통계 조건 확인 필요', sample_only: '시험 응답 확인',
  candidates_ready: '조회 완료 · 연결 검토 필요', error: '조회 실패 · 재확인 필요',
  not_checked: '연결 상태 미확인',
});
const initialStatus = kind => kind === 'buildings' ? 'key_and_parcel_required' : kind === 'kosis' ? 'key_and_config_required' : 'key_required';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value) && Number.isFinite(Date.parse(value));
const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

export function createConnectionState() {
  return {schema_version: 'official-enrichment-1', services: Object.fromEntries(Object.entries(CONNECTIONS).map(([kind, item]) => [kind, {
    status: initialStatus(kind), complete: false, source_url: item.url, required_env: item.env,
  }]))};
}

export function prerequisite(kind, env, {sample = false, parcels, config} = {}) {
  if (!CONNECTIONS[kind]) throw new Error('지원하지 않는 데이터 종류입니다.');
  if (sample && ['neis', 'schoolinfo', 'firms'].includes(kind)) return null;
  if (!env[CONNECTIONS[kind].env]?.trim()) return initialStatus(kind);
  if (kind === 'buildings' && !parcels) return 'parcel_required';
  if (kind === 'kosis' && !config) return 'config_required';
  return null;
}

/** Allowlist export: no raw records, matches, custom URLs, errors or credentials. */
export function publicConnectionState(input) {
  const output = createConnectionState();
  if (input?.schema_version !== output.schema_version) return output;
  if (validDate(input.checked_at)) output.checked_at = input.checked_at;
  for (const kind of Object.keys(CONNECTIONS)) {
    const source = input.services?.[kind];
    if (!source || !Object.hasOwn(STATUS_LABELS, source.status)) continue;
    const target = output.services[kind];
    target.status = source.status;
    target.complete = source.status === 'candidates_ready' && source.complete === true;
    if (source.status === 'candidates_ready' && !target.complete) target.status = 'not_checked';
    target.review_status = 'candidate_only';
    for (const key of ['checked_at', 'last_success_at', 'source_date']) if (validDate(source[key])) target[key] = source[key];
    if (source.last_attempt?.status === 'error' && validDate(source.last_attempt.checked_at)) {
      target.status = 'error';
      target.complete = false;
      target.checked_at = source.last_attempt.checked_at;
    }
    // Counts describe the latest successful request only, never a failed/missing request.
    if (['sample_only', 'candidates_ready'].includes(target.status)) {
      for (const key of ['retrieved_count', 'source_total', 'sample_count', 'queried_parcels']) if (validCount(source[key])) target[key] = source[key];
      if (typeof source.year === 'string' && /^20\d{2}$/.test(source.year)) target.year = source.year;
      if (kind === 'kosis' && validCount(source.selection?.municipalities) && Array.isArray(source.selection?.months)) {
        target.selection = {municipalities: source.selection.municipalities, ages: '6–17', months: source.selection.months.filter(m => typeof m === 'string' && /^20\d{2}(0[1-9]|1[0-2])$/.test(m)).slice(0, 36)};
      }
    }
  }
  return output;
}
