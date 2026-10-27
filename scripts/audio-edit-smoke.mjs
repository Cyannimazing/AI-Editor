// Disposable end-to-end app test; uses the signed-in Codex allowance, never CapCut UI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';

const parent = join(process.cwd(), '.local-tools/smoke'); await mkdir(parent, { recursive: true });
const folder = await mkdtemp(join(parent, 'audio-')), source = join(folder, 'source.mp4');
await promisify(execFile)(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true, timeout: 30000 });
const base = 'http://localhost:3000', headers = { Origin: base, 'x-ai-editor': '1' };
const session = await fetch(`${base}/api/session`, { method: 'POST', headers }); if (!session.ok) throw new Error(await session.text());
headers.Cookie = session.headers.get('set-cookie')?.split(';')[0];
const response = await fetch(`${base}/api/helper`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-local-project' }) });
const created = await response.json(); if (!response.ok) throw new Error(created.error);
const body = new FormData(); body.set('projectId', created.projectId);
body.set('rawVideo', new Blob([await readFile(source)], { type: 'video/mp4' }), 'source.mp4');
body.set('prompt', 'Audio-engine acceptance fixture: retain this three-second video and its original test tone unchanged. Add a subtle original two-note music accent and a short soft noise sweep at one second using local procedural sound design. These are separate editable native audio tracks; include native volume fade keys. Explain each sound choice and keep source audio audible with no clipping. No captions, graphics, optical effects, visual transforms, downloads or paid services. Use the local MCP to inspect audio capabilities and read back the native tracks. The test footage is synthetic: do not invent dialogue or claim listening from images. Return v5 audio plan and independently check the constructed mix.');
const startedResponse = await fetch(`${base}/api/apply-native`, { method: 'POST', headers, body });
const started = await startedResponse.json(); if (!startedResponse.ok) throw new Error(started.error);
const record = { jobId: started.id, projectId: created.projectId, folder, source };
await writeFile(join(folder, 'job.json'), JSON.stringify(record)); await writeFile(join(parent, 'latest-audio.json'), JSON.stringify(record));
console.log(JSON.stringify(record));
