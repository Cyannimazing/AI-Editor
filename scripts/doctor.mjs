import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findExecutable, codeModeHost, platformPaths } from '../src/server/platform/runtime.mjs';
import { previewBrowser } from '../src/server/platform/browser.mjs';
import { toolchainCurrent } from '../src/server/setup/toolchain.mjs';
import { motionRuntimeReady } from '../src/server/editing/motion-runtime.mjs';
import { checkNativePreflight } from '../src/server/capcut/native-preflight.mjs';
const run = promisify(execFile), checks = [];
const check = (name, ready, detail) => checks.push({ name, ready: Boolean(ready), detail });
check('Platform', ['win32', 'darwin'].includes(process.platform), `${process.platform}/${process.arch}`);
check('Node', Number(process.versions.node.split('.')[0]) === 24, process.version);
if (process.platform === 'darwin') {
  const version = (await run('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim();
  const [major, minor] = version.split('.').map(Number);
  check('macOS version', major > 13 || major === 13 && minor >= 5, `${version}; Node 24 requires 13.5 or later`);
}
const paths = platformPaths();
check('CapCut desktop', existsSync(paths.capcut), paths.capcut);
check('CapCut project folder', existsSync(paths.drafts), `${paths.drafts}; open CapCut and save a project once`);
for (const name of ['codex', 'ffmpeg', 'ffprobe']) {
  const path = findExecutable(name); check(name, path, path || 'Missing; follow README setup');
}
check('Codex tool host', codeModeHost(), 'Required for private editing MCP tools');
check('Editing packages', await toolchainCurrent(), 'Pinned local toolchain');
check('Motion analysis', await motionRuntimeReady(), 'Private Python environment');
check('Preview browser', previewBrowser(), 'Headless preview runtime');
try {
  const result = await run(findExecutable('codex'), ['login', 'status'], { windowsHide: true, timeout: 10000 });
  check('ChatGPT sign-in', /using ChatGPT/i.test(result.stdout + result.stderr), 'Uses your Codex account; no API key');
} catch { check('ChatGPT sign-in', false, 'Sign in with ChatGPT from AI-Editor'); }
if (process.argv.includes('--permissions') && process.platform === 'darwin') {
  try {
    const report = await checkNativePreflight();
    check('Desktop permissions', report.ok, report.message);
  } catch (error) { check('Desktop permissions', false, error.message); }
}
console.log(JSON.stringify({ readyForTest: checks.every(c => c.ready), checks,
  note: 'Readiness checks do not edit a project. Each editing job checks the actual CapCut result separately.' }, null, 2));
process.exitCode = checks.every(c => c.ready) ? 0 : 1;
