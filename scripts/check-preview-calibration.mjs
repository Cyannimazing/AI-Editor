// Compare actual player pixels with the known-motion fixture, without export.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaTool } from '../src/server/platform/runtime.mjs';
const run = promisify(execFile);
const receiptPath = resolve(process.argv[2]), receipt = JSON.parse(await readFile(receiptPath));
if (receipt.kind !== 'capcut-native-preview' || receipt.status !== 'captured') throw new Error('Expected completed player capture.');
const job = resolve(receiptPath, '../..'), observations = [], failures = [];
async function measure(file, time) {
  const { stdout } = await run(mediaTool('ffmpeg'), ['-v', 'error', ...(time === undefined ? [] : ['-ss', String(time)]), '-i', file,
    '-vf', 'scale=640:360', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 2_000_000, windowsHide: true });
  let red = 0, sumX = 0, sumY = 0, text = 0;
  if (stdout.length !== 640 * 360 * 3) throw new Error('Missing calibration frame.');
  for (let i = 0; i < stdout.length; i += 3) {
    const x = i / 3 % 640, y = Math.floor(i / 3 / 640), [r, g, b] = stdout.subarray(i, i + 3);
    if (r > 180 && g < 65 && b < 65) { red++; sumX += x; sumY += y; }
    if (y > 210 && y < 320 && r > 190 && g > 190 && b > 190) text++;
  }
  return { red, x: red ? sumX / red : null, y: red ? sumY / red : null, text };
}
for (const sample of receipt.samples) {
  const actual = await measure(sample.path), expected = await measure(join(job, 'preview.mp4'), sample.time);
  observations.push({ time: sample.time, actual, expected });
  if (sample.time < 2 && (actual.x === null || expected.x === null || Math.abs(actual.x - expected.x) > 4 || Math.abs(actual.y - expected.y) > 4 || Math.abs(actual.red - expected.red) > 600)) failures.push(`Movement or sizing mismatch at ${sample.time}s.`);
  if (sample.time >= 2 && actual.red > 10) failures.push('Opacity hold did not disappear.');
  if (actual.text < 300) failures.push('Title is missing.');
}
const report = { kind: 'native-player-calibration', receiptPath, observations, failures, passed: failures.length === 0,
  scope: 'Windows fixture player pixels: x movement/easing, opacity hold, native text. No audio or macOS acceptance claim.' };
await writeFile(join(job, 'player-calibration-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
