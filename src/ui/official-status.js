import {el, safeUrl} from './dom.js';
import {CONNECTIONS, STATUS_LABELS, publicConnectionState} from '../integrations/connection-state.js';

export function connectionText(service, kind) {
  if (!service) return '연결 상태 미확인';
  const count = service.retrieved_count ?? service.sample_count;
  const label = Number.isSafeInteger(count) && count >= 0 ? `${count}건` : '건수 미확인';
  if (service.method === 'official_bulk_download' && service.status === 'candidates_ready' && service.complete) return `공식 CSV 다운로드 ${label} · 지역·연령·월별 관측값`;
  const normalizedCounts = [service.raw_count, service.retrieved_count, service.quarantined_count].every(value => Number.isSafeInteger(value) && value >= 0) &&
    service.raw_count === service.retrieved_count + service.quarantined_count;
  if (normalizedCounts && (['sample_only', 'subset_only'].includes(service.status) || service.status === 'candidates_ready' && service.complete)) {
    const format = number => number.toLocaleString('ko-KR');
    const counts = `응답 ${format(service.raw_count)}행 · 정규화 ${format(service.retrieved_count)}행 · 식별 검토 보류 ${format(service.quarantined_count)}행`;
    if (service.status === 'sample_only') return `시험 ${counts} · 전체 조회 아님`;
    if (service.status === 'subset_only') return `선택 지역 ${counts} · 전체 조회 아님 · 연결 검토 전`;
    return `${counts} · ${kind === 'firms' ? '사무소·사업' : '학교·사업'} 연결 검토 전`;
  }
  if (service.status === 'sample_only') return `시험 응답 ${label} · 전체 조회 아님`;
  if (service.status === 'subset_only') return `선택 지역 ${label} 조회 · 전체 조회 아님 · 연결 검토 전`;
  if (service.status === 'candidates_ready') return service.complete ? `요청 범위 ${label} 조회 · 학교·사업 연결 검토 전` : '연결 상태 미확인';
  return STATUS_LABELS[service.status] ?? '연결 상태 미확인';
}

export function buildingCoverageText(service) {
  if (service?.status !== 'candidates_ready' || !service.complete) return null;
  const {retrieved_count: count, approval_date_available_count: available, approval_date_missing_count: missing} = service;
  if (![count, available, missing].every(value => Number.isSafeInteger(value) && value >= 0) || count !== available + missing) return null;
  if (!count) return '조회한 필지에서 건물 응답이 없습니다. 학교 전체의 건물 수를 뜻하지 않습니다.';
  return `건물 후보 ${count}건 · 사용승인일 제공 ${available}건 · 미확인 ${missing}건. ${available === 0 ? '사용승인일이 없어 건물 연령을 계산할 수 없습니다.' : '학교·건물 동일성을 확인한 뒤 연령 계산에 사용합니다.'}`;
}

