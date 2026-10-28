import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, basename} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {CONNECTIONS, createConnectionState} from '../../src/integrations/connection-state.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const goodTime = '2026-10-27T01:00:00.000Z';
const successful = {status: 'candidates_ready', complete: true, checked_at: goodTime, last_success_at: goodTime, retrieved_count: 10, source_total: 10};

async function fixture(t, state = createConnectionState()) {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, 'school-api-cli-test-'));
  t.after(async () => {
    // The only recursive removal is this test's own newly created temp directory.
    assert.equal(dirname(resolve(root)).toLowerCase(), base.toLowerCase());
    assert.ok(basename(root).startsWith('school-api-cli-test-'));
    await rm(root, {recursive: true, force: true});
  });
  await mkdir(join(root, 'scripts'), {recursive: true});
  await cp(join(repository, 'scripts/connect-data.mjs'), join(root, 'scripts/connect-data.mjs'));
  await cp(join(repository, 'src/integrations'), join(root, 'src/integrations'), {recursive: true});
  await cp(join(repository, 'src/domain'), join(root, 'src/domain'), {recursive: true});
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await mkdir(join(root, 'data/private'), {recursive: true});
  const stateFile = join(root, 'data/private/api-connections.json');
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  // Block all real fetches, including accidental calls when a skip should apply.
  const guard = join(root, 'network-guard.mjs');
  await writeFile(guard, "import {writeFileSync} from 'node:fs';\nglobalThis.fetch=async()=>{writeFileSync(new URL('./network-attempted',import.meta.url),'blocked');throw new Error('SECRET-RAW-NETWORK-ERROR');};\n");
  const cleanEnv = {...process.env};
  for (const name of Object.keys(cleanEnv)) {
    if (Object.values(CONNECTIONS).some(c => c.env.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === 'node_options') delete cleanEnv[name];
  }
  const run = (args, env = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, join(root, 'scripts/connect-data.mjs'), ...args], {
    cwd: root, env: {...cleanEnv, ...env}, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  return {root, stateFile, run, readState: async () => JSON.parse(await readFile(stateFile, 'utf8')),
    noNetwork: async () => assert.rejects(access(join(root, 'network-attempted')), {code: 'ENOENT'})};
}

const lines = output => output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

test('CLI all with no keys exits 2 and reports five pending providers without fetching', async t => {
  const f = await fixture(t);
  const result = f.run(['all']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  const output = lines(result.stdout);
  assert.equal(output.filter(row => row.pending).length, 5);
  const summary = output.at(-1);
  assert.equal(summary.blocked, 5);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.automatically_merged, false);
  const state = await f.readState();
  assert.ok(Object.values(state.services).every(service => service.complete === false));
  await f.noNetwork();
});

test('CLI sample preserves each previous full provider result byte-for-byte and makes no request', async t => {
  const state = createConnectionState();
  for (const kind of ['neis', 'schoolinfo', 'firms']) state.services[kind] = {...successful};
  state.school_registry = [{id: 'preserved-school'}];
  state.schoolinfo_records = [{id: 'preserved-facility'}];
  state.firm_matches = [{firm_id: 'preserved-firm'}];
  const f = await fixture(t, state);
  const before = await readFile(f.stateFile, 'utf8');
  for (const kind of ['neis', 'schoolinfo', 'firms']) {
    const result = f.run([kind, '--sample']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /기존 전체 조회 결과를 유지/);
  }
  assert.equal(await readFile(f.stateFile, 'utf8'), before);
  await f.noNetwork();
});

test('CLI missing credentials does not erase a previously successful registry', async t => {
  const state = createConnectionState();
  state.services.neis = {...successful};
  state.school_registry = [{id: 'preserved-school'}];
  const f = await fixture(t, state);
  const before = await readFile(f.stateFile, 'utf8');
  const result = f.run(['neis']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(await readFile(f.stateFile, 'utf8'), before);
  await f.noNetwork();
});

test('CLI publish-status removes private records, credentials and custom source links', async t => {
  const state = createConnectionState();
  state.school_registry = [{name: 'PRIVATE-SCHOOL'}];
  state.schoolinfo_records = [{name: 'PRIVATE-FACILITY'}];
  state.population_records = [{name: 'PRIVATE-POPULATION'}];
  state.building_candidates = [{name: 'PRIVATE-BUILDING'}];
  state.firm_matches = [{name: 'PRIVATE-FIRM'}];
  state.key = 'SECRET-KEY';
  state.services.neis = {...successful, source_url: 'https://example.com/?KEY=SECRET', raw_error: 'SECRET-RAW', apiKey: 'SECRET-API'};
  const f = await fixture(t, state);
  const result = f.run(['publish-status']);
  assert.equal(result.status, 0, result.stderr);
  const published = await readFile(join(f.root, 'public/official-enrichment.json'), 'utf8');
  assert.doesNotMatch(published, /SECRET|PRIVATE|example\.com|school_registry|firm_matches|population_records/);
  const data = JSON.parse(published);
  assert.equal(data.services.neis.source_url, CONNECTIONS.neis.url);
  assert.equal(data.services.neis.retrieved_count, 10);
  assert.equal(lines(result.stdout)[0].records_published, 0);
  assert.deepEqual(await f.readState(), state);
  await f.noNetwork();
});

test('CLI status reflects the latest failure while retaining the last-success timestamp', async t => {
  const state = createConnectionState();
  state.services.neis = {...successful, last_attempt: {status: 'error', checked_at: '2026-10-28T01:00:00.000Z', raw_error: 'SECRET-ERROR'}};
  const f = await fixture(t, state);
  const result = f.run(['status']);
  assert.equal(result.status, 0, result.stderr);
  const neis = lines(result.stdout).find(row => row.kind === 'neis');
  assert.equal(neis.saved_status, 'error');
  assert.equal(neis.last_success_at, goodTime);
  assert.equal(neis.key_configured, false);
  assert.doesNotMatch(result.stdout, /SECRET/);
  await f.noNetwork();
});

test('CLI failed refresh preserves previous data, returns 1 and never prints authenticated errors', async t => {
  const state = createConnectionState();
  state.services.neis = {...successful};
  state.school_registry = [{id: 'preserved-school'}];
  const f = await fixture(t, state);
  const result = f.run(['neis'], {NEIS_API_KEY: 'SECRET-TEST-ONLY'});
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET/);
  const retained = await f.readState();
  assert.deepEqual(retained.school_registry, state.school_registry);
  assert.equal(retained.services.neis.status, 'candidates_ready');
  assert.equal(retained.services.neis.last_success_at, goodTime);
  assert.equal(retained.services.neis.last_attempt.status, 'error');
  assert.equal(lines(result.stdout).at(-1).failed, 1);
  assert.equal(await readFile(join(f.root, 'network-attempted'), 'utf8'), 'blocked');
});
