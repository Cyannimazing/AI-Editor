import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExportProbe, nativeExportCommand, exactTextTarget } from '../src/server/capcut/native-export-policy.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryDigest } from '../src/server/editing/transaction.ts';
import { assertNativeEvidence, fileDigest } from '../src/server/capcut/native-capture.mjs';

test('native evidence rejects missing, truncated, mismatched or proxy output', () => {
  const expected = { duration: 3, width: 640, height: 360, fps: 30 };
  const probe = { format: { duration: '3.0' }, streams: [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1', duration: '3' }] };
  assert.doesNotThrow(() => validateExportProbe(probe, expected));
  assert.throws(() => validateExportProbe({ ...probe, streams: [] }, expected), /video/);
  assert.throws(() => validateExportProbe({ ...probe, format: { duration: '2.4' } }, expected), /duration/);
  assert.throws(() => validateExportProbe(probe, { ...expected, width: 1920 }), /resolution/);
  assert.throws(() => validateExportProbe(probe, { ...expected, fps: 60 }), /frame rate/);
  assert.throws(() => validateExportProbe(probe, { ...expected, duration: NaN }), /expectation/);
});

test('native approval rejects changed candidates, rendered evidence and referenced media', async () => {
  const job = await mkdtemp(join(tmpdir(), 'native-evidence-'));
  try {
    const candidate = join(job, 'candidate'); await mkdir(candidate);
    await writeFile(join(candidate, 'draft.json'), 'original');
    const output = join(job, 'export.mp4'), reviewVideo = join(job, 'review.mp4'), media = join(job, 'source.mp4');
    for (const file of [output, reviewVideo, media]) await writeFile(file, 'fixture');
    const receiptPath = join(job, 'capture.json');
    const receipt = { kind: 'capcut-native-export', status: 'captured', candidateDigest: await directoryDigest(candidate), platform: process.platform,
      capcutVersion: 'fixture', cloudSync: false, output, reviewVideo, outputSha256: await fileDigest(output), reviewSha256: await fileDigest(reviewVideo), assets: [{ path: media, sha256: await fileDigest(media) }] };
    await writeFile(receiptPath, JSON.stringify(receipt));
    await assertNativeEvidence(job, candidate, receiptPath);
    await writeFile(join(candidate, 'draft.json'), 'modified');
    await assert.rejects(assertNativeEvidence(job, candidate, receiptPath), /stale/);
    await writeFile(join(candidate, 'draft.json'), 'original');
    for (const file of [output, reviewVideo, media]) {
      await writeFile(file, 'changed');
      await assert.rejects(assertNativeEvidence(job, candidate, receiptPath), /changed/);
      await writeFile(file, 'fixture');
    }
    for (const change of [{ status: 'exporting' }, { cloudSync: true }, { kind: 'preview' }, { platform: 'different' }, { capcutVersion: '' }]) {
      await writeFile(receiptPath, JSON.stringify({ ...receipt, ...change }));
      await assert.rejects(assertNativeEvidence(job, candidate, receiptPath), /stale|incomplete/);
    }
  } finally { await rm(job, { recursive: true, force: true }); }
});

test('platform drivers pass paths as arguments and reject unsupported platforms', () => {
  const paths = { scriptRoot: '/a path', requestPath: '/a path/request.json' };
  const mac = nativeExportCommand('darwin', paths);
  assert.equal(mac.executable, '/usr/bin/osascript');
  assert.ok(mac.args.includes(paths.requestPath));
  assert.ok(nativeExportCommand('win32', paths).args.includes(paths.requestPath));
  assert.throws(() => nativeExportCommand('linux', paths), /platform/);
});

test('visual targets require an exact unique label in the current window', () => {
  const state = { width: 1000, height: 700, words: [{ text: 'Export', x: 800, y: 10, width: 70, height: 30 }] };
  assert.deepEqual(exactTextTarget(state, 'Export'), { x: 835, y: 25 });
  assert.throws(() => exactTextTarget(state, 'Upgrade'), /not found/);
  assert.throws(() => exactTextTarget({ ...state, words: [...state.words, ...state.words] }, 'Export'), /ambiguous/);
  assert.throws(() => exactTextTarget({ ...state, words: [{ ...state.words[0], x: -40 }] }, 'Export'), /bounds/);
});
