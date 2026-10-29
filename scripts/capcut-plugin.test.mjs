import test from 'node:test';
import assert from 'node:assert/strict';
import { materialSearchArguments, materialSearchTool, materialSearchItems, capcutAuthorizationUrl } from '../src/server/capcut/plugin-policy.mjs';
import { inspectEffectResource, effectBundleFiles, selectOfficialEffect, effectCacheRoot } from '../src/server/capcut/effect-resources.mjs';
import { integrationCapabilities, effectRoutingReceipt } from '../src/server/capcut/integration-policy.mjs';
import { packageJobResources } from '../src/server/capcut/package-resources.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findExecutable } from '../src/server/platform/runtime.mjs';

test('effect routing distinguishes official application, missing resources and local fallback', () => {
  const capabilities = integrationCapabilities({ materialSearch: true, localBuilder: true });
  const effects = [{ slug: 'one', target: 'source', start: 0, duration: 1 }, { slug: 'two', target: 'source', start: 1, duration: 1 }];
  const receipt = effectRoutingReceipt(effects, [{ index: 0, resourceId: '123456', controlsVerified: false, resourceFiles: [] }], capabilities);
  assert.equal(receipt.discovery, 'official-capcut-plugin'); assert.equal(receipt.autoExport, false);
  assert.equal(receipt.effects[0].provider, 'official-capcut-local-builder-and-desktop-adapter');
  assert.equal(receipt.effects[0].controlsVerified, false); assert.equal(receipt.effects[0].playbackVerified, false);
  assert.match(receipt.effects[1].reason, /No unambiguous/);
  assert.equal(integrationCapabilities({ materialSearch: false, localBuilder: false }).discovery, 'installed-local-catalog');
});

