import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {fetchKosisBulkPopulation, extractKosisCsv, parseKosisBulkCsv} from '../../src/integrations/kosis-bulk.js';
import {KOSIS_SOURCE} from '../../src/integrations/kosis.js';

const reviewed = JSON.parse(await readFile(new URL('../../data/config/kosis-population.example.json', import.meta.url), 'utf8'));
const config = () => ({...structuredClone(reviewed), regions: [structuredClone(reviewed.regions[0])]});
// Small CP949 fixtures using the official metadata/header shape, not API responses.
const metadata = Buffer.from('KiDF67Dox6VJRCA6IERUXzFCMDQwMDYKKiDF67Dox6W47SA6IMfgwaSxuL+qKL3DsbqxuCm6sC8xvLy6sCDB1rnOte63z8DOsbgKKiDGxMDPu/28usDPwNogOiAyMDI2LzEwLzA2IDA5OjEwOjE2Clu60Lf5L8fXuPEgwaS6uF0KutC3+cTateUsutC3+S/H17jxuO0sutC3+bCqLLrQt/mwqrjtLLTcwKcssKHB38ShCidBLMfgwaSxuL+qKL3DsbqxuCm6sCwnNDExMTAsvPa/+L3DLCwKJ1lSRSy/rLfJurAsJzA1MDIsNry8LCwKJ1lSRSy/rLfJurAsJzA1MDMsN7y8LCwKJ1lSRSy/rLfJurAsJzA1MDQsOLy8LCwKJ1lSRSy/rLfJurAsJzA1MDUsOby8LCwKJ1lSRSy/rLfJurAsJzA3MDEsMTC8vCwsCidZUkUsv6y3ybqwLCcwNzAyLDExvLwsLAonWVJFLL+st8m6sCwnMDcwMywxMry8LCwKJ1lSRSy/rLfJurAsJzA3MDQsMTO8vCwsCidZUkUsv6y3ybqwLCcwNzA1LDE0vLwsLAonWVJFLL+st8m6sCwnMTAwMSwxNby8LCwKJ1lSRSy/rLfJurAsJzEwMDIsMTa8vCwsCidZUkUsv6y3ybqwLCcxMDAzLDE3vLwsLAonMTM5OTkwMDEsx9e48SwnVDIsw9HAzrG4vPYsuO0sCg==', 'base64');
const csvHeader = Buffer.from('x+DBpLG4v6oovcOxurG4KbqwLzG8vLqwIMHWuc617rfPwM6xuAoKQ8fgwaSxuL+qKL3DsbqxuCm6sCzH4MGksbi/qii9w7G6sbgpurAsQ7+st8m6sCy/rLfJurAsvcPBoSzD0cDOsbi89iAouO0pLLOywNrAzrG4vPYgKLjtKSy/qcDawM6xuLz2ICi47SkK', 'base64');
const fixtureCsv = year => Buffer.concat([csvHeader, ...reviewed.ages.flatMap(({code, age}) => [
  Buffer.from("'41110,"), Buffer.from('ILz2v/i9ww==', 'base64'), Buffer.from(`,'${code},${age}`),
  Buffer.from('vLw=', 'base64'), Buffer.from(`,${year}12,8820.0000,4587.0000,4233.0000\r\n`),
])]);
function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipFile(name, data, compression = 8) {
  const filename = Buffer.from(name), compressed = compression === 8 ? deflateRawSync(data) : data;
  const crc = checksum(data);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(compression, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26); filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(compression, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28); filename.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}
const listing = ['2023', '2024', '2025'].map((year, index) => `<input name="file_data_${index}" value="${8000 + index}/101_DT_1B04006_M_${year}">`).join('\n');
const mockFetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://kosis.kr');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal);
  assert.equal(url.searchParams.has('apiKey'), false);
  if (url.pathname.endsWith('mass_list.jsp')) return new Response(listing);
  if (url.searchParams.get('file_type') === 'META') return new Response(metadata);
  const year = url.searchParams.get('filename').slice(-4);
  return new Response(zipFile(`101_DT_1B04006_M_${year}.csv`, fixtureCsv(year)));
};

test('public bulk download needs no key, preserves source method and only returns after three complete archives', async () => {
  const calls = [];
  const actual = await fetchKosisBulkPopulation({config: config(), retrievedAt: '2026-10-28T10:00:00.000Z', fetchImpl: async (...args) => {
    calls.push(new URL(args[0]).href); return mockFetch(...args);
  }});
  assert.equal(calls.length, 5);
  assert.equal(actual.method, 'official_bulk_download');
  assert.equal(actual.authenticated_api, false);
  assert.equal(actual.scope, 'complete');
  assert.equal(actual.total, 36);
  assert.equal(actual.sources.length, 4);
  assert.equal(actual.release_created_at, '2026/10/06 09:10:16');
  assert.equal(actual.rows[0].value, 8820);
  assert.equal(actual.rows[0].raw_value, '8820.0000');
  assert.equal(actual.rows[0].source_updated_at, null);
  assert.equal(actual.rows[0].source_method, 'official_bulk_download');
  assert.equal(actual.rows[0].retrieved_at, actual.retrieved_at);
  assert.ok(actual.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256 ?? source.csv_sha256)));
  assert.match(actual.limitations[0], /OpenAPI 인증 성공을 뜻하지 않습니다/);
});

