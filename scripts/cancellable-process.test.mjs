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
  let pid;
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', 'console.log(process.pid); setInterval(() => {}, 1000);'],
    { cwd: process.cwd(), timeoutMs: 10000, signal: controller.signal, onLine: (line) => {
      pid = Number(line);
      controller.abort(new DOMException('Cancelled by test', 'AbortError'));
    } }), { name: 'AbortError' });
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0));
});

test('Windows cancellation also stops child processes', { skip: process.platform !== 'win32' }, async () => {
  const controller = new AbortController();
  let descendantPid;
  const code = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(child.pid); setInterval(()=>{},1000);';
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', code],
    { cwd: process.cwd(), timeoutMs: 10000, signal: controller.signal, onLine: (line) => {
      descendantPid = Number(line);
      controller.abort(new DOMException('Cancelled by test', 'AbortError'));
    } }), { name: 'AbortError' });
  assert.ok(descendantPid > 0);
  assert.throws(() => process.kill(descendantPid, 0));
});

test('rejects a cancelled signal before starting and stops timed-out work', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled by test', 'AbortError'));
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', 'process.exit(0)'],
    { cwd: process.cwd(), timeoutMs: 5000, signal: controller.signal, onLine() {} }), { name: 'AbortError' });
  await assert.rejects(runCancellableProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    { cwd: process.cwd(), timeoutMs: 150, onLine() {} }), /time limit/);
});
