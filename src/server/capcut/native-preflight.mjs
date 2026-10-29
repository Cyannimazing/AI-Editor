import { mkdir, mkdtemp, lstat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { NativeUI } from './native-ui.mjs';
import { containedPath } from '../security/paths.ts';
import { nativeFailureMessages } from '../editing/errors.mjs';
import { captureFailureDiagnostic } from '../editing/diagnostics.mjs';

export function permissionCheckResult(state) {
  if (state?.platform !== 'darwin' || typeof state.accessibility !== 'boolean' || typeof state.screenRecording !== 'boolean'
    || !['framework', 'explicit'].includes(state.screenCaptureBinding))
    throw new Error('macOS native preflight compatibility error: Invalid driver status.');
  const ok = state.accessibility && state.screenRecording;
  const code = !state.accessibility ? 'NATIVE_MACOS_ACCESSIBILITY_REQUIRED' : !state.screenRecording
    ? 'NATIVE_MACOS_SCREEN_RECORDING_REQUIRED' : 'NATIVE_PREFLIGHT_READY';
  return { ok, compatibility: 'passed', code, accessibility: state.accessibility, screenRecording: state.screenRecording,
    screenCaptureBinding: state.screenCaptureBinding,
    message: ok ? 'Accessibility and Screen Recording checks passed. You can now try the disposable edit; Automation and actual CapCut player inspection are checked during that run.' : nativeFailureMessages[code] };
}

/** Same JXA process as editing, but no project, screenshot, AI worker or Apple event. */
export async function checkNativePreflight(signal) {
  const base = { version: 1, checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    captured: false, exported: false, uploaded: false, automation: 'not_checked', nativeVerified: false };
  if (process.platform !== 'darwin') return { ...base, ok: false, compatibility: 'not_applicable',
    code: 'NATIVE_PREFLIGHT_MAC_ONLY', message: 'This permission compatibility check is for macOS. No desktop operation was performed.' };
  const root = join(process.cwd(), '.local-tools/native-preflight');
  await mkdir(root, { recursive: true });
  await containedPath(process.cwd(), root);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Linked preflight storage is not supported.');
  const folder = await mkdtemp(join(root, 'check-'));
  let report;
  try {
    const state = await new NativeUI(folder, signal).perform('permission-status');
    report = { ...base, ...permissionCheckResult(state), reportId: basename(folder) };
  } catch (error) {
    signal?.throwIfAborted();
    error.nativeFailure = { stage: 'preflight', platform: 'darwin', samples: 0 };
    const diagnostic = captureFailureDiagnostic(error);
    // OS/JXA details stay in local storage. The returned/downloaded report is allowlisted.
    await writeFile(join(folder, 'failure.local.json'), JSON.stringify({ message: String(error.message).slice(0, 12000),
      stderr: String(error.stderr || '').slice(0, 12000) }, null, 2));
    report = { ...base, ok: false, compatibility: 'failed', code: diagnostic.code,
      message: diagnostic.message, diagnostic, reportId: basename(folder) };
  }
  await writeFile(join(folder, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
