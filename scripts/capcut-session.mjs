import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [action, project] = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('Native CapCut review currently requires Windows.');

async function running() {
  const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 });
  return /"CapCut\.exe"/i.test(stdout);
}

if (action === 'status') {
  process.stdout.write(JSON.stringify({ running: await running() }));
} else if (action === 'close') {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-Process -Name CapCut -ErrorAction SilentlyContinue | ForEach-Object { if ($_.MainWindowHandle -ne 0) { [void]$_.CloseMainWindow() } }'],
  { windowsHide: true, timeout: 15000 });
  const deadline = Date.now() + 30000;
  while (await running()) {
    if (Date.now() > deadline) throw new Error('CapCut did not finish closing. Resolve its save/dialog window; no draft write is allowed while it is running.');
    await new Promise((done) => setTimeout(done, 500));
  }
  process.stdout.write(JSON.stringify({ closed: true }));
} else if (action === 'open') {
  if (!project || !existsSync(join(resolve(project), 'draft_content.json'))) throw new Error('Expected a saved CapCut project directory.');
  if (await running()) throw new Error('Close CapCut before opening the review candidate.');
  const executable = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'CapCut', 'Apps', 'CapCut.exe');
  if (!existsSync(executable)) throw new Error('CapCut executable was not found.');
  const child = spawn(executable, [join(resolve(project), 'draft_content.json')], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  child.unref();
  process.stdout.write(JSON.stringify({ opened: resolve(project) }));
} else {
  throw new Error('Usage: capcut-session.mjs status | close | open <project>');
}
