import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { extractTimelineClip } from '../src/server/editing/clip-extraction.mjs';

const run = promisify(execFile);
async function fixture(t, rate = 30, variable = false) {
  const base = join(process.cwd(), '.local-tools/native-assets'); await mkdir(base, { recursive: true });
  const job = await mkdtemp(join(base, 'test-extraction-')); t.after(() => rm(job, { recursive: true, force: true }));
  const source = join(job, 'original.mp4'), output = join(job, 'raw.mp4');
  await run(mediaTool('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=160x120:r=${rate}:d=3`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    ...(variable ? ['-vf', 'select=if(lt(t\\,1.5)\\,not(mod(n\\,5))\\,1)', '-fps_mode', 'vfr'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source],
  { timeout: 30000, windowsHide: true });
  return { source, output, job };
}
const clip = (sourceStart = 0, duration = 2.21) => ({
  source_timerange: { start: Math.round(sourceStart * 1e6), duration: Math.round(duration * 1e6) },
  target_timerange: { start: 0, duration: Math.round(duration * 1e6) }, speed: 1, reverse: false,
});

test('a low-rate source prepares at the project FPS without changing original timing or audio', async t => {
  const files = await fixture(t, 5), before = await readFile(files.source), segment = clip(0.4), original = structuredClone(segment);
  const { probe } = await extractTimelineClip({ ...files, segment, fps: 30 });
  assert.ok(Math.abs(Number(probe.format.duration) - 2.21) <= 1 / 30 + 0.001);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.avg_frame_rate, '30/1');
  assert.equal(probe.streams.filter(stream => stream.codec_type === 'audio').length, 1);
  assert.deepEqual(await readFile(files.source), before); assert.deepEqual(segment, original);
  const { initDraft } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { loadDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const stagingRoot = join(process.cwd(), '.local-tools/staging'); await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(join(stagingRoot, 'test-extraction-')); t.after(() => rm(staging, { recursive: true, force: true }));
  const { draftPath } = initDraft({ name: 'candidate', draftsDir: staging,
    templateDir: join(process.cwd(), 'toolchain/node_modules/capcut-cli/templates/_init'), deferRegistration: true });
  await writeFile(join(files.job, 'original-draft.json'), JSON.stringify(loadDraft(draftPath).draft));
  await writeFile(join(files.job, 'spec.json'), JSON.stringify({ source: { path: files.output, duration: 2.21, width: 160, height: 120, fps: 30 } }));
  await writeFile(join(files.job, 'controlled-plan-1.json'), JSON.stringify({ version: 2, summary: 'Continuous 100% to 130% editable zoom',
    source: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1, keyframes: [
      { property: 'scale', time: 0, value: 1, easing: 'ease-in-out' }, { property: 'scale', time: 2.21, value: 1.3, easing: 'ease-in-out' } ] },
    texts: [], unsupported: [], techniques: [{ id: 'T1', name: 'Smooth zoom', start: 0, end: 2.21, evidence: 'Explicit requested scale endpoints', confidence: 1 }] }));
  await run(process.execPath, ['scripts/compile-controlled-edit.mjs', files.job, draftPath, '1'], { timeout: 30000, windowsHide: true });
  const built = loadDraft(draftPath).draft;
  assert.equal(built.duration, 2210000); assert.equal(built.tracks.length, 1);
  const native = built.tracks[0].segments[0]; assert.equal(native.volume, 1);
  for (const property of ['KFTypeScaleX', 'KFTypeScaleY']) {
    const keys = native.common_keyframes.find(group => group.property_type === property).keyframe_list;
    assert.deepEqual(keys.map(key => [key.time_offset, key.values[0]]), [[0, 1], [2210000, 1.3]]);
  }
});

test('variable-rate footage and constant-speed reverse clips retain timeline duration', async t => {
  const files = await fixture(t, 30, true), before = await readFile(files.source);
  for (const speed of [1, 0.5, 2]) {
    const segment = clip(0.4, 1), original = structuredClone(segment);
    segment.source_timerange.duration = Math.round(speed * 1e6); segment.speed = speed; segment.reverse = speed !== 1;
    Object.assign(original, structuredClone(segment));
    const result = await extractTimelineClip({ ...files, segment, fps: 30000 / 1001 });
    assert.ok(Math.abs(Number(result.probe.format.duration) - 1) < 0.06);
    assert.equal(result.report.timeline.speed, speed); assert.deepEqual(segment, original);
  }
  assert.deepEqual(await readFile(files.source), before);
});

test('a materially short source remains a failure with measured timing and a saved diagnostic', async t => {
  const files = await fixture(t), segment = clip(2, 2);
  await assert.rejects(extractTimelineClip({ ...files, segment, fps: 30 }), error => {
    assert.match(error.message, /expected 2\.000.*prepared 1\./i);
    assert.equal(error.diagnostic.code, 'CLIP_DURATION_MISMATCH');
    assert.equal(error.diagnostic.details.timeline.targetSeconds, 2);
    assert.ok(error.diagnostic.details.measured.containerSeconds < 1.1);
    return true;
  });
  const report = JSON.parse(await readFile(join(files.job, 'clip-extraction-report.json'), 'utf8'));
  assert.equal(report.status, 'duration_mismatch');
  assert.ok(!JSON.stringify(report).includes(files.source));
});
