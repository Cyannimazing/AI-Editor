import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pictureBounds, stablePictureCrop, pictureFramingPolicy, preparePictureMedia } from '../src/server/editing/picture-framing.mjs';
import { plannedMotionDefects } from '../src/server/editing/motion-comparison.mjs';
import { mediaTool } from '../src/server/platform/runtime.mjs';

test('paired stable edge padding is removed; dark scenes, one-sided shadows and moving edges are retained', () => {
  const image = Buffer.alloc(200 * 300);
  for (let y = 40; y < 260; y++) image.fill(150, y * 200, (y + 1) * 200);
  const bounds = pictureBounds(image, 200, 300);
  assert.deepEqual(stablePictureCrop([bounds, bounds, bounds], 200, 300), { x: 0, y: 40, width: 200, height: 220 });
  for (const samples of [[bounds, { ...bounds, top: 50 }, bounds], [null, null, null],
    Array(3).fill({ ...bounds, bottom: 300 })]) {
    assert.deepEqual(stablePictureCrop(samples, 200, 300), { x: 0, y: 0, width: 200, height: 300 });
  }
  assert.equal(pictureBounds(Buffer.alloc(200 * 300), 200, 300), null);
  assert.equal(pictureFramingPolicy('Match movement and fill the picture'), 'fill-picture');
  assert.equal(pictureFramingPolicy('Keep the black bars'), 'preserve-borders');
  assert.equal(pictureFramingPolicy('Match movement', true), 'existing-canvas');
});

test('full-frame coverage checks motion between keys even without shared reference landmarks', () => {
  const source = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, keyframes: [] };
  const report = { samples: [], fullFrameCoverage: { duration: 2, fps: 30 } }, size = { width: 720, height: 1280 };
  assert.deepEqual(plannedMotionDefects({ source }, report, size), []);
  const gap = { ...source, keyframes: [{ property: 'x', time: 0, value: 0, easing: 'linear' }, { property: 'x', time: 1, value: 0.4, easing: 'ease-out' }] };
  assert.ok(plannedMotionDefects({ source: gap }, report, size).length);
  const covered = { ...gap, scale: 1.5 };
  assert.deepEqual(plannedMotionDefects({ source: covered }, report, size), []);
});

test('source preparation preserves original bytes, audio and duration, and delivers filled decoded frames', async t => {
  let ffmpeg; try { ffmpeg = mediaTool('ffmpeg'); } catch { t.skip('FFmpeg required'); return; }
  const root = join(process.cwd(), '.local-tools/native-assets'); await mkdir(root, { recursive: true });
  const job = await mkdtemp(join(root, 'test-picture-')); t.after(() => rm(job, { recursive: true, force: true }));
  const path = join(job, 'raw.mp4'), run = promisify(execFile);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-vf', 'pad=320:240:0:30:black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path], { windowsHide: true, timeout: 30000 });
  const before = await readFile(path);
  const result = await preparePictureMedia({ source: path, job, name: 'source-picture' });
  assert.deepEqual([result.width, result.height], [320, 180]); assert.equal(result.changed, true);
  assert.deepEqual(await readFile(path), before); assert.ok(Math.abs(result.duration - 1) < 0.05);
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', result.path, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1000000, windowsHide: true });
  assert.deepEqual(pictureBounds(stdout, 320, 180), { left: 0, top: 0, right: 320, bottom: 180 });
  assert.equal(result.receipt.original.audio, 1);
  await assert.rejects(preparePictureMedia({ source: import.meta.filename, job, name: 'source-picture' }), /job-owned/);
});
