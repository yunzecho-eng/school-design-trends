import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONNECTIONS, STATUS_LABELS, createConnectionState, publicConnectionState, prerequisite} from '../src/integrations/connection-state.js';
import {fetchNeisSchools, matchNeisSchools} from '../src/integrations/neis.js';
import {fetchOfficialFirms, matchOfficialFirms, fetchOfficialBuildings} from '../src/integrations/official-data.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args[0] ?? 'status';
const option = name => { const i = args.indexOf(name); if (i < 0) return null; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('옵션 값이 없습니다.'); return args[i + 1]; };
const readJson = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const stateFile = resolve(root, 'data/private/api-connections.json');

async function atomicJson(file, data) {
  await mkdir(dirname(file), {recursive: true});
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

async function run() {
  if (mode === 'help' || args.includes('--help')) {
    console.log('npm run data:connect -- <status|neis|schoolinfo|firms|buildings|kosis|all|publish-status> [--sample] [--year 2025] [--parcels data/private/school-parcels.json] [--config data/private/kosis-population.json]\n상세: docs/API_SETUP.md');
    return;
  }
  if (!['status', 'publish-status', 'all', ...Object.keys(CONNECTIONS)].includes(mode)) throw new Error('데이터 종류를 확인하세요. help 명령으로 사용법을 볼 수 있습니다.');
  const sample = args.includes('--sample');
  if (sample && ['buildings', 'kosis'].includes(mode)) throw new Error('이 API는 무인증 시험 조회를 지원하지 않습니다.');
  let state = createConnectionState();
  try {
    const previous = await readJson(stateFile);
    if (previous.schema_version !== state.schema_version) throw new Error('schema');
    state = {...previous, services: {...state.services, ...previous.services}};
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('이전 비공개 연결 결과를 읽지 못했습니다. 파일을 확인하세요.'); }
  const options = {sample, parcels: option('--parcels'), config: option('--config')};
  if (mode === 'status') {
    const visible = publicConnectionState(state);
    for (const [kind, item] of Object.entries(CONNECTIONS)) console.log(JSON.stringify({kind, title: item.title, key_configured: Boolean(process.env[item.env]?.trim()), required_env: item.env, saved_status: visible.services[kind].status, last_success_at: visible.services[kind].last_success_at}));
    return;
  }
  if (mode === 'publish-status') {
    // Only metadata goes public. Candidate registries stay local pending identity review.
    const output = resolve(root, 'public/official-enrichment.json');
    await atomicJson(output, publicConnectionState(state));
    console.log(JSON.stringify({file: output, content: 'connection_status_only', records_published: 0}));
    return;
  }
  const kinds = mode === 'all' ? Object.keys(CONNECTIONS) : [mode];
  let blocked = 0, succeeded = 0, failed = 0;
  for (const kind of kinds) {
    if (sample && ['buildings', 'kosis'].includes(kind)) {
      console.log(JSON.stringify({kind, skipped: '무인증 시험을 지원하지 않습니다.'}));
      continue;
    }
    const pending = prerequisite(kind, process.env, options);
    if (pending) {
      blocked++;
      // A missing key never overwrites the last successful collection.
      console.log(JSON.stringify({kind, pending, message: STATUS_LABELS[pending]}));
      if (!state.services[kind].last_success_at) {
        state.services[kind] = {...state.services[kind], status: pending};
        await atomicJson(stateFile, state);
      }
      continue;
    }
    if (sample && state.services[kind]?.complete) {
      console.log(JSON.stringify({kind, skipped: '기존 전체 조회 결과를 유지합니다.'}));
      continue;
    }
    const checkedAt = new Date().toISOString();
    try {
      const key = process.env[CONNECTIONS[kind].env];
      let data, rows = {};
      if (kind === 'neis') {
        data = await fetchNeisSchools({key, sample});
        const snapshot = await readJson('data/goe-annual.snapshot.json');
        rows = {school_registry: data.rows, school_matches: matchNeisSchools(snapshot.projects, data.rows, {scope: data.scope})};
      } else if (kind === 'firms') {
        data = await fetchOfficialFirms({key, sample});
        const snapshot = await readJson('data/goe-annual.snapshot.json');
        rows.firm_matches = matchOfficialFirms(snapshot.firms, data.rows).map(match => sample && match.match_status === 'not_found' ? {...match, match_status: 'not_searched'} : match);
      } else if (kind === 'buildings') {
        const parcels = await readJson(options.parcels);
        if (!Array.isArray(parcels) || !parcels.every(p => p.reviewed === true && typeof p.source_url === 'string' && /^https:\/\//.test(p.source_url))) throw new Error('학교 지번마다 reviewed:true와 대조한 source_url이 필요합니다.');
        const records = await fetchOfficialBuildings({key, parcels, retrievedAt: checkedAt});
        data = {rows: records, total: records.length, scope: 'complete', queried_parcels: parcels.length};
        rows.building_candidates = records;
      } else if (kind === 'schoolinfo') {
        const {fetchSchoolInfo} = await import('../src/integrations/schoolinfo.js');
        data = await fetchSchoolInfo({key, sample, year: option('--year') ?? '2025', apiTypes: ['0', '17', '18', '20', '62']});
        rows.schoolinfo_records = data.rows;
      } else {
        const {fetchKosisPopulation} = await import('../src/integrations/kosis.js');
        data = await fetchKosisPopulation({key, config: await readJson(options.config)});
        rows.population_records = data.rows;
      }
      const isSample = data.scope === 'sample_only';
      const next = {...state, ...rows, checked_at: checkedAt, services: {...state.services, [kind]: {
        status: isSample ? 'sample_only' : 'candidates_ready', complete: !isSample,
        checked_at: checkedAt, last_success_at: checkedAt,
        source_total: ['neis', 'firms'].includes(kind) ? data.total : null,
        retrieved_count: data.rows.length, sample_count: isSample ? data.rows.length : undefined,
        queried_parcels: data.queried_parcels, year: kind === 'schoolinfo' ? option('--year') ?? '2025' : undefined,
        source_url: CONNECTIONS[kind].url, required_env: CONNECTIONS[kind].env, review_status: 'candidate_only',
        query_count: data.queries?.length, selection: data.selection, limitations: data.limitations,
      }}};
      await atomicJson(stateFile, next);
      state = next;
      succeeded++;
      console.log(JSON.stringify({kind, status: state.services[kind].status, records: data.rows.length, scope: data.scope}));
    } catch {
      failed++;
      // Keep prior data and status intact on failure. Raw errors may contain a secret.
      state.services[kind] = {...state.services[kind], last_attempt: {status: 'error', checked_at: checkedAt}};
      await atomicJson(stateFile, state);
      console.error(JSON.stringify({kind, status: 'error', message: '조회에 실패했습니다. 키·활용신청·설정·연결 상태를 확인하세요. 이전 성공 결과는 유지합니다.'}));
      process.exitCode = 1;
    }
  }
  if (blocked && !process.exitCode) process.exitCode = 2;
  console.log(JSON.stringify({succeeded, blocked, failed, private_file: stateFile, next: 'npm run data:connect -- publish-status', automatically_merged: false}));
}

run().catch(() => { console.error('공식 데이터 작업을 완료하지 못했습니다. 명령과 로컬 설정을 확인하세요. 기존 결과는 유지됩니다.'); process.exitCode = 1; });