export function renderConnections(container, enrichment) {
  const valid = enrichment?.schema_version === 'official-enrichment-1';
  const state = publicConnectionState(enrichment);
  const cards = Object.entries(CONNECTIONS).map(([kind, item]) => {
    const service = valid ? state.services[kind] : null;
    const buildingCoverage = kind === 'buildings' ? buildingCoverageText(service) : null;
    return el('article', {class: 'api-connection-card'}, [el('h3', {}, item.title),
      el('p', {class: 'api-state'}, connectionText(service, kind)), el('p', {}, item.purpose),
      buildingCoverage ? el('p', {class: 'small'}, buildingCoverage) : null,
      service?.selection ? el('small', {}, `${service.selection.municipalities}개 시·군 · ${service.selection.months.join(', ')} · 연령별 셀 수`) : null,
      service?.geography ? el('small', {}, `현재 코드표 ${service.geography.queried_districts}/${service.geography.official_sgg_count}개 시·군·구 · 과거 행정경계 통계와 구분`) : null,
      service?.queried_parcels !== undefined ? el('small', {}, `확인한 학교 지번 ${service.queried_parcels}곳 · 경기도 전체 아님`) : null,
      service?.checked_at ? el('small', {}, `조회 확인 ${service.checked_at.slice(0, 10)}${service.year ? ` · 공시연도 ${service.year}` : ''}`) : null,
      el('a', {href: service?.source_url ?? item.url, target: '_blank', rel: 'noopener noreferrer'}, service?.method === 'official_bulk_download' ? '공식 자료 내려받기 ↗' : '공식 API 안내 ↗')]);
  });
  container.replaceChildren(el('summary', {}, '공식 데이터 연결 현황 · 학교·시설·사무소·건물·인구'),
    el('p', {}, '아래는 외부 데이터의 수집 상태입니다. 조회 결과를 확인한 뒤 작품집 사례와 연결하므로, 아카이브의 학교·건물 집계와 수가 다를 수 있습니다.'),
    el('div', {class: 'api-connection-grid'}, cards),
    el('a', {href: 'docs/API_SETUP.md', target: '_blank', rel: 'noopener noreferrer'}, '인증키 발급·연결 순서 ↗'));
}

/** Public connection status; unreviewed matches never become confirmed records. */
export function officialStatus(kind, enrichment) {
  const service = enrichment?.schema_version === 'official-enrichment-1' ? publicConnectionState(enrichment).services[kind] : null;
  const title = kind === 'firms' ? '경기도 건축사사무소 공식 정보' : '건물별 사용승인일 연결';
  const text = connectionText(service, kind);
  const buildingCoverage = kind === 'buildings' ? buildingCoverageText(service) : null;
  const panel = el('aside',{class:'connection-status'},el('div',{},[el('strong',{},title),el('p',{},text),
    buildingCoverage ? el('p',{class:'small'},buildingCoverage) : null]));
  const url = safeUrl(service?.source_url);
  if (url) panel.append(el('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'공식 자료 안내 ↗'));
  const details = el('details',{class:'external-data-details'},[el('summary',{},'연결 방법과 제공 범위'),
    el('p',{},kind === 'firms' ? '사무소명·주소·신고 구분을 조회합니다. 사업자번호·홈페이지·영업 상태는 이 API가 제공하지 않습니다. 같은 이름도 확인 전에는 연결 후보로만 표시합니다.' : '학교 개교일과 건물 사용승인일을 구분합니다. 학교에 건물이 여러 동 있으면 각 동의 날짜와 식별자를 확인합니다.'),
    el('p',{},'인증키는 공개 웹페이지에 넣지 않고 로컬 수집 도구에서 사용합니다. 조회한 후보를 검토한 뒤 공개용 결과를 갱신합니다.'),
    el('a',{href:'https://github.com/yunzecho-eng/school-design-trends/blob/main/docs/OFFICIAL_DATA.md',target:'_blank',rel:'noopener noreferrer'},'설정 안내와 연결 현황 ↗')]);
  if (service?.checked_at) details.append(el('p',{class:'small'},`접속 확인: ${service.checked_at} · 원자료 기준일: ${service.source_date || '미제공'}`));
  return el('div',{},[panel,details]);
}

export function firmCandidates(firmId, enrichment) {
  const match = enrichment?.firm_matches?.find(item => item.firm_id === firmId);
  if (!match || !Array.isArray(match.candidates) || !match.candidates.length) return null;
  return el('details',{class:'firm-match-candidate'},[
    el('summary',{},`공식 자료 일치 후보 ${match.candidates.length}곳 · 확인 전`),
    el('p',{},'작품집 참여 사무소와 동일한 곳인지 주소·등록정보를 대조해야 합니다.'),
    el('ul',{},match.candidates.map(c => el('li',{},[c.name,c.road_address || c.lot_address,c.organization_type].filter(v => typeof v === 'string').join(' · '))))]);
}
