// Application routing smoke only. Uses disposable synthetic footage, exercises
// the real Codex planner, then cancels before an editing/quality acceptance run.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDraft, saveDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
import { addVideo } from '../toolchain/node_modules/capcut-cli/dist/factory.js';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { directoryDigest } from '../src/server/editing/transaction.ts';
const root = process.cwd(), base = 'http://localhost:3000', run = promisify(execFile);
const assets = join(root, '.local-tools/native-assets'); await mkdir(assets, { recursive: true });
const job = await mkdtemp(join(assets, 'project-scope-smoke-'));
const name = `Project scope check ${randomUUID().slice(0, 8)}`;
const created = JSON.parse((await run(process.execPath, ['scripts/create-local-project.mjs', name], { windowsHide: true })).stdout);
const loaded = loadDraft(created.path);
for (const [index, color] of ['blue', 'orange'].entries()) {
  const path = join(job, index ? 'Closing.mp4' : 'Opening.mp4');
  await run(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { windowsHide: true });
  addVideo(loaded.draft, loaded.filePath, { path, start: index * 1e6, duration: 1e6, sourceStart: 0, sourceDuration: 1e6, width: 640, height: 360, volume: 0 });
}
saveDraft(loaded.filePath, loaded.draft, loaded.store);
const originalDigest = await directoryDigest(created.path);
const headers = { Origin: base, 'x-ai-editor': '1' };
const session = await fetch(`${base}/api/session`, { method: 'POST', headers });
headers.Cookie = session.headers.get('set-cookie').split(';')[0];
const projectId = `local:${name}`;
const projects = await (await fetch(`${base}/api/helper?includeLocal=1`, { headers })).json();
const project = projects.projects.find(p => p.id === projectId); assert.equal(project.clips.length, 2);
const stale = new FormData(); stale.set('projectId', projectId); stale.set('editScope', 'clips'); stale.set('clipIds', '["stale-clip"]'); stale.set('prompt', 'Add a title');
const rejected = await fetch(`${base}/api/apply-native`, { method: 'POST', headers, body: stale });
assert.equal(rejected.ok, false); assert.match((await rejected.json()).error, /stale/);
const before = new Set(await readdir(assets));
const body = new FormData(); body.set('projectId', projectId);
body.set('prompt', 'Add an editable native title saying exactly Welcome on Opening.mp4 for its full duration. Keep Closing.mp4 unchanged. Preserve timing, movement, audio and all other content. No effects or generated audio.');
const response = await fetch(`${base}/api/apply-native`, { method: 'POST', headers, body });
const started = await response.json(); assert.equal(response.status, 202, JSON.stringify(started));
await writeFile(join(job, 'request.json'), JSON.stringify({ projectId, jobId: started.id }));
let plan, final, next = 0;
const deadline = Date.now() + 240000;
try {
  while (Date.now() < deadline) {
    const data = await (await fetch(`${base}/api/apply-native?id=${started.id}&since=${next}`, { headers })).json();
    next = data.next;
    for (const line of data.transcript) if (!line.startsWith('{')) console.log(line.slice(0, 250));
    for (const folder of (await readdir(assets)).filter(f => f.startsWith('project-edit-') && !before.has(f))) {
      const parsed = await readFile(join(assets, folder, 'project-plan.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (parsed) plan = parsed;
    }
    if (plan || !['running', 'cancelling'].includes(data.status)) { final = data; break; }
    await new Promise(done => setTimeout(done, 1000));
  }
} finally {
  await fetch(`${base}/api/apply-native?id=${started.id}`, { method: 'DELETE', headers });
  for (let i = 0; i < 30; i++) {
    final = await (await fetch(`${base}/api/apply-native?id=${started.id}&since=${next}`, { headers })).json();
    if (!['running', 'cancelling'].includes(final.status)) break;
    await new Promise(done => setTimeout(done, 1000));
  }
}
assert.ok(plan, final?.error || 'The application planner did not complete.');
assert.equal(plan.clips.find(c => c.clipId === project.clips[0].id).action, 'edit');
assert.equal(plan.clips.find(c => c.clipId === project.clips[1].id).action, 'keep');
assert.equal(plan.unsupported.length, 0);
assert.equal(await directoryDigest(created.path), originalDigest);
assert.equal(final.status, 'cancelled');
const receipt = { projectId, jobId: started.id, plan, status: final.status, originalUnchanged: true, nativeAcceptance: false };
await writeFile(join(job, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ passed: true, folder: job, projectId, status: final.status, nativeAcceptance: false }));
