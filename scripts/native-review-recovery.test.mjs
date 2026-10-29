import test from 'node:test';
import assert from 'node:assert/strict';
import { launchNativeApplication } from '../src/server/capcut/native-launch.mjs';
import { captureFailureDiagnostic, buildJobDiagnosticReport } from '../src/server/editing/diagnostics.mjs';
import { runReviewCopy } from '../src/server/capcut/native-copy-receipt.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { runNativeCopyCommand } from '../src/server/capcut/native-copy.mjs';
import { editingFailureMessage, nativeFailureCode } from '../src/server/editing/errors.mjs';
import { permissionCheckResult } from '../src/server/capcut/native-preflight.mjs';

test('Mac screen-capture preflight binds a C symbol absent from JXA framework metadata', async () => {
  const source = await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8');
  for (const allowed of [true, false]) {
    const bridge = { NSString: { stringWithContentsOfFileEncodingError: () => '{"action":"preflight"}' },
      AXIsProcessTrusted: () => true };
    const context = vm.createContext({ $: bridge, ObjC: { import() {}, unwrap: x => x,
      bindFunction(name, signature) {
        // Apple's declared ABI is C bool with no parameters, not Objective-C BOOL or an integer.
        assert.equal(name, 'CGPreflightScreenCaptureAccess');
        assert.equal(JSON.stringify(signature), '["bool",[]]');
        bridge[name] = () => allowed;
      } } });
    vm.runInContext(source, context);
    if (allowed) assert.equal(JSON.parse(vm.runInContext('run(["request.json"])', context)).screenRecording, true);
    else assert.throws(() => vm.runInContext('run(["request.json"])', context), /Screen.*Recording permission/);
  }
});

test('unavailable or broken Mac preflight bindings are compatibility errors, never permission success', async () => {
  const source = await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8');
  for (const mode of ['missing', 'throws', 'no-symbol', 'invalid-result', 'call-throws']) {
    const bridge = { NSString: { stringWithContentsOfFileEncodingError: () => '{"action":"preflight"}' }, AXIsProcessTrusted: () => true };
    const objc = { import() {}, unwrap: x => x };
    if (mode !== 'missing') objc.bindFunction = name => {
      if (mode === 'throws') throw new Error('symbol unavailable');
      if (mode === 'invalid-result') bridge[name] = () => undefined;
      if (mode === 'call-throws') bridge[name] = () => { throw new Error('bridge invocation failed'); };
    };
    const context = vm.createContext({ $: bridge, ObjC: objc }); vm.runInContext(source, context);
    assert.throws(() => vm.runInContext('run(["request.json"])', context), /macOS native preflight compatibility error/);
  }
  const reported = new Error("Command failed: osascript\nexecution error: TypeError: $.CGPreflightScreenCaptureAccess is not a function. (-2700)");
  assert.equal(nativeFailureCode(reported), 'NATIVE_MACOS_PREFLIGHT_UNSUPPORTED');
  assert.match(editingFailureMessage(reported), /compatibility/i);
  assert.doesNotMatch(editingFailureMessage(reported), /enable.*permission|Accessibility permission is required/i);
});

test('standalone Mac permission check reports denials without opening apps, capturing or requesting access', async () => {
  const source = await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8');
  for (const [accessibility, recording] of [[false, false], [true, false], [false, true], [true, true]]) {
    const bridge = {
      NSString: { stringWithContentsOfFileEncodingError: () => '{"action":"permission-status"}' },
      AXIsProcessTrusted: () => accessibility,
      CGWindowListCopyWindowInfo: () => { throw new Error('Unexpected window enumeration'); },
      CGRequestScreenCaptureAccess: () => { throw new Error('Must not request permission'); },
    };
    const context = vm.createContext({ $: bridge, ObjC: { import() {}, unwrap: x => x,
      bindFunction(name) { bridge[name] = () => recording; } },
      Application: () => { throw new Error('Must not send Apple events'); } });
    vm.runInContext(source, context);
    const status = JSON.parse(vm.runInContext('run(["request.json"])', context));
    assert.equal(status.accessibility, accessibility);
    assert.equal(status.screenRecording, recording);
    assert.equal(status.screenCaptureBinding, 'explicit');
  }
});

test('permission report separates a working bridge from denied access and rejects malformed status', () => {
  const base = { platform: 'darwin', screenCaptureBinding: 'explicit' };
  for (const [accessibility, screenRecording, code] of [
    [true, true, 'NATIVE_PREFLIGHT_READY'],
    [false, true, 'NATIVE_MACOS_ACCESSIBILITY_REQUIRED'],
    [true, false, 'NATIVE_MACOS_SCREEN_RECORDING_REQUIRED'],
    [false, false, 'NATIVE_MACOS_ACCESSIBILITY_REQUIRED'],
  ]) {
    const result = permissionCheckResult({ ...base, accessibility, screenRecording, privatePath: '/private/user.mov' });
    assert.equal(result.ok, accessibility && screenRecording);
    assert.equal(result.compatibility, 'passed');
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /privatePath|user.mov/);
  }
  for (const state of [null, {}, { ...base, accessibility: true }, { ...base, accessibility: 'false', screenRecording: true },
    { ...base, platform: 'win32', accessibility: true, screenRecording: true }]) {
    assert.throws(() => permissionCheckResult(state), /compatibility error/);
  }
  const error = Object.assign(new Error('macOS native preflight compatibility error: PRIVATE_BINDING_DETAILS'),
    { nativeFailure: { stage: 'preflight', samples: 0, platform: 'darwin' } });
  const report = captureFailureDiagnostic(error);
  assert.equal(report.code, 'NATIVE_MACOS_PREFLIGHT_UNSUPPORTED');
  assert.equal(report.details.stage, 'preflight');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_BINDING_DETAILS/);
});