test('native effect cache paths preserve Windows and macOS path semantics and overrides', () => {
  assert.equal(effectCacheRoot('darwin', {}, '/Users/Test User'), '/Users/Test User/Movies/CapCut/User Data/Cache/effect');
  assert.equal(effectCacheRoot('win32', { LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local' }, 'ignored'), 'C:\\Users\\Test User\\AppData\\Local\\CapCut\\User Data\\Cache\\effect');
  assert.equal(effectCacheRoot('darwin', { AI_EDITOR_CAPCUT_EFFECT_CACHE: '/Volumes/Media/CapCut effects' }, '/Users/Test'), '/Volumes/Media/CapCut effects');
  assert.throws(() => effectCacheRoot('darwin', { AI_EDITOR_CAPCUT_EFFECT_CACHE: '../untrusted' }), /absolute/);
});

const catalogEffect = { name: 'Motion Blur', slug: 'motion-blur', is_vip: false, md5: '167deb8c5b35d5a3097cb107693c62c3', resource_id: '7011333202614686210' };
const officialEffect = { title: 'Motion Blur', resource_id: '7399468627948440838', stdraft_uri: 'vimo://7399468627948440838' };

const searchTool = () => ({ name: 'search_capcut_material', inputSchema: { properties: { type: {}, prompt: {}, top_n: {} } }, annotations: { readOnlyHint: true } });
test('official bridge permits documented text material search and rejects arbitrary tool/data injection', () => {
  assert.deepEqual(materialSearchArguments({ kind: 'video_effect', query: ' RGB separation ' }), { type: 'video_effect', prompt: 'RGB separation', top_n: 5 });
  assert.throws(() => materialSearchArguments({ kind: 'generate_video', query: 'test' }), /category/);
  assert.throws(() => materialSearchArguments({ kind: 'video_effect', query: 'test', tool: 'purchase' }), /Unexpected/);
  assert.throws(() => materialSearchArguments({ kind: 'video_effect', query: '' }), /Describe/);
});
test('connection accepts only the configured official CapCut OAuth destination', () => {
  assert.equal(capcutAuthorizationUrl('https://www.capcut.com/api/external_mcp/oauth/authorize?state=opaque'), 'https://www.capcut.com/api/external_mcp/oauth/authorize?state=opaque');
  for (const url of ['https://attacker.example/api/external_mcp/oauth/authorize', 'http://www.capcut.com/api/external_mcp/oauth/authorize', 'https://www.capcut.com:8443/api/external_mcp/oauth/authorize', 'https://www.capcut.com.evil.example/api/external_mcp/oauth/authorize', 'https://www.capcut.com/tools']) assert.throws(() => capcutAuthorizationUrl(url), /unexpected/);
});
test('capability discovery rejects ambiguous, destructive and changed search tools', () => {
  assert.equal(materialSearchTool({ search: searchTool() }), 'search_capcut_material');
  assert.throws(() => materialSearchTool({}), /unavailable/);
  assert.throws(() => materialSearchTool({ one: searchTool(), two: searchTool() }), /unavailable/);
  assert.throws(() => materialSearchTool({ search: { ...searchTool(), annotations: { destructiveHint: true } } }), /read-only/);
  assert.throws(() => materialSearchTool({ search: { ...searchTool(), inputSchema: {} } }), /contract changed/);
});
test('material results preserve authoritative URIs and do not pretend unfamiliar results are empty', () => {
  const item = { title: 'Example', resource_id: '123', stdraft_uri: 'vimo://opaque-value', is_vip: true, unrelated: 'ignored' };
  assert.deepEqual(materialSearchItems({ content: [{ type: 'text', text: JSON.stringify({ items: [item] }) }] }), [{ title: 'Example', resource_id: '123', stdraft_uri: 'vimo://opaque-value', is_vip: true }]);
  assert.deepEqual(materialSearchItems({ structuredContent: { items: [] } }), []);
  assert.throws(() => materialSearchItems({ content: [{ type: 'text', text: '<script>unexpected</script>' }] }), /unfamiliar/);
});

test('automatic effect selection rejects paid, ambiguous and mismatched identities', () => {
  assert.deepEqual(selectOfficialEffect(catalogEffect, [officialEffect]), officialEffect);
  assert.equal(selectOfficialEffect(catalogEffect, [{ ...officialEffect, is_vip: true }]), null);
  assert.equal(selectOfficialEffect(catalogEffect, [officialEffect, { ...officialEffect, resource_id: '123456' }]), null);
  assert.equal(selectOfficialEffect(catalogEffect, [{ ...officialEffect, title: 'Different effect' }]), null);
  assert.throws(() => selectOfficialEffect(catalogEffect, [{ ...officialEffect, stdraft_uri: 'vimo://different' }]), /identity/);
});

test('official material captions reach the planner as descriptions without losing resource identity', () => {
  // The protected CapCut font search returns its visual description as caption.
  const item = { resource_id: '7317175475195875841', stdraft_uri: 'vimo://7317175475195875841',
    title: 'ZY Resolve', caption: 'Bold geometric sans-serif display font.', cover_url: 'https://example.invalid/thumbnail' };
  for (const result of [{ structuredContent: { items: [item] } }, { content: [{ type: 'text', text: JSON.stringify({ items: [item] }) }] }]) {
    assert.deepEqual(materialSearchItems(result), [{ resource_id: item.resource_id, stdraft_uri: item.stdraft_uri,
      title: item.title, caption: item.caption, description: item.caption }]);
  }
  const described = materialSearchItems({ structuredContent: { items: [{ ...item, description: 'Explicit provider description.', is_vip: true }] } })[0];
  assert.equal(described.description, 'Explicit provider description.');
  assert.equal(described.is_vip, true, 'visual descriptions must not overwrite paid-resource metadata');
  const malformed = materialSearchItems({ structuredContent: { items: [{ ...item, caption: { tool: 'execute' } }] } })[0];
  assert.equal(Object.hasOwn(malformed, 'caption'), false);
  assert.equal(Object.hasOwn(malformed, 'description'), false);
});

test('native metadata supplies real control names and packages the complete local effect dependency', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-resources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, 'cache'), folder = join(cache, officialEffect.resource_id, catalogEffect.md5);
  await mkdir(join(folder, 'shader'), { recursive: true });
  const metadata = { setting: { effect_adjust_params: [{ effect_key: 'effects_adjust_intensity', min: 0, max: 1, default: 0.85 }] } };
  await writeFile(join(folder, 'extra.json'), JSON.stringify(metadata));
  await writeFile(join(folder, 'shader', 'main.frag'), 'fixture shader data');
  const resource = inspectEffectResource(catalogEffect, officialEffect, cache);
  assert.equal(resource.available, true);
  assert.deepEqual(resource.controls, [{ name: 'effects_adjust_intensity', min: 0, max: 1, default: 0.85 }]);
  assert.throws(() => effectBundleFiles(folder, 1), /budget/);
  assert.throws(() => inspectEffectResource({ ...catalogEffect, is_vip: true }, officialEffect, cache), /no-cost/);
  const destination = join(root, 'review'); await mkdir(destination);
  const draft = { materials: { video_effects: [{ path: folder }, { path: folder }] } };
  assert.equal(await packageJobResources(draft, destination, cache), 1, 'one checked copy is shared by repeated uses');
  assert.equal(draft.materials.video_effects[0].path, draft.materials.video_effects[1].path);
  assert.equal(await readFile(join(draft.materials.video_effects[0].path, 'shader/main.frag'), 'utf8'), 'fixture shader data');
  metadata.setting.effect_adjust_params[0].default = 2;
  await writeFile(join(folder, 'extra.json'), JSON.stringify(metadata));
  assert.throws(() => inspectEffectResource(catalogEffect, officialEffect, cache), /control/);
});

test('resource packaging accepts ancestor aliases above the job store with either path spelling', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'resource-alias-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const physical = join(root, 'physical'), alias = join(root, 'alias');
  await mkdir(join(physical, 'store', 'effect', 'shader'), { recursive: true });
  await writeFile(join(physical, 'store', 'effect', 'shader', 'main.frag'), 'shader payload');
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasedStore = join(alias, 'store'), canonicalStore = join(physical, 'store');
  for (const [index, [store, source]] of [
    [aliasedStore, join(aliasedStore, 'effect')],
    [canonicalStore, join(aliasedStore, 'effect')],
    [aliasedStore, join(canonicalStore, 'effect')],
  ].entries()) {
    const destination = join(root, `review-${index}`); await mkdir(destination);
    const draft = { materials: { video_effects: [{ path: source }] } };
    assert.equal(await packageJobResources(draft, destination, store), 1);
    assert.equal(await readFile(join(draft.materials.video_effects[0].path, 'shader', 'main.frag'), 'utf8'), 'shader payload');
  }
});

