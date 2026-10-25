import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local-tools');
const bin = join(local, 'bin');
const stateFile = join(local, 'setup-state.json');
const ffmpeg = join(bin, 'ffmpeg.exe');
const ffprobe = join(bin, 'ffprobe.exe');
const release = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip';
const archive = join(local, 'ffmpeg-9.0.2-essentials_build.zip');
const toolchain = join(root, 'toolchain');

async function status(stage, progress, detail, error = null) {
  await mkdir(local, { recursive: true });
  await writeFile(stateFile, JSON.stringify({
    stage, progress, detail, error, updatedAt: new Date().toISOString(),
  }), 'utf8');
}

function run(command, args, cwd = root) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: command === 'pnpm.cmd',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
    child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
    child.once('error', rejectRun);
    child.once('close', (code) => {
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(command + ' exited with code ' + code + ': ' + output));
    });
  });
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadFfmpeg() {
  if (existsSync(ffmpeg) && existsSync(ffprobe)) return;
  if (process.platform !== 'win32') throw new Error('The automatic FFmpeg installer currently supports Windows only.');

  await status('download', 4, 'Checking FFmpeg package');
  const checksumResponse = await fetch(release + '.sha256');
  if (!checksumResponse.ok) throw new Error('Could not retrieve the FFmpeg checksum.');
  const expected = (await checksumResponse.text()).match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase();
  if (!expected) throw new Error('FFmpeg checksum was not recognized.');

  let verified = existsSync(archive) && (await fileHash(archive)) === expected;
  if (!verified) {
    const response = await fetch(release);
    if (!response.ok || !response.body) throw new Error('FFmpeg download failed (HTTP ' + response.status + ').');
    const total = Number(response.headers.get('content-length') || 0);
    const temporary = archive + '.partial';
    const target = await open(temporary, 'w');
    const reader = response.body.getReader();
    let received = 0;
    let lastPercent = -1;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await target.write(value);
        received += value.byteLength;
        const percent = total ? Math.min(69, 5 + Math.floor(received / total * 64)) : 5;
        if (percent > lastPercent) {
          lastPercent = percent;
          await status('download', percent, 'Downloading FFmpeg media tools');
        }
      }
    } finally {
      await target.close();
    }
    if ((await fileHash(temporary)) !== expected) throw new Error('FFmpeg checksum verification failed.');
    await copyFile(temporary, archive);
    verified = true;
  }
  if (!verified) throw new Error('FFmpeg archive is unavailable.');

  await status('extract', 72, 'Installing FFmpeg and FFprobe');
  const extractDir = join(local, 'ffmpeg-extracted');
  await mkdir(extractDir, { recursive: true });
  await run('tar', ['-xf', archive, '-C', extractDir]);
  const folders = await readdir(extractDir, { withFileTypes: true });
  const folder = folders.find((item) => item.isDirectory() && item.name.startsWith('ffmpeg-'));
  if (!folder) throw new Error('FFmpeg package layout was not recognized.');
  const extractedBin = join(extractDir, folder.name, 'bin');
  await mkdir(bin, { recursive: true });
  await copyFile(join(extractedBin, 'ffmpeg.exe'), ffmpeg);
  await copyFile(join(extractedBin, 'ffprobe.exe'), ffprobe);
  await run(ffmpeg, ['-version']);
  await run(ffprobe, ['-version']);
}

async function installMotionTools() {
  const remotion = join(toolchain, 'node_modules', 'remotion', 'package.json');
  const hyperframes = join(toolchain, 'node_modules', 'hyperframes', 'package.json');
  if (existsSync(remotion) && existsSync(hyperframes)) return;
  await status('motion', 82, 'Installing Remotion and HyperFrames with pnpm');
  await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['install', '--no-frozen-lockfile', '--ignore-workspace'], toolchain);
  if (!existsSync(remotion) || !existsSync(hyperframes)) {
    throw new Error('The motion tool packages were not installed.');
  }
}

try {
  await status('starting', 2, 'Preparing the local editing workspace');
  await downloadFfmpeg();
  await status('motion', 80, 'Checking motion and graphics tools');
  await installMotionTools();
  await status('ready', 100, 'Video tools are ready');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await status('error', 0, 'Setup needs attention', message);
  process.exitCode = 1;
}
