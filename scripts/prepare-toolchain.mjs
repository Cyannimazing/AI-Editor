import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolchainCurrent, toolchainFingerprint, toolchainPackagesPresent } from '../src/server/setup/toolchain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 LTS to start AI-Editor.');
if (!await toolchainCurrent(root)) {
  console.log('Preparing pinned editing packages for this computer. First launch needs an internet connection.');
  const windows = process.platform === 'win32';
  const child = spawn(windows ? 'pnpm.cmd' : 'pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-workspace'],
    { cwd: join(root, 'toolchain'), shell: windows, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0 || !await toolchainPackagesPresent(root)) throw new Error('Editing packages did not install completely. Check your connection and start the app again to resume.');
  await mkdir(join(root, '.local-tools'), { recursive: true });
  await writeFile(join(root, '.local-tools/toolchain-receipt.json'), JSON.stringify({ fingerprint: await toolchainFingerprint(root) }));
}