test('resource packaging rejects linked resources, in-store parents and bundle dependencies', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'resource-links-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = join(root, 'store'), effect = join(store, 'effect'), destination = join(root, 'review');
  await mkdir(effect, { recursive: true }); await mkdir(destination);
  await writeFile(join(effect, 'payload.dat'), 'effect data');
  const alias = join(store, 'alias'); await symlink(effect, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const packagePath = path => packageJobResources({ materials: { video_effects: [{ path }] } }, destination, store);
  await assert.rejects(packagePath(alias), /cannot be linked/);
  await assert.rejects(packagePath(join(alias, 'payload.dat')), /parents cannot be linked/);
  const loop = join(store, 'loop'); await symlink(store, loop, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packagePath(join(loop, 'effect', 'payload.dat')), /parents cannot be linked/);
  await assert.rejects(packagePath(`${alias}/../effect/payload.dat`), /traversal|linked/);
  const bundle = join(store, 'bundle'); await mkdir(bundle);
  await symlink(effect, join(bundle, 'dependency'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packagePath(bundle), /Linked native resource files/);
});

test('installed official builder applies the authoritative URI and named controls locally', async t => {
  const plugin = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'plugin-marketplaces/CapCut/codex');
  const python = findExecutable(process.platform === 'win32' ? 'python' : 'python3');
  if (!python || !existsSync(join(plugin, '.codex-plugin/plugin.json'))) return t.skip('Install the pinned official plugin and Python for this integration test.');
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-builder-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = join(root, 'request.json'), output = join(root, 'output.json');
  await writeFile(request, JSON.stringify({ width: 640, height: 360, durationMs: 3000,
    effects: [{ index: 0, source: officialEffect.stdraft_uri, startMs: 100, durationMs: 400, controls: { effects_adjust_intensity: 0.85, effects_adjust_horizontal_shift: 0.7 } }] }));
  await promisify(execFile)(python, ['-I', '-B', join(process.cwd(), 'scripts/apply-plugin-effects.py'), plugin, request, output], { windowsHide: true, timeout: 30000 });
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.provider, 'official-capcut-local-builder');
  assert.equal(result.cloudSaved, false); assert.equal(result.mediaUploaded, false);
  const operation = result.operations[0];
  assert.equal(operation.check_result.valid, true);
  assert.equal(operation.segment.attributes.source, officialEffect.stdraft_uri);
  assert.equal(operation.segment.attributes.effects_adjust_intensity, 0.85);
  assert.equal(operation.segment.timeline['start.ms'], 100);
  assert.equal(operation.segment.timeline['duration.ms'], 400);
});