test('full reviewed config selects exactly 31 x 12 x 3 observations without adding provincial or district totals', () => {
  const header = new TextDecoder('euc-kr').decode(csvHeader);
  const all = [];
  for (const year of ['2023', '2024', '2025']) {
    const lines = reviewed.regions.flatMap(region => reviewed.ages.map(age => `'${region.code}, ${region.name},'${age.code},${age.age}세,${year}12,3.0000,1.0000,2.0000`));
    lines.push(`'41,경기도,'0502,6세,${year}12,999,999,0`, `'41111,장안구,'0502,6세,${year}12,999,999,0`);
    all.push(...parseKosisBulkCsv(`${header}${lines.join('\n')}`, reviewed, year));
  }
  assert.equal(all.length, 1116);
  assert.equal(new Set(all.map(row => row.population_id)).size, 1116);
  assert.ok(all.every(row => row.value === 3 && row.region_level === 'municipality'));
});

test('ZIP parser rejects corrupt data, multiple entries, unsafe filenames and excessive uncompressed size', () => {
  const name = '101_DT_1B04006_M_2025.csv', data = fixtureCsv('2025');
  for (const compression of [0, 8]) assert.deepEqual(extractKosisCsv(zipFile(name, data, compression), name), data);
  const corrupt = zipFile(name, data, 0); corrupt[30 + name.length] ^= 1;
  assert.throws(() => extractKosisCsv(corrupt, name), /CRC/);
  const multi = zipFile(name, data); multi.writeUInt16LE(2, multi.length - 22 + 10);
  assert.throws(() => extractKosisCsv(multi, name), /단일/);
  assert.throws(() => extractKosisCsv(zipFile('../outside.csv', data), name), /이름/);
  const bomb = zipFile(name, data); const directory = bomb.readUInt32LE(bomb.length - 22 + 16); bomb.writeUInt32LE(100 * 1024 * 1024, directory + 24);
  assert.throws(() => extractKosisCsv(bomb, name), /크기/);
});

test('CSV rejects altered units, counts inconsistent with sexes, missing observations and duplicates', () => {
  const csv = new TextDecoder('euc-kr').decode(fixtureCsv('2025'));
  assert.throws(() => parseKosisBulkCsv(csv.replace('총인구수 (명)', '총인구수 (%)'), config(), '2025'), /항목·단위/);
  assert.throws(() => parseKosisBulkCsv(csv.replace('8820.0000', '8821.0000'), config(), '2025'), /합계/);
  const lines = csv.trimEnd().split(/\r?\n/);
  assert.throws(() => parseKosisBulkCsv(lines.slice(0, -1).join('\n'), config(), '2025'), /불완전/);
  lines[lines.length - 1] = lines[lines.length - 2];
  assert.throws(() => parseKosisBulkCsv(lines.join('\n'), config(), '2025'), /중복/);
});

test('missing cells stay missing, declared zero stays zero and quoted cells keep CSV semantics', () => {
  const csv = new TextDecoder('euc-kr').decode(fixtureCsv('2025'))
    .replace('8820.0000,4587.0000,4233.0000', ',,')
    .replace('8820.0000,4587.0000,4233.0000', '0.0000,0.0000,0.0000')
    .replaceAll(' 수원시', '" 수원시"');
  const rows = parseKosisBulkCsv(csv, config(), '2025');
  assert.equal(rows[0].value, null); assert.equal(rows[0].missing, true);
  assert.equal(rows[1].value, 0); assert.equal(rows[1].missing, false);
});

test('metadata mismatch, unpublished year, oversized response or late network failure never returns partial results', async () => {
  const wrongRegion = config(); wrongRegion.regions = [{code: '41111', name: '장안구', level: 'municipality'}];
  await assert.rejects(fetchKosisBulkPopulation({config: wrongRegion, fetchImpl: mockFetch}), /시·군/);
  const absentYear = config(); absentYear.months = ['200812'];
  await assert.rejects(fetchKosisBulkPopulation({config: absentYear, fetchImpl: mockFetch}), /공개 목록/);
  await assert.rejects(fetchKosisBulkPopulation({config: config(), fetchImpl: async () => new Response('x', {headers: {'content-length': String(10 * 1024 * 1024)}})}), /크기/);
  let calls = 0;
  await assert.rejects(fetchKosisBulkPopulation({config: config(), fetchImpl: async (...args) => {
    calls++; if (calls === 5) throw new Error('PRIVATE-CREDENTIAL-ECHO'); return mockFetch(...args);
  }}), error => !error.message.includes('PRIVATE') && /연결하지 못했습니다/.test(error.message));
  assert.equal(calls, 5);
});
