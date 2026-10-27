import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { findExecutable } from '../src/server/platform/runtime.mjs';
import { motionPython, motionRuntimeReady, compatibleMotionPython } from '../src/server/editing/motion-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
if (!await motionRuntimeReady(root)) {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Motion analysis setup supports Windows and macOS.');
  let python = await compatibleMotionPython();
  if (!python && process.platform === 'darwin' && findExecutable('brew')) {
    await run(findExecutable('brew'), ['install', 'python@3.13'], { cwd: root, timeout: 600000, maxBuffer: 2000000 });
    python = await compatibleMotionPython();
  }
  if (!python) throw new Error('Install Python 3.10–3.13 to enable local frame measurement.');
  await mkdir(join(root, '.local-tools'), { recursive: true });
  const options = { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 2000000 };
  await run(python, ['-I', '-c', 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,13), "Local motion analysis requires Python 3.10–3.13"'], options);
  await run(python, ['-I', '-m', 'venv', join(root, '.local-tools', 'motion-python')], options);
  await run(motionPython(root), ['-I', '-m', 'pip', '--isolated', 'install', '--require-hashes', '--no-deps', '-r', join(root, 'toolchain', 'motion-requirements.txt')], options);
  if (!await motionRuntimeReady(root)) throw new Error('Local motion analysis did not pass its version check.');
}
console.log('Local frame measurement is ready (OpenCV 4.12.0, NumPy 2.2.6).');
