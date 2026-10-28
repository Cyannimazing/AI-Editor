import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { executableCandidates, platformPaths } from '../src/server/platform/runtime.mjs';
import { browserCandidates } from '../src/server/platform/browser.mjs';
import { setupInputs, setupFingerprint, setupReceiptCurrent, setupView } from '../src/server/setup/requirements.mjs';
import { installedCapcutPlugin } from '../src/server/capcut/local-builder.mjs';
import { toolchainCurrent, toolchainFingerprint } from '../src/server/setup/toolchain.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-setup-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'ai-editor-setup-')));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function put(root, file, text) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

test('platform paths keep native separators and support custom CapCut locations', () => {
  assert.equal(platformPaths('darwin', '/Users/Test User', {}).drafts, '/Users/Test User/Movies/CapCut/User Data/Projects/com.lveditor.draft');
  assert.equal(platformPaths('win32', 'C:\\Users\\Test User', {}).drafts, 'C:\\Users\\Test User\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft');
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(platformPaths(platform, '/unused', { AI_EDITOR_DRAFTS_ROOT: '/chosen/drafts', AI_EDITOR_CAPCUT_PATH: '/chosen/app' }), { drafts: '/chosen/drafts', capcut: '/chosen/app' });
  }
});

test('Mac discovery covers Intel, Apple Silicon, per-user apps and keg-only Python without shell PATH', () => {
  assert.equal(platformPaths('darwin', '/Users/Test User', {}, path => path === '/Users/Test User/Applications/CapCut.app').capcut, '/Users/Test User/Applications/CapCut.app');
  assert.equal(platformPaths('darwin', '/Users/Test User', {}, () => true).capcut, '/Applications/CapCut.app');
  const options = { platform: 'darwin', home: '/Users/Test User', env: {}, cwd: '/Users/Test User/AI Editor' };
  const ffmpeg = executableCandidates('ffmpeg', options);
  assert.ok(ffmpeg.includes('/opt/homebrew/bin/ffmpeg'));
  assert.ok(ffmpeg.includes('/usr/local/bin/ffmpeg'));
  const codex = executableCandidates('codex', options);
  assert.ok(codex.includes('/Applications/Codex.app/Contents/Resources/codex'));
  assert.ok(codex.includes('/Users/Test User/Applications/Codex.app/Contents/Resources/codex'));
  const python = executableCandidates('python3.13', options);
  assert.ok(python.includes('/opt/homebrew/opt/python@3.13/bin/python3.13'));
  assert.ok(python.includes('/usr/local/opt/python@3.13/bin/python3.13'));
});

test('Windows discovery accepts quoted absolute PATH entries and rejects relative search entries', () => {
  const options = { platform: 'win32', home: 'C:\\Users\\Test User', cwd: 'C:\\AI Editor', env: { PATH: '"C:\\Tools With Spaces";.\\untrusted;;C:\\Other' } };
  const paths = executableCandidates('ffmpeg', options);
  assert.ok(paths.includes('C:\\Tools With Spaces\\ffmpeg.exe'));
  assert.ok(paths.includes('C:\\Other\\ffmpeg.exe'));
  assert.ok(!paths.some(path => path.includes('untrusted')));
  assert.ok(executableCandidates('python', options).includes('C:\\Users\\Test User\\AppData\\Local\\Programs\\Python\\Python313\\python.exe'));
  assert.throws(() => executableCandidates('../python', options), /Invalid tool/);
});

