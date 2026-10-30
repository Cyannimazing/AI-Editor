import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Status queries do not send Apple events, close windows or start CapCut. */
export async function assertCapCutClosed({ platform = process.platform, run = execute } = {}) {
  let running;
  if (platform === 'darwin') {
    try { const result = await run('/usr/bin/pgrep', ['-x', 'CapCut'], { timeout: 10000 }); running = Boolean(result.stdout.trim()); }
    catch (error) { if (error.code === 1) running = false; else throw error; }
  } else if (platform === 'win32') {
    const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'], { timeout: 10000, windowsHide: true });
    running = /"CapCut\.exe"/i.test(stdout);
  } else throw new Error('Unsupported desktop platform.');
  if (running) throw Object.assign(new Error('Save and close CapCut yourself before applying. Your candidate is retained; AI-Editor will not close or reopen CapCut.'), { code: 'CAPCUT_RUNNING' });
}

export function refuseDesktopControl() {
  throw new Error('Automatic CapCut desktop control is disabled. Review the app preview and open CapCut yourself when you are ready.');
}
