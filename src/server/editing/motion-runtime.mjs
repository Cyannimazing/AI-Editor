import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executableCandidates } from '../platform/runtime.mjs';

export async function compatibleMotionPython() {
  const candidates = [...new Set(['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'].flatMap(name => executableCandidates(name)))].filter(path =>
    existsSync(path) && !(process.platform === 'win32' && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(path)));
  for (const executable of candidates) {
    try {
      await promisify(execFile)(executable, ['-I', '-c', 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)'], { timeout: 10000, windowsHide: true });
      return executable;
    } catch { /* A macOS system Python or Windows alias may be incompatible. */ }
  }
  return null;
}

export function motionPython(root = process.cwd(), platform = process.platform) {
  return platform === 'win32'
    ? join(root, '.local-tools/motion-python/Scripts/python.exe')
    : join(root, '.local-tools/motion-python/bin/python3');
}

export async function motionRuntimeReady(root = process.cwd()) {
  const executable = motionPython(root);
  if (!existsSync(executable)) return false;
  try {
    const { stdout } = await promisify(execFile)(executable, ['-I', '-B', '-c', 'import cv2,numpy; print(cv2.__version__+"/"+numpy.__version__)'], { timeout: 10000, windowsHide: true });
    return stdout.trim() === '4.12.0/2.2.6';
  } catch { return false; }
}
