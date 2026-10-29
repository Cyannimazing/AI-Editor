import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Numeric launch status survives a short-lived Node wrapper without copying stderr or paths. */
export function launchFailureReceipt(error) {
  return { kind: 'native-launch-failure', launchExitCode: Number.isInteger(error.code) ? error.code : null };
}

/** Launch handoff only. It does not prove that the requested project is visible. */
export async function launchNativeApplication(executable, args, { waitForExit = false, signal } = {}) {
  signal?.throwIfAborted();
  if (waitForExit) {
    await run(executable, args, { timeout: 30000, maxBuffer: 64000, signal, windowsHide: true });
    return { status: 'handoff_accepted', projectVisible: false, exitCode: 0 };
  }
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  child.unref();
  return { status: 'handoff_accepted', projectVisible: false };
}
