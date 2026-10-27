// Measures exported pixels, rather than treating a serialized curve as proof.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';

const run = promisify(execFile);
const [jobInput, nativeInput] = process.argv.slice(2);
if (!jobInput || !nativeInput) throw new Error('Usage: check-native-calibration.mjs <fixture-job> <native-export>');
const job = resolve(jobInput), native = resolve(nativeInput);
const times = [0, 0.5, 1, 1.5, 2.5];
async function measure(file, time) {
  const { stdout } = await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-vf', 'scale=640:360', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 2_000_000, windowsHide: true, timeout: 15000 });
  if (stdout.length !== 640 * 360 * 3) throw new Error('Expected one decoded calibration frame.');
  let red = 0, sumX = 0, sumY = 0, text = 0;
  for (let i = 0; i < stdout.length; i += 3) {
    const x = i / 3 % 640, y = Math.floor(i / 3 / 640), [r, g, b] = stdout.subarray(i, i + 3);
    if (r > 180 && g < 65 && b < 65) { red++; sumX += x; sumY += y; }
    if (y > 210 && y < 320 && r > 190 && g > 190 && b > 190) text++;
  }
  return { time, redPixels: red, x: red ? sumX / red : null, y: red ? sumY / red : null, whiteTextPixels: text };
}
const measurements = [];
for (const time of times) measurements.push({ time, preview: await measure(join(job, 'preview.mp4'), time), native: await measure(native, time) });
const failures = [];
for (const { time, preview, native: observed } of measurements) {
  if (time < 2) {
    if (preview.x === null || observed.x === null || Math.abs(preview.x - observed.x) > 4 || Math.abs(preview.y - observed.y) > 4) failures.push(`Motion disagreement at ${time}s`);
    if (Math.abs(preview.redPixels - observed.redPixels) > 600) failures.push(`Graphic sizing disagreement at ${time}s`);
  } else if (preview.redPixels > 10 || observed.redPixels > 10) failures.push('Held opacity did not disappear.');
  if (preview.whiteTextPixels < 300 || observed.whiteTextPixels < 300) failures.push(`Editable title missing at ${time}s`);
}
if (measurements[1].native.x - measurements[0].native.x < 100) failures.push('Native motion is static or too small.');
const report = { version: 1, kind: 'manual-native-calibration', platform: process.platform,
  previewSha256: createHash('sha256').update(await readFile(join(job, 'preview.mp4'))).digest('hex'),
  nativeSha256: createHash('sha256').update(await readFile(native)).digest('hex'),
  nativeExport: native, measurements, failures, passed: failures.length === 0,
  scope: 'Disposable 640x360 fixture: x easing, opacity hold, graphic sizing and visible separate text. Does not certify other effects, audio, automatic export, other versions or macOS.' };
await writeFile(join(job, 'native-calibration-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
