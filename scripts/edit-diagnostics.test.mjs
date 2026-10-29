import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { captureFailureDiagnostic, buildJobDiagnosticReport } from '../src/server/editing/diagnostics.mjs';

test('blocked native review downloads retain the permission and failed stage without private paths', () => {
  const error = Object.assign(new Error('Command failed: osascript\nexecution error: Error: macOS Accessibility permission is required. (-2700)'), {
    nativeFailure: { stage: 'preflight', candidateDigest: 'a'.repeat(64), platform: 'darwin', samples: 0,
      receiptPath: '/Users/private/job/native-preview-123/capture.json', projectName: 'PRIVATE_TITLE' },
  });
  const diagnostic = captureFailureDiagnostic(error);
  const report = buildJobDiagnosticReport({ id: 'native', status: 'blocked', diagnostic });
  assert.equal(report.failure.code, 'NATIVE_MACOS_ACCESSIBILITY_REQUIRED');
  assert.equal(report.failure.stage, 'native_review');
  assert.equal(report.failure.details.stage, 'preflight');
  assert.equal(report.failure.details.candidateDigest, 'a'.repeat(64));
  assert.equal(report.failure.details.samples, 0);
  assert.match(report.failure.message, /Accessibility/);
  assert.doesNotMatch(JSON.stringify(report), /\/Users|PRIVATE_TITLE|Command failed/);
});

test('downloaded diagnostics retain measured timing and omit media, prompts and credentials', () => {
  const diagnostic = captureFailureDiagnostic(Object.assign(new Error('Clip duration mismatch'), {
    diagnostic: { version: 1, code: 'CLIP_DURATION_MISMATCH', stage: 'clip_extraction', details: {
      timeline: { targetSeconds: 15.866667, fps: 30 }, measured: { containerSeconds: 15.7, toleranceSeconds: 0.058333 },
    } },
  }));
  const report = buildJobDiagnosticReport({ id: 'job', status: 'failed', createdAt: '2026-10-29', updatedAt: '2026-10-29',
    error: `Bearer secret-token api_key=secret-key ${join(homedir(), 'Private', 'clip.mp4')}`,
    diagnostic, transcript: ['private transcript'], prompt: 'private prompt', controller: { token: 'secret-control' },
    result: { media: 'secret-media' } });
  assert.equal(report.failure.code, 'CLIP_DURATION_MISMATCH');
  assert.equal(report.failure.details.timeline.targetSeconds, 15.866667);
  assert.equal(report.failure.details.measured.containerSeconds, 15.7);
  assert.equal(report.job.status, 'failed');
  assert.equal(report.runtime.platform, process.platform);
  const serialized = JSON.stringify(report);
  for (const secret of ['secret-token', 'secret-key', homedir(), 'private transcript', 'private prompt', 'secret-control', 'secret-media']) assert.ok(!serialized.includes(secret), secret);
});

test('an older failed run explains that timing evidence was not recorded', () => {
  const report = buildJobDiagnosticReport({ id: 'older', status: 'failed', error: 'Preparation failed.' });
  assert.match(report.note, /older|not recorded/i);
  assert.equal(report.failure, undefined);
  assert.ok(!JSON.stringify(report).includes('undefined'));
});

test('generic failure exports cannot quote private requested captions or reviewer feedback', () => {
  const privateCaption = 'CONFIDENTIAL_CAMPAIGN_TITLE';
  const error = new Error(`Review failed: expected caption ${privateCaption}`);
  const report = buildJobDiagnosticReport({ id: 'private-caption', status: 'failed',
    error: error.message, diagnostic: captureFailureDiagnostic(error) });
  assert.ok(!JSON.stringify(report).includes(privateCaption));
  assert.equal(report.failure.code, 'EDIT_FAILED');
  assert.match(report.failure.message, /local app/);
});

test('source bounds and speed conflicts retain their timing classification when downloaded', () => {
  for (const code of ['SOURCE_INTERVAL_EXCEEDS_MEDIA', 'CLIP_SPEED_CONFLICT']) {
    const error = Object.assign(new Error('Timeline timing is inconsistent'), { diagnostic: { version: 1,
      stage: 'clip_extraction', code, details: { timing: { declaredSpeed: 1, serializedTargetRange: { duration: 15866666 } },
        bounds: { availableSeconds: 10.471667, deficitSeconds: 5.394999 }, mapping: { document: 'draft_info.json', scope: 'active' } } } });
    const report = buildJobDiagnosticReport({ id: 'timing', status: 'failed', diagnostic: captureFailureDiagnostic(error) });
    assert.equal(report.failure.code, code);
    assert.equal(report.failure.details.timing.serializedTargetRange.duration, 15866666);
    assert.equal(report.failure.details.bounds.availableSeconds, 10.471667);
    assert.equal(report.failure.details.mapping.document, 'draft_info.json');
  }
});
