import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForEffectResources } from '../src/server/capcut/effect-acquisition.mjs';
import { probeEffectBundle } from '../src/server/capcut/effect-resources.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requests = [{ entry: {}, item: { resource_id: '123456' } }];
test('acquisition waits for a complete resource, bounds missing downloads and preserves unsafe-cache failures', async () => {
  let time = 0, calls = 0;
  const clock = { now: () => time, sleep: async ms => { time += ms; }, timeoutMs: 4000 };
  const found = await waitForEffectResources(requests, { ...clock, inspect: () => {
    if (++calls === 1) throw Object.assign(new Error('extracting'), { code: 'ENOENT' });
    return { available: true, controls: [{ name: 'speed' }] };
  } });
  assert.equal(found[0].available, true); assert.equal(time, 3000);
  time = 0;
  const missing = await waitForEffectResources(requests, { ...clock, inspect: () => ({ available: false }) });
  assert.equal(missing[0].available, false); assert.equal(time, 4000);
  await assert.rejects(waitForEffectResources(requests, { ...clock, inspect: () => { throw new Error('Linked native resource files'); } }), /Linked/);
});

test('cancelled acquisition stops polling instead of reporting an available resource', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(waitForEffectResources(requests, { signal: controller.signal,
    inspect: () => { calls++; return { available: false }; },
    sleep: async () => controller.abort(new Error('cancelled by user')) }), /cancelled by user/);
  assert.equal(calls, 1);
});

test('interrupted extraction waits for metadata, config, payload and a stable fingerprint', async t => {
  const root = await mkdtemp(join(tmpdir(), 'effect-extraction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = { is_vip: false, md5: 'a'.repeat(32) }, item = { resource_id: '123456', stdraft_uri: 'vimo://123456' };
  const folder = join(root, item.resource_id, entry.md5);
  await mkdir(folder, { recursive: true });
  assert.equal(probeEffectBundle(entry, item, root).available, false);
  await writeFile(join(folder, 'extra.json'), '{');
  assert.equal(probeEffectBundle(entry, item, root).available, false);
  await writeFile(join(folder, 'extra.json'), '{}');
  assert.equal(probeEffectBundle(entry, item, root).available, false);
  await writeFile(join(folder, 'config.json'), JSON.stringify({ effect: { Link: [{ type: 'AmazingFeature', path: 'feature/' }] } }));
  assert.equal(probeEffectBundle(entry, item, root).available, false);
  await mkdir(join(folder, 'feature'));
  await writeFile(join(folder, 'feature/main.scene'), 'scene');
  let time = 0;
  const result = await waitForEffectResources([{ entry, item }], { now: () => time, timeoutMs: 5000,
    inspect: (e, i) => probeEffectBundle(e, i, root), sleep: async ms => {
      time += ms;
      if (time <= 2000) await writeFile(join(folder, 'feature/main.scene'), `scene at ${time}`);
    } });
  assert.equal(time, 4000, 'changes reset the settling interval');
  assert.equal(result[0].available, true);
  await writeFile(join(folder, 'config.json'), JSON.stringify({ effect: { Link: [{ path: '../escape/' }] } }));
  assert.throws(() => probeEffectBundle(entry, item, root), /Unsafe/);
});

test('complete CapCut bundles may contain an empty generated RTTI sidecar, but not empty shaders', async t => {
  const root = await mkdtemp(join(tmpdir(), 'effect-sidecar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = { is_vip: false, md5: 'b'.repeat(32) }, item = { resource_id: '123456', stdraft_uri: 'vimo://123456' };
  const folder = join(root, item.resource_id, entry.md5), feature = join(folder, 'feature'); await mkdir(feature, { recursive: true });
  await writeFile(join(folder, 'extra.json'), '{}');
  await writeFile(join(folder, 'config.json'), JSON.stringify({ effect: { Link: [{ type: 'AmazingFeature', path: 'feature/' }] } }));
  await writeFile(join(feature, 'main.scene'), 'scene');
  await writeFile(join(feature, 'LuaRTTI.MarkGen.lua'), '');
  assert.equal(probeEffectBundle(entry, item, root).available, true, 'The generated optional sidecar is not a missing effect payload.');
  await writeFile(join(feature, 'shader.frag'), '');
  assert.equal(probeEffectBundle(entry, item, root).available, false, 'Empty actual payload is still incomplete.');
  await writeFile(join(feature, 'shader.frag'), 'shader');
  await writeFile(join(feature, 'main.scene'), '');
  assert.equal(probeEffectBundle(entry, item, root).available, false, 'The entry scene is still required.');
});