test('preview browser discovery includes per-user installations on both platforms', () => {
  assert.ok(browserCandidates({ platform: 'darwin', home: '/Users/Tester', env: {} }).includes('/Users/Tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(browserCandidates({ platform: 'win32', home: 'C:\\Users\\Tester', env: {} }).includes('C:\\Users\\Tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
});

test('setup resumes interruption and never masks login, missing tools, stale checks or a failed probe', () => {
  const ready = { stage: 'ready', progress: 100, detail: 'ready', error: null };
  const options = { state: ready, signedIn: true, toolsReady: true, receiptCurrent: true, running: false, hostReady: true };
  assert.equal(setupView(options).stage, 'ready');
  assert.equal(setupView({ ...options, signedIn: false }).stage, 'login');
  assert.equal(setupView({ ...options, hostReady: false }).stage, 'error');
  assert.equal(setupView({ ...options, toolsReady: false }).stage, 'idle');
  assert.equal(setupView({ ...options, receiptCurrent: false }).stage, 'idle');
  const interrupted = { stage: 'download', progress: 40, detail: 'downloading', error: null };
  assert.equal(setupView({ ...options, state: interrupted, receiptCurrent: false }).stage, 'idle');
  assert.deepEqual(setupView({ ...options, state: interrupted, running: true }), interrupted);
  const failed = { stage: 'error', progress: 0, detail: 'Browser failed', error: 'Unable to launch' };
  assert.deepEqual(setupView({ ...options, state: failed }), failed);
});

test('setup receipts expire after tool changes and when copied across platform or architecture', async t => {
  const root = await fixture(t);
  for (const file of setupInputs) { await mkdir(dirname(join(root, file)), { recursive: true }); await copyFile(join(process.cwd(), file), join(root, file)); }
  const fingerprint = await setupFingerprint(root);
  await put(root, '.local-tools/setup-receipt.json', JSON.stringify({ fingerprint }));
  assert.equal(await setupReceiptCurrent(root), true);
  assert.notEqual(await setupFingerprint(root, 'darwin', 'arm64'), await setupFingerprint(root, 'darwin', 'x64'));
  assert.notEqual(await setupFingerprint(root, 'win32', 'x64'), await setupFingerprint(root, 'darwin', 'x64'));
  await put(root, 'scripts/setup-preview-browser.mjs', '// updated browser check');
  assert.equal(await setupReceiptCurrent(root), false);
});

test('optional plugin installation is detected in standard cache without requiring Python or OAuth', async t => {
  const root = await fixture(t), plugin = 'plugins/cache/CapCut/CapCut/0.2.6';
  assert.equal(installedCapcutPlugin(root), null);
  for (const name of ['apply_materials.py', 'manage_materials.py']) await put(root, `${plugin}/skills/capcut-stdraft-builder/scripts/${name}`, '# fixture');
  await put(root, `${plugin}/.codex-plugin/plugin.json`, JSON.stringify({ name: 'CapCut', version: '0.2.6' }));
  assert.equal(installedCapcutPlugin(root), join(root, plugin));
  await put(root, `${plugin}/.codex-plugin/plugin.json`, JSON.stringify({ name: 'CapCut', version: '99.0.0' }));
  assert.equal(installedCapcutPlugin(root), null);
});

test('a toolchain receipt alone cannot hide missing or mismatched installed packages', async t => {
  const root = await fixture(t);
  for (const file of ['package.json', 'pnpm-lock.yaml', 'patches/hyperframes@0.8.193.patch']) await put(root, `toolchain/${file}`, await readFile(join(process.cwd(), 'toolchain', file)));
  await put(root, '.local-tools/toolchain-receipt.json', JSON.stringify({ fingerprint: await toolchainFingerprint(root) }));
  assert.equal(await toolchainCurrent(root), false);
  const declared = JSON.parse(await readFile(join(root, 'toolchain/package.json'), 'utf8'));
  for (const [name, version] of Object.entries({ ...declared.dependencies, ...declared.devDependencies })) await put(root, `toolchain/node_modules/${name}/package.json`, JSON.stringify({ version }));
  for (const file of ['capcut-cli/dist/index.js', 'hyperframes/bin/hyperframes.mjs', '@remotion/cli/remotion-cli.js', '@modelcontextprotocol/sdk/dist/esm/server/index.js']) await put(root, `toolchain/node_modules/${file}`, '// fixture');
  assert.equal(await toolchainCurrent(root), true);
  await put(root, 'toolchain/node_modules/hyperframes/package.json', JSON.stringify({ version: '0.0.0' }));
  assert.equal(await toolchainCurrent(root), false);
});
