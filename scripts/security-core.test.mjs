import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
import { authorize, sessionResponse, boundedBody } from '../src/server/security/http.ts';
import { directoryDigest, transactionalWrite } from '../src/server/editing/transaction.ts';
import { acquireLock } from '../src/server/editing/lock.ts';
import { containedPath } from '../src/server/security/paths.ts';
import { mediaResponse } from '../src/server/security/media-response.ts';

const origin = 'http://localhost:3000';
function request(path, options = {}) { return new Request(origin + path, { ...options, headers: { host: 'localhost:3000', ...options.headers } }); }
test('session requires same-origin bootstrap and rejects forged cookies, hosts and CSRF', () => {
  assert.throws(() => sessionResponse(request('/api/session', { method: 'POST' })), /same-origin/);
  const response = sessionResponse(request('/api/session', { method: 'POST', headers: { origin, 'x-ai-editor': '1' } }));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  authorize(request('/api/setup', { headers: { cookie } }));
  assert.throws(() => authorize(request('/api/setup', { headers: { cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') } })), /expired/);
  assert.throws(() => authorize(request('/api/setup', { headers: { cookie, host: 'evil.test' } })), /host/);
  assert.throws(() => authorize(request('/api/setup', { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'x-ai-editor': '1' } })), /same-origin/);
  assert.throws(() => authorize(request('/api/setup', { headers: { cookie, 'sec-fetch-site': 'cross-site' } })), /Cross-origin/);
});
test('upload limit checks actual bytes even with missing or dishonest Content-Length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    await assert.rejects(boundedBody(request('/api/upload', { method: 'POST', body: '123456', headers }), 5), /size limit/);
  }
  assert.equal(await (await boundedBody(request('/api/upload', { method: 'POST', body: '123' }), 5)).text(), '123');
});
test('failed commits restore all original files, remove new files, and retain a verified backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-transaction-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'); await mkdir(project); await writeFile(join(project, 'draft.json'), 'original');
  const digest = await directoryDigest(project);
  await assert.rejects(transactionalWrite({ project, expectedDigest: digest, journalRoot: join(root, 'journals'),
    write: async () => { await writeFile(join(project, 'draft.json'), 'changed'); await writeFile(join(project, 'new.bin'), 'new'); },
    validate: async () => { throw new Error('Invalid candidate'); } }), /complete original was restored/);
  assert.equal(await directoryDigest(project), digest);
  await assert.rejects(readFile(join(project, 'new.bin')), /ENOENT/);
  let wrote = false; await writeFile(join(project, 'draft.json'), 'changed outside editor');
  await assert.rejects(transactionalWrite({ project, expectedDigest: digest, journalRoot: join(root, 'journals'), write: async () => { wrote = true; }, validate: async () => {} }), /original project changed/);
  assert.equal(wrote, false);
});
test('exclusive locks prevent simultaneous writers and release for later jobs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'editing.lock'), release = await acquireLock(path);
  await assert.rejects(acquireLock(path), /active/); await release(); await (await acquireLock(path))();
});
test('an interrupted commit journal blocks later writes even when the original hash matches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'), journals = join(root, 'journals'); await mkdir(project); await mkdir(journals);
  await writeFile(join(project, 'draft.json'), 'original');
  await writeFile(join(journals, `${randomUUID()}.json`), JSON.stringify({ project, phase: 'committing', backup: join(root, 'backup') }));
  let wrote = false;
  await assert.rejects(transactionalWrite({ project, journalRoot: journals, expectedDigest: await directoryDigest(project),
    write: async () => { wrote = true; }, validate: async () => {} }), /recovery inspection/);
  assert.equal(wrote, false);
});
test('resolved paths reject siblings and preview range reads are exact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-path-')); t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = join(root, 'allowed'); await mkdir(allowed);
  const path = join(root, 'video.mp4'); await writeFile(path, '0123456789');
  await assert.rejects(containedPath(allowed, path), /escapes/);
  const response = await mediaResponse(request('/preview', { headers: { range: 'bytes=2-5' } }), path);
  assert.equal(response.status, 206); assert.equal(await response.text(), '2345');
  const invalid = await mediaResponse(request('/preview', { headers: { range: 'bytes=20-' } }), path);
  assert.equal(invalid.status, 416);
});

test('a process crash mid-write retains a complete backup and blocks a subsequent writer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-crash-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'), journals = join(root, 'journals'); await mkdir(project);
  await writeFile(join(project, 'draft.json'), 'original');
  await writeFile(join(project, 'media.bin'), 'untouched media');
  const digest = await directoryDigest(project), script = join(root, 'crash.mjs');
  const transactionUrl = pathToFileURL(join(process.cwd(), 'src/server/editing/transaction.ts')).href;
  await writeFile(script, `import {transactionalWrite} from ${JSON.stringify(transactionUrl)};
    import {writeFile} from 'node:fs/promises';
    await transactionalWrite({ project: ${JSON.stringify(project)}, expectedDigest: ${JSON.stringify(digest)}, journalRoot: ${JSON.stringify(journals)},
      write: async () => { await writeFile(${JSON.stringify(join(project, 'draft.json'))}, 'partial write'); process.exit(77); }, validate: async () => {} });`);
  const child = spawn(process.execPath, [script], { windowsHide: true, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 77);
  const names = (await readdir(journals)).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 1);
  const record = JSON.parse(await readFile(join(journals, names[0]), 'utf8'));
  assert.equal(record.phase, 'committing');
  assert.equal(await directoryDigest(record.backup), digest);
  let wrote = false;
  await assert.rejects(transactionalWrite({ project, journalRoot: journals, expectedDigest: await directoryDigest(project),
    write: async () => { wrote = true; }, validate: async () => {} }), /recovery inspection/);
  assert.equal(wrote, false);
});

test('a permission failure after a partial write restores the complete project', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-permission-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'); await mkdir(project); await writeFile(join(project, 'draft.json'), 'original');
  const digest = await directoryDigest(project);
  await assert.rejects(transactionalWrite({ project, journalRoot: join(root, 'journals'), expectedDigest: digest,
    write: async () => { await writeFile(join(project, 'draft.json'), 'partial'); throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }); },
    validate: async () => {} }), /complete original was restored/);
  assert.equal(await directoryDigest(project), digest);
});