test('copy subprocess keeps an early Automation denial when later stack lines exceed the diagnostic tail', async () => {
  const script = `console.error('execution error: Not authorized to send Apple events to System Events. (-1743)');
    for(let i=0;i<30;i++) console.error('  at unimportant stack frame'); process.exitCode=1;`;
  await assert.rejects(runNativeCopyCommand(['-e', script], { cwd: process.cwd() }),
    error => /Automation/.test(editingFailureMessage(error)));
});

test('copy launch retains the inner command exit code separately from its Node wrapper', async () => {
  const moduleUrl = new URL('../src/server/capcut/native-launch.mjs', import.meta.url).href;
  const script = `import { launchNativeApplication, launchFailureReceipt } from ${JSON.stringify(moduleUrl)};
    try { await launchNativeApplication(process.execPath, ['-e', 'process.exitCode=9'], {waitForExit:true}); }
    catch (error) { process.stderr.write(JSON.stringify(launchFailureReceipt(error))+'\\n'); throw error; }`;
  await assert.rejects(runNativeCopyCommand(['--input-type=module', '-e', script], { cwd: process.cwd() }),
    error => error.launchExitCode === 9 && /Process exited with code 1/.test(error.message));
});

test('Mac launch waits for command exit and rejects failure after successful spawn', async () => {
  await assert.rejects(launchNativeApplication(process.execPath,
    ['-e', 'process.stderr.write("handoff refused"); process.exitCode = 9'], { waitForExit: true }),
  error => error.code === 9 && /handoff refused/.test(error.stderr));
  const result = await launchNativeApplication(process.execPath, ['-e', 'process.exitCode = 0'], { waitForExit: true });
  assert.equal(result.status, 'handoff_accepted');
  assert.equal(result.projectVisible, false);
});

test('native diagnostic export rejects arbitrary fields, step names and private failure messages', () => {
  const privateText = 'PRIVATE_CUSTOMER_TITLE';
  const diagnostic = captureFailureDiagnostic(Object.assign(new Error(privateText), { nativeFailure: {
    kind: 'review-copy', stage: 'open', candidateDigest: privateText, platform: 'darwin', published: true, registered: true,
    launchExitCode: 9, steps: [{ stage: 'publish', status: 'passed', command: privateText }, { stage: privateText, status: 'failed' }],
  } }));
  const report = buildJobDiagnosticReport({ status: 'blocked', diagnostic });
  assert.equal(report.failure.code, 'NATIVE_REVIEW_COPY_FAILED');
  assert.equal(report.failure.details.launchExitCode, 9);
  assert.deepEqual(report.failure.details.steps, [{ stage: 'publish', status: 'passed' }]);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CUSTOMER_TITLE/);
});

test('review-copy receipts expose the failing stage and never continue past a failed operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review receipt '));
  const stages = ['close', 'publish', 'register', 'link-media', 'identity', 'equivalence', 'open'];
  try {
    for (const failed of [...stages, undefined]) {
      const receiptPath = join(root, 'open.json');
      const operations = Object.fromEntries(stages.map(stage => [stage, async () => {
        // Checkpoint must exist before each trusted external action begins.
        const saved = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.equal(saved.stage, stage);
        assert.equal(saved.steps.at(-1).status, 'running');
        if (stage === failed) throw Object.assign(new Error('fixture failure'), { code: 12 });
      }]));
      const work = runReviewCopy({ receiptPath, revision: 'b'.repeat(64), projectName: 'Verify 12345678', platform: 'darwin' }, operations);
      if (failed) await assert.rejects(work, error => error.nativeFailure.stage === failed && error.nativeFailure.wrapperExitCode === 12);
      else assert.equal((await work).projectVisible, false);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      assert.deepEqual(receipt.steps.map(s => s.stage), failed ? stages.slice(0, stages.indexOf(failed) + 1) : stages);
      assert.equal(receipt.status, failed ? 'failed' : 'handoff_accepted');
      assert.equal(receipt.registered, !failed || stages.indexOf(failed) > stages.indexOf('register'));
      assert.equal(receipt.projectVisible, false);
      if (failed) assert.equal(receipt.diagnostic.details.stage, failed);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native Mac preflight identifies the missing permission before touching any CapCut window', async () => {
  const source = await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8');
  for (const [accessibility, recording, expected] of [[false, false, /Accessibility/], [true, false, /Recording/], [true, true, null]]) {
    const context = vm.createContext({ ObjC: { import() {}, unwrap: x => x }, $: {
      NSString: { stringWithContentsOfFileEncodingError: () => '{"action":"preflight"}' }, NSUTF8StringEncoding: 4,
      AXIsProcessTrusted: () => accessibility, CGPreflightScreenCaptureAccess: () => recording,
      CGWindowListCopyWindowInfo: () => { throw new Error('Window inspection must not run during preflight'); },
    } });
    vm.runInContext(source, context);
    if (expected) assert.throws(() => vm.runInContext('run(["request.json"])', context), expected);
    else assert.deepEqual(JSON.parse(vm.runInContext('run(["request.json"])', context)), { platform: 'darwin', accessibility: true, screenRecording: true, screenCaptureBinding: 'framework' });
  }
});
