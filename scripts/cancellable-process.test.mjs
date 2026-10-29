import assert from 'node:assert/strict';
import test from 'node:test';
import { runCancellableProcess } from '../src/lib/cancellable-process.ts';

test('streams process output and completes normally', async () => {
  const lines = [];
  await runCancellableProcess(process.execPath, ['-e', 'console.log("ready"); console.error("detail");'],
    { cwd: process.cwd(), timeoutMs: 5000, onLine: (line) => lines.push(line) });
  assert.ok(lines.includes('ready'));
  assert.ok(lines.includes('detail'));
});

test('cancellation stops an active process', async () => {
  const controller = new AbortController();
  let pid; const lines = [];
  const code = 'process.stdout.write("READY " + process.pid + "\\nnon-PID diagnostic\\n"); console.error("startup diagnostic"); setInterval(() => {}, 1000);';
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', code],
    { cwd: process.cwd(), timeoutMs: 10000, signal: controller.signal, onLine: (line) => {
      lines.push(line);
      const ready = /^READY ([1-9]\d*)$/.exec(line);
      if (!ready || pid !== undefined) return;
      pid = Number(ready[1]);
      controller.abort(new DOMException('Cancelled by test', 'AbortError'));
    } }), { name: 'AbortError' });
  assert.ok(Number.isSafeInteger(pid) && pid > 0, `No PID readiness marker received: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('non-PID diagnostic'), 'Ordinary output must not overwrite the ready PID.');
  assert.throws(() => process.kill(pid, 0));
});

test('Windows cancellation also stops child processes', { skip: process.platform !== 'win32' }, async () => {
  const controller = new AbortController();
  let descendantPid;
  const code = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log("READY " + child.pid); setInterval(()=>{},1000);';
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', code],
    { cwd: process.cwd(), timeoutMs: 10000, signal: controller.signal, onLine: (line) => {
      const ready = /^READY ([1-9]\d*)$/.exec(line);
      if (!ready || descendantPid !== undefined) return;
      descendantPid = Number(ready[1]);
      controller.abort(new DOMException('Cancelled by test', 'AbortError'));
    } }), { name: 'AbortError' });
  assert.ok(descendantPid > 0);
  assert.throws(() => process.kill(descendantPid, 0));
});

test('POSIX cancellation also stops the detached process group', { skip: process.platform === 'win32' }, async () => {
  const controller = new AbortController(); let descendantPid;
  const code = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e",\'console.log("READY " + process.pid); setInterval(()=>{},1000);\'],{stdio:["ignore","pipe","ignore"]}); child.stdout.pipe(process.stdout); setInterval(()=>{},1000);';
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', code], {
    cwd: process.cwd(), timeoutMs: 10000, signal: controller.signal, onLine: line => {
      const ready = /^READY ([1-9]\d*)$/.exec(line);
      if (!ready || descendantPid !== undefined) return;
      descendantPid = Number(ready[1]); controller.abort(new DOMException('Cancelled by test', 'AbortError'));
    },
  }), { name: 'AbortError' });
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  // A killed descendant may briefly remain a zombie until the OS reaps it.
  const deadline = Date.now() + 3000;
  while (true) {
    try { process.kill(descendantPid, 0); }
    catch (error) { assert.equal(error.code, 'ESRCH'); break; }
    assert.ok(Date.now() < deadline, `Cancelled descendant ${descendantPid} is still present.`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('rejects a cancelled signal before starting and stops timed-out work', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled by test', 'AbortError'));
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', 'process.exit(0)'],
    { cwd: process.cwd(), timeoutMs: 5000, signal: controller.signal, onLine() {} }), { name: 'AbortError' });
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    { cwd: process.cwd(), timeoutMs: 150, onLine() {} }), /time limit/);
});
