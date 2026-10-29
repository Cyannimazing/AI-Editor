import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { platformPaths } from '../src/server/platform/runtime.mjs';
import { launchNativeApplication, launchFailureReceipt } from '../src/server/capcut/native-launch.mjs';

const run = promisify(execFile);
const [action, project] = process.argv.slice(2);
const paths = platformPaths();

async function running() {
  if (process.platform === 'darwin') {
    try { const { stdout } = await run('/usr/bin/pgrep', ['-x', 'CapCut'], { timeout: 10000 }); return Boolean(stdout.trim()); }
    catch (error) { if (error.code === 1) return false; throw error; }
  }
  const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 });
  return /"CapCut\.exe"/i.test(stdout);
}

if (action === 'status') {
  process.stdout.write(JSON.stringify({ running: await running() }));
} else if (action === 'close') {
  if (process.platform === 'darwin') {
    if (await running()) await run('/usr/bin/osascript', ['-e', 'tell application "CapCut" to quit'], { timeout: 15000 });
  } else if (await running()) {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(import.meta.dirname, 'native-close-windows.ps1')], { windowsHide: true, timeout: 28000 });
  }
  const deadline = Date.now() + 30000;
  while (await running()) {
    if (Date.now() > deadline) throw new Error('CapCut did not finish closing. Resolve its save/dialog window; no draft write is allowed while it is running.');
    await new Promise((done) => setTimeout(done, 500));
  }
  process.stdout.write(JSON.stringify({ closed: true }));
} else if (action === 'open') {
  const draft = project && ['draft_content.json', 'draft_info.json'].map(name => join(resolve(project), name)).find(existsSync);
  if (!draft) throw new Error('Expected a saved CapCut project directory.');
  if (await running()) throw new Error('Close CapCut before opening the review candidate.');
  const executable = paths.capcut;
  if (!existsSync(executable)) throw new Error('CapCut executable was not found.');
  try {
    const launch = process.platform === 'darwin'
      ? await launchNativeApplication('/usr/bin/open', ['-a', executable, draft], { waitForExit: true })
      : await launchNativeApplication(executable, [draft]);
    process.stdout.write(JSON.stringify({ ...launch, project: resolve(project) }));
  } catch (error) {
    process.stderr.write(JSON.stringify(launchFailureReceipt(error)) + '\n');
    throw error;
  }
} else {
  throw new Error('Usage: capcut-session.mjs status | close | open <project>');
}
