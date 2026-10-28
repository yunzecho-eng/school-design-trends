// Official public bulk-download channel, distinct from authenticated KOSIS OpenAPI.
// No files are written here: callers publish only after every archive validates.
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {KOSIS_SOURCE, validateKosisConfig, parseKosisPopulation} from './kosis.js';

const DOWNLOAD = 'https://kosis.kr/file_mass/file_down.jsp';
const MAX_ZIP = 8 * 1024 * 1024;
const MAX_CSV = 64 * 1024 * 1024;
const HEADERS = ['C행정구역(시군구)별', '행정구역(시군구)별', 'C연령별', '연령별', '시점', '총인구수 (명)', '남자인구수 (명)', '여자인구수 (명)'];
const fail = message => { throw new Error(`KOSIS 공개 대량자료 ${message}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unquoteCode = value => value.startsWith("'") ? value.slice(1) : value;
const decodeKorean = bytes => {
  try { return new TextDecoder('euc-kr', {fatal: true}).decode(bytes).replace(/^\uFEFF/u, ''); }
  catch { fail('문자 인코딩을 확인하세요.'); }
};

async function download(url, maxBytes, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, {signal: AbortSignal.timeout(30000), redirect: 'error'}); }
  catch { fail('연결하지 못했습니다. 이전 결과를 유지하세요.'); }
  if (!response?.ok) fail('HTTP 응답 오류입니다.');
  const declared = response.headers?.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) fail('다운로드 크기가 허용 범위를 넘었습니다.');
  const chunks = [];
  let size = 0;
  try {
    if (!response.body?.getReader) fail('스트림 응답이 아닙니다.');
    const reader = response.body.getReader();
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); fail('다운로드 크기가 허용 범위를 넘었습니다.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  } catch { fail('다운로드가 중단됐거나 크기 제한을 넘었습니다.'); }
  return Buffer.concat(chunks, size);
}

function* csvRows(source) {
  let cells = [], cell = '', quoted = false, closed = false;
  const add = () => { cells.push(cell); cell = ''; closed = false; if (cells.length > 20) fail('CSV 열 수가 비정상입니다.'); };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ',') add();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      add(); yield cells; cells = [];
    } else if (closed || char === '"') fail('CSV 따옴표 형식을 확인하세요.');
    else cell += char;
    if (cell.length > 4096) fail('CSV 필드 크기가 비정상입니다.');
  }
  if (quoted) fail('CSV 따옴표가 닫히지 않았습니다.');
  if (cell || cells.length || closed) { add(); yield cells; }
}

const crcTable = Array.from({length: 256}, (_, start) => {
  let value = start;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

export function extractKosisCsv(archive, expectedName) {
  const zip = Buffer.from(archive);
  if (!/^101_DT_1B04006_M_\d{4}\.csv$/.test(expectedName) || zip.length < 22 || zip.length > MAX_ZIP) fail('ZIP 파일명·크기를 확인하세요.');
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length) { end = offset; break; }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0 || zip.readUInt16LE(end + 8) !== 1 || zip.readUInt16LE(end + 10) !== 1) fail('단일 CSV ZIP 구조가 아닙니다.');
  const directorySize = zip.readUInt32LE(end + 12), directory = zip.readUInt32LE(end + 16);
  if (directory + directorySize !== end || directorySize < 46 || directory + 46 > end || zip.readUInt32LE(directory) !== 0x02014b50) fail('ZIP 디렉터리가 올바르지 않습니다.');
  const flags = zip.readUInt16LE(directory + 8), compression = zip.readUInt16LE(directory + 10);
  const expectedCrc = zip.readUInt32LE(directory + 16), compressedSize = zip.readUInt32LE(directory + 20), size = zip.readUInt32LE(directory + 24);
  const nameSize = zip.readUInt16LE(directory + 28), extraSize = zip.readUInt16LE(directory + 30), commentSize = zip.readUInt16LE(directory + 32);
  const local = zip.readUInt32LE(directory + 42);
  if (flags & 1 || ![0, 8].includes(compression) || size > MAX_CSV || compressedSize > MAX_ZIP || !size ||
      zip.readUInt16LE(directory + 34) !== 0 || 46 + nameSize + extraSize + commentSize !== directorySize ||
      zip.subarray(directory + 46, directory + 46 + nameSize).toString('ascii') !== expectedName) fail('ZIP 압축 방식·이름·크기를 확인하세요.');
  if (local + 30 > directory || zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== compression) fail('ZIP 로컬 헤더가 일치하지 않습니다.');
  const localNameSize = zip.readUInt16LE(local + 26), localExtraSize = zip.readUInt16LE(local + 28);
  const dataStart = local + 30 + localNameSize + localExtraSize;
  if (zip.subarray(local + 30, local + 30 + localNameSize).toString('ascii') !== expectedName || dataStart + compressedSize > directory) fail('ZIP 데이터 범위가 올바르지 않습니다.');
  let output;
  try { output = compression === 8 ? inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize), {maxOutputLength: MAX_CSV}) : zip.subarray(dataStart, dataStart + compressedSize); }
  catch { fail('ZIP 압축을 해제하지 못했습니다.'); }
  if (output.length !== size || crc32(output) !== expectedCrc) fail('ZIP 크기·CRC 검증에 실패했습니다.');
  return output;
}

function archiveUrl({year, fileNo} = {}) {
  const url = new URL(DOWNLOAD);
  url.search = new URLSearchParams({tbl_id: 'DT_1B04006', org_id: '101',
    filename: year ? `101_DT_1B04006_M_${year}` : '', file_no: fileNo ?? '', file_type: year ? 'ONE' : 'META',
    vw_cd: 'MT_ZTITLE', list_id: 'A_7', usrId: 'null', usrName: 'null', down_cnt: '1', use_no: '0', page: 'kosis'}).toString();
  return url;
}

function publishedArchives(html) {
  const archives = new Map();
  for (const tag of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = new Map([...tag[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]));
    if (!/^file_data_\d+$/.test(attributes.get('name') ?? '')) continue;
    const match = /^(\d{1,10})\/101_DT_1B04006_M_(\d{4})$/.exec(attributes.get('value') ?? '');
    if (!match || archives.has(match[2])) fail('공식 목록의 연도별 파일 식별자가 올바르지 않습니다.');
    archives.set(match[2], {year: match[2], fileNo: match[1]});
  }
  if (!archives.size) fail('공식 목록에서 공개 파일을 찾지 못했습니다.');
  return archives;
}

function verifyMetadata(source, config) {
  if (!source.includes('* 통계표ID : DT_1B04006') || !source.includes(KOSIS_SOURCE.title)) fail('메타자료 통계표가 다릅니다.');
  const marker = source.indexOf('[분류/항목 정보]');
  if (marker < 0) fail('공식 분류 코드표가 없습니다.');
  const rows = [...csvRows(source.slice(marker + '[분류/항목 정보]'.length))].filter(row => row.length >= 6 && row[0].startsWith("'"));
  const axes = [...new Set(rows.filter(row => row[1] !== '항목').map(row => unquoteCode(row[0])))];
  if (axes.join('|') !== 'A|YRE') fail('공식 분류축이 변경됐습니다.');
  const found = (axis, code) => rows.filter(row => unquoteCode(row[0]) === axis && unquoteCode(row[2]) === code);
  for (const region of config.regions) {
    const matches = found('A', region.code);
    if (matches.length !== 1 || matches[0][3].trim() !== region.name || !/^41\d{3}$/.test(region.code) || !/[시군]$/.test(region.name)) fail('설정 지역이 공식 경기도 시·군과 일치하지 않습니다.');
  }
  for (const age of config.ages) {
    const matches = found('YRE', age.code);
    if (matches.length !== 1 || matches[0][3].trim() !== `${age.age}세`) fail('설정 연령이 공식 코드표와 일치하지 않습니다.');
  }
  const item = rows.filter(row => row[1] === '항목' && unquoteCode(row[2]) === 'T2');
  if (item.length !== 1 || item[0][3] !== '총인구수' || item[0][4] !== '명') fail('총인구수 항목과 단위를 확인하세요.');
  return /파일생성일자\s*:\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/.exec(source)?.[1] ?? null;
}

function countValue(value) {
  const raw = value.trim();
  if (['', '-', '...', '…', '*', 'x', 'X'].includes(raw)) return null;
  if (!/^\d+(?:\.0+)?$/.test(raw)) fail('CSV 인구 값이 정수가 아닙니다.');
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) fail('CSV 인구 값 범위를 확인하세요.');
  return number;
}

export function parseKosisBulkCsv(source, config, year) {
  validateKosisConfig(config);
  const selectedMonths = config.months.filter(month => month.startsWith(year));
  const months = new Map(selectedMonths.map(month => [month, []]));
  const regions = new Set(config.regions.map(region => region.code));
  const ages = new Set(config.ages.map(age => age.code));
  let title = false, header = false;
  for (const row of csvRows(source)) {
    if (row.length === 1 && !row[0].trim()) continue;
    if (!title) { if (row.length !== 1 || row[0] !== KOSIS_SOURCE.title) fail('CSV 통계표 제목이 다릅니다.'); title = true; continue; }
    if (!header) { if (JSON.stringify(row) !== JSON.stringify(HEADERS)) fail('CSV 열·총인구 항목·단위가 변경됐습니다.'); header = true; continue; }
    if (row.length !== HEADERS.length) fail('CSV 열 수가 일치하지 않습니다.');
    const region = unquoteCode(row[0]), age = unquoteCode(row[2]);
    if (!months.has(row[4]) || !regions.has(region) || !ages.has(age)) continue;
    const total = countValue(row[5]), male = countValue(row[6]), female = countValue(row[7]);
    if ([total, male, female].every(value => value !== null) && total !== male + female) fail('총인구와 남녀 인구 합계가 일치하지 않습니다.');
    months.get(row[4]).push({ORG_ID: '101', TBL_ID: 'DT_1B04006', PRD_SE: 'M', PRD_DE: row[4],
      C1: region, C1_NM: row[1].trim(), C1_OBJ_NM: '행정구역(시군구)별',
      C2: age, C2_NM: row[3].trim(), C2_OBJ_NM: '연령별', ITM_ID: 'T2', ITM_NM: '총인구수', UNIT_NM: '명', DT: row[5], LST_CHN_DE: null});
  }
  if (!header || !selectedMonths.length) fail('선택한 연도의 CSV 자료가 없습니다.');
  return selectedMonths.sort().flatMap(month => parseKosisPopulation(months.get(month), config, month));
}

export async function fetchKosisBulkPopulation({config, fetchImpl = fetch, retrievedAt = new Date().toISOString()} = {}) {
  validateKosisConfig(config);
  if (config.dimensions.region !== 'C1' || config.dimensions.age !== 'C2' || config.item.code !== 'T2' || config.item.name !== '총인구수' || Object.keys(config.fixedSelections ?? {}).length) fail('공개 CSV의 지역·연령·총인구 선택과 설정이 다릅니다.');
  if (typeof retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) fail('조회일 형식을 확인하세요.');
  const years = [...new Set(config.months.map(month => month.slice(0, 4)))].sort();
  if (years.length > 6) fail('한 번에 최대 6개 연도만 내려받습니다.');
  const listBytes = await download(KOSIS_SOURCE.url, 1024 * 1024, fetchImpl);
  const archives = publishedArchives(new TextDecoder('utf-8', {fatal: true}).decode(listBytes));
  if (years.some(year => !archives.has(year))) fail('요청 연도가 현재 공식 공개 목록에 없습니다.');
  const metaUrl = archiveUrl();
  const metadata = await download(metaUrl, 2 * 1024 * 1024, fetchImpl);
  const releaseCreatedAt = verifyMetadata(decodeKorean(metadata), config);
  const sources = [{kind: 'metadata', url: metaUrl.href, sha256: hash(metadata), filename: '101_DT_1B04006_meta.csv'}];
  const rows = [];
  for (const year of years) {
    const url = archiveUrl(archives.get(year));
    const zip = await download(url, MAX_ZIP, fetchImpl);
    const filename = `101_DT_1B04006_M_${year}.csv`;
    const csv = extractKosisCsv(zip, filename);
    rows.push(...parseKosisBulkCsv(decodeKorean(csv), config, year).map(row => ({...row,
      source_method: 'official_bulk_download', source_url: url.href, retrieved_at: retrievedAt})));
    sources.push({kind: 'archive', year, url: url.href, archive_sha256: hash(zip), csv_sha256: hash(csv), filename});
  }
  return {
    rows, total: rows.length, source_total: null, scope: 'complete', scope_basis: 'configured_municipalities_ages_months',
    method: 'official_bulk_download', authenticated_api: false, retrieved_at: retrievedAt,
    source_id: KOSIS_SOURCE.id, source_url: KOSIS_SOURCE.url, sources, release_created_at: releaseCreatedAt,
    selection: {province: '경기도', municipalities: config.regions.length, ages: '6–17', months: [...config.months].sort()},
    limitations: [
      '인증키가 필요 없는 KOSIS 공식 공개 대량자료를 내려받았습니다. OpenAPI 인증 성공을 뜻하지 않습니다.',
      '선택한 시·군·월의 6–17세 주민등록인구이며 재학생 수나 미래 예측이 아닙니다.',
      '시·군 전체만 선택하고 하위 구·출장소·경기도 전체 행을 중복 합산하지 않습니다.',
      '지역 경계 변경을 확인하기 전에는 자동 증감·수요 예측을 산출하지 않습니다.',
      '생성일은 배포 파일 메타정보이며 각 관측치의 수정일은 확인되지 않아 null입니다.',
    ],
  };
}
