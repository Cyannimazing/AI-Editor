// Explicit developer smoke: uses the signed-in Codex allowance and disposable media.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';
const base = 'http://localhost:3000', run = promisify(execFile);
const root = join(process.cwd(), '.local-tools', 'smoke'); await mkdir(root, { recursive: true });
const folder = await mkdtemp(join(root, 'edit-')), source = join(folder, 'test-footage.mp4');
const effectSmoke = process.argv[2] === '--effects';
const supplied = effectSmoke ? undefined : process.argv[2];
if (supplied) await cp(join(supplied, 'raw.mp4'), source);
else await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { timeout: 30000, windowsHide: true });
const headers = { Origin: base, 'x-ai-editor': '1' };
const session = await fetch(`${base}/api/session`, { method: 'POST', headers });
if (!session.ok) throw new Error(await session.text());
headers.Cookie = session.headers.get('set-cookie').split(';')[0];
const setup = await (await fetch(`${base}/api/setup`, { headers })).json();
console.log(JSON.stringify({ stage: setup.stage, engine: setup.isolation }));
if (!setup.account?.signedIn || !setup.isolation?.available) throw new Error('Account or controlled engine is not ready.');
const create = await fetch(`${base}/api/helper`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-local-project' }) });
const created = await create.json(); if (!create.ok) throw new Error(created.error);
const body = new FormData(); body.set('projectId', created.projectId);
body.set('rawVideo', new Blob([await readFile(source)], { type: 'video/mp4' }), 'test-footage.mp4');
if (supplied) body.set('reference', new Blob([await readFile(join(supplied, 'reference.mp4'))], { type: 'video/mp4' }), 'reference.mp4');
body.set('prompt', supplied ? 'Recreate the editing techniques in the reference on this footage. Measure both videos. Match composition, graphic shape, exact text, entrance motion, keyframes, optical treatments and pacing. Generate required decorative assets locally and retain their sources; keep native text and controls editable. Have specialists check the measurements, compare the result, and correct visible mismatches. Do not declare a technique implemented just because it is named in a plan. No paid services or media uploads.' : 'Keep this 3-second test clip and audio duration unchanged. Add an editable native zoom from scale 1 at 0 seconds to 1.1 at 3 seconds, linear. Add editable white text reading exactly AI-Editor test, size 36 pixels, centered, for all 3 seconds. Do not add any other changes.');
if (effectSmoke) body.set('prompt', 'Keep this 3-second clip duration unchanged. Apply the free native Motion Blur video effect to the source for all 3 seconds. Use the connected official CapCut plugin automatically to find and apply it, with its actual default controls. Add editable linear native X position keyframes at 0 seconds = -0.1 and 3 seconds = 0.1. No text, decorative assets, audio changes or other effects. No paid services or uploads. Inspect the construction and preview; distinguish native effects omitted by the preview from visible defects.');
const start = await fetch(`${base}/api/apply-native`, { method: 'POST', headers, body });
const job = await start.json(); if (!start.ok) throw new Error(job.error);
await writeFile(join(folder, 'job.json'), JSON.stringify(job));
console.log(JSON.stringify({ jobId: job.id }));
let next = 0;
for (;;) {
  const response = await fetch(`${base}/api/apply-native?id=${job.id}&since=${next}`, { headers });
  const data = await response.json(); if (!response.ok) throw new Error(data.error);
  next = data.next;
  for (const line of data.transcript) if (!line.startsWith('{')) console.log(line.slice(0, 500));
  if (!['running', 'cancelling', 'committing'].includes(data.status)) {
    await writeFile(join(folder, 'result.json'), JSON.stringify(data));
    console.log(JSON.stringify({ status: data.status, error: data.error, result: data.result, folder }));
    if (!data.result) process.exitCode = 1;
    break;
  }
  await new Promise(done => setTimeout(done, 2000));
}
