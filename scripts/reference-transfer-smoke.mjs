// Explicit application acceptance probe. Uses the signed-in Codex allowance.
// The uploaded source is deliberately unrelated to the supplied motion reference.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';

const reference = process.argv[2];
if (!reference) throw new Error('Pass a local reference video for the disposable technique-transfer test.');
const parent = join(process.cwd(), '.local-tools/smoke'); await mkdir(parent, { recursive: true });
const folder = await mkdtemp(join(parent, 'transfer-')), source = join(folder, 'different-source.mp4');
await promisify(execFile)(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2.2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true, timeout: 30000 });
const base = 'http://localhost:3000', headers = { Origin: base, 'x-ai-editor': '1' };
const session = await fetch(`${base}/api/session`, { method: 'POST', headers });
if (!session.ok) throw new Error(await session.text());
headers.Cookie = session.headers.get('set-cookie')?.split(';')[0];
const createdResponse = await fetch(`${base}/api/helper`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-local-project' }) });
const created = await createdResponse.json(); if (!createdResponse.ok) throw new Error(created.error);
const body = new FormData(); body.set('projectId', created.projectId);
body.set('rawVideo', new Blob([await readFile(source)], { type: 'video/mp4' }), 'different-source.mp4');
body.set('reference', new Blob([await readFile(resolve(reference))], { type: 'video/mp4' }), 'motion-reference.mp4');
body.set('prompt', 'Keyframes only. Transfer the reference movement techniques onto this deliberately different test footage. Do not clone the scene, text, cloud or subject. Fill the canvas throughout. Reproduce the strong rapid opening push/reframe, its overshoot and rebound, then coherent continuing motion through the 2.2-second end. Adapt amplitude and anchor to this source so no empty edges appear. Use native editable curves with measured timing and easing, not a tiny generic zoom or a frozen final pose. Use discover_capabilities to check the installed motion/keyframe contract. Inspect individual reference and source frames with local MCP, evaluate the movement and read back the saved curves. No effects, graphics, text, audio changes or uploads. Independently compare and correct actual movement defects.');
const response = await fetch(`${base}/api/apply-native`, { method: 'POST', headers, body });
const started = await response.json(); if (!response.ok) throw new Error(started.error);
const record = { jobId: started.id, projectId: created.projectId, folder, source, reference: resolve(reference) };
await writeFile(join(folder, 'job.json'), JSON.stringify(record));
await writeFile(join(parent, 'latest-transfer.json'), JSON.stringify(record));
console.log(JSON.stringify(record));
