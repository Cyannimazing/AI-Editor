// Disposable, repeatable native execution fixture. Never targets a user project.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { loadDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
const run = promisify(execFile), root = process.cwd();
const jobs = join(root, '.local-tools/native-assets'), staging = join(root, '.local-tools/staging');
await mkdir(jobs, { recursive: true }); await mkdir(staging, { recursive: true });
const job = await mkdtemp(join(jobs, 'calibration-')), candidate = await mkdtemp(join(staging, 'calibration-'));
const created = JSON.parse((await run(process.execPath, [join(root, 'scripts/create-local-project.mjs'), `Native calibration ${Date.now()}`], { cwd: root, windowsHide: true })).stdout);
await cp(created.path, candidate, { recursive: true });
const source = join(job, 'raw.mp4');
await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
const pose = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, keyframes: [] };
const plan = { version: 4, summary: 'Native calibration: moving red square, held opacity, editable title.', source: { ...pose, volume: 1 },
  assets: [{ id: 'square', kind: 'svg', frameTime: 0, width: 100, height: 100, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#FF0000"/></svg>' }],
  overlays: [{ ...pose, assetId: 'square', start: 0, duration: 3, sourceStart: 0, volume: 0, blendMode: 'normal', scale: 0.2,
    keyframes: [{ property: 'x', time: 0, value: -0.6, easing: 'linear' }, { property: 'x', time: 1, value: 0.6, easing: 'ease-out' },
      { property: 'opacity', time: 0, value: 1, easing: 'hold' }, { property: 'opacity', time: 2, value: 0, easing: 'linear' }] }],
  texts: [{ ...pose, text: 'EDITABLE 36px', start: 0, duration: 3, fontSizePx: 36, color: '#FFFFFF', y: -0.6 }], effects: [], resourceQueries: [], unsupported: [],
  techniques: [{ id: 'motion', name: 'Measured movement and hold', start: 0, end: 3, evidence: 'Calibration fixture', confidence: 1, components: ['overlay-0'], expectedBehavior: 'Red square moves from x=-0.6 to x=0.6 by 1s, holds, disappears at 2s.', checks: ['Compare 0s, 0.5s, 1.5s, 2.5s.'] },
    { id: 'text', name: 'Native title', start: 0, end: 3, evidence: 'Calibration fixture', confidence: 1, components: ['text-0'], expectedBehavior: 'Separate white editable title below centre at 36 output pixels.', checks: ['Compare native text bounds to requested 36px size; inspect native text control.'] }] };
await writeFile(join(job, 'original-draft.json'), JSON.stringify(loadDraft(candidate).draft));
await writeFile(join(job, 'spec.json'), JSON.stringify({ source: { path: source, duration: 3, width: 640, height: 360, fps: 30, start: 0 } }));
await writeFile(join(job, 'controlled-plan-1.json'), JSON.stringify(plan));
await run(process.execPath, [join(root, 'scripts/compile-controlled-edit.mjs'), job, candidate, '1'], { cwd: root, windowsHide: true, timeout: 30000 });
const record = { job, candidate, expected: plan.techniques, nativeVerified: false };
await writeFile(join(root, '.local-tools/native-calibration.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record));
