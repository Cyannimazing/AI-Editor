import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directoryDigest } from '../editing/transaction.ts';
import { containedPath, assertNoLinks } from '../security/paths.ts';
import { mediaTool } from '../platform/runtime.mjs';
import { prepareNativeCopy } from './native-copy.mjs';
import { NativeUI } from './native-ui.mjs';
import { exactTextTarget, validateExportProbe } from './native-export-policy.mjs';
const run = promisify(execFile);

export async function fileDigest(path) {
  if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error('Native evidence must be a regular file.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

async function draftAt(path, signal) {
  const { stdout } = await run(process.execPath, [join(process.cwd(), 'scripts/capcut-draft.mjs'), 'active', path], { windowsHide: true, timeout: 30000, signal, maxBuffer: 30_000_000 });
  return JSON.parse(stdout).draft;
}

async function assetDigests(draft) {
  const paths = new Set([...(draft.materials.videos || []), ...(draft.materials.audios || [])].map(item => item.path).filter(Boolean));
  const assets = [];
  for (const path of paths) assets.push({ path, sha256: await fileDigest(path) });
  return assets;
}

/** The application, not the editor model, owns every action and evidence file. */
export async function captureNativeCandidate({ job, candidate, revision, start = 0, duration, width, height, signal, onLog = message => { void message; } }) {
  job = await containedPath(join(process.cwd(), '.local-tools/native-assets'), job);
  candidate = await containedPath(join(process.cwd(), '.local-tools/staging'), candidate);
  await assertNoLinks(candidate); await assertNoLinks(job);
  if (await directoryDigest(candidate) !== revision) throw new Error('Candidate changed before native capture.');
  const draft = await draftAt(candidate, signal);
  const assets = await assetDigests(draft);
  const folder = await mkdtemp(join(job, 'native-capture-'));
  const exportFolder = join(folder, 'export'); await mkdir(exportFolder);
  const journalPath = join(folder, 'capture.json');
  const journal = { version: 1, kind: 'capcut-native-export', candidateDigest: revision, platform: process.platform, status: 'preparing', startedAt: new Date().toISOString() };
  const checkpoint = async (status, extra = {}) => { Object.assign(journal, extra, { status }); await writeFile(journalPath, JSON.stringify(journal, null, 2)); };
  try {
    signal?.throwIfAborted();
    await checkpoint('preparing');
    if (process.platform === 'darwin') await new NativeUI(join(folder, 'permissions'), signal).perform('preflight');
    onLog('Opening an isolated CapCut copy for automatic native export. Keep the desktop unlocked while CapCut works.');
    const published = await prepareNativeCopy(candidate, revision, signal);
    await checkpoint('opening', { projectName: published.projectName, publishedPath: published.destination });
    const ui = new NativeUI(join(folder, 'ui'), signal);
    let state = await ui.waitFor(published.projectName);
    const inEditor = state.words.some(word => /timeline/i.test(word.text)) && state.words.some(word => word.text.toLowerCase() === published.projectName.toLowerCase() && word.y < 80);
    if (!inEditor) { await ui.openProject(state, published.projectName); state = await ui.waitFor(published.projectName, 45000, { x: 0, y: 0, width: 10000, height: 80 }); }
    await checkpoint('project_open', { capcutVersion: state.version, executable: state.executable });
    await ui.exportProject(state, published.projectName);
    state = await ui.waitFor('Resolution');
    exactTextTarget(state, published.projectName);
    // Select the destination through the OS folder picker; never type a command.
    await ui.clickField(state, 'Export to');
    if (process.platform === 'win32') {
      state = await ui.waitFor('Folder:');
      await ui.setField(state, 'Folder:', exportFolder);
      state = await ui.waitFor('Select Folder'); await ui.click(state, 'Select Folder');
    } else {
      state = await ui.perform();
      const choose = ['Choose', 'Open', 'Select'].find(label => state.words.some(word => word.text === label));
      if (!choose) throw new Error('Unsupported macOS export folder picker. Diagnostics retained; no export was submitted.');
      await ui.perform('folder-path', { window: state.window, width: state.width, height: state.height, executable: state.executable, anchor: choose, text: exportFolder });
      state = await ui.waitFor(choose); await ui.click(state, choose);
    }
    state = await ui.waitFor('Resolution');
    // Verification renders use a known 1080p profile. The editable project keeps
    // its original canvas; review frames are normalized to that canvas below.
    if (!state.words.some(word => word.text.toLowerCase() === '1080p')) {
      const point = exactTextTarget(state, 'Resolution');
      await ui.clickField(state, 'Resolution');
      state = await ui.waitFor('1080P', 10000, { x: 0, y: point.y + 15, width: state.width, height: state.height - point.y - 15 });
      await ui.click(state, '1080P', { x: 0, y: point.y + 15, width: state.width, height: state.height - point.y - 15 });
      state = await ui.waitFor('Resolution');
    }
    if (!state.words.some(word => word.text.toLowerCase() === 'mp4')) throw new Error('Choose MP4 as the CapCut export format. Automatic export will not use an unknown format.');
    const frameRate = Math.round(draft.fps || 30);
    if (frameRate !== 30) {
      if (![24, 25, 50, 60].includes(frameRate)) throw new Error(`CapCut export has no validated ${frameRate}fps profile.`);
      await ui.selectField(state, 'Frame rate', `${frameRate}fps`);
      state = await ui.waitFor('Resolution');
    }
    state = await ui.ensureLocalExport(state);
    const output = join(exportFolder, `${published.projectName}.mp4`);
    try { await stat(output); throw new Error('Native export destination already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const submittedAt = Date.now();
    await checkpoint('exporting', { output, cloudSync: false, submittedAt });
    const footer = 80 * (state.scale || 1);
    await ui.click(state, 'Export', { x: 0, y: state.height - footer, width: state.width, height: footer });
    onLog('CapCut is rendering the native verification video.');
    const canvas = draft.canvas_config, ratio = canvas.width / canvas.height;
    const expected = { duration: draft.duration / 1e6, width: ratio >= 1 ? Math.round(1080 * ratio / 2) * 2 : 1080,
      height: ratio >= 1 ? 1080 : Math.round(1080 / ratio / 2) * 2, fps: draft.fps || 30 };
    let measured, lastSize = -1, stable = 0;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const info = await stat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      // CapCut may preserve its own file timestamps. Freshness is established by
      // an unpredictable new directory and absence immediately before submission.
      if (info && info.size > 1000) {
        stable = info.size === lastSize ? stable + 1 : 0; lastSize = info.size;
        if (stable >= 2) {
          let probe;
          try { probe = await run(mediaTool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true, signal, timeout: 15000, maxBuffer: 2_000_000 }); }
          catch { signal?.throwIfAborted(); }
          if (probe) { measured = validateExportProbe(JSON.parse(probe.stdout), expected); break; }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!measured) throw new Error('CapCut native export did not finish within three minutes. Check its export dialog; the candidate and diagnostics are retained.');
    // Decode the complete file; merely finding an MP4 header is insufficient.
    await run(mediaTool('ffmpeg'), ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'], { windowsHide: true, signal, timeout: 120000 });
    const reviewVideo = join(folder, 'native-review.mp4');
    await run(mediaTool('ffmpeg'), ['-v', 'error', '-xerror', '-ss', String(start), '-i', output, '-t', String(duration), '-vf', `scale=${width}:${height}`, '-c:v', 'libx264', '-crf', '15', '-c:a', 'aac', reviewVideo], { windowsHide: true, signal, timeout: 120000 });
    if (await directoryDigest(candidate) !== revision) throw new Error('Candidate changed during native capture.');
    for (const asset of assets) if (await fileDigest(asset.path) !== asset.sha256) throw new Error('Candidate media changed during native capture.');
    await checkpoint('captured', { outputSha256: await fileDigest(output), reviewVideo, reviewSha256: await fileDigest(reviewVideo),
      media: measured, assets, excerpt: { start, duration, width, height }, completedAt: new Date().toISOString() });
    onLog('Native CapCut export decoded successfully. Comparing its timed output next.');
    return { receiptPath: journalPath, reviewVideo, receipt: journal };
  } catch (error) {
    await checkpoint(signal?.aborted ? 'cancelled' : 'failed', { error: String(error.message).slice(0, 3000) });
    throw error;
  }
}

export async function assertNativeEvidence(job, candidate, receiptPath) {
  const path = await containedPath(job, receiptPath);
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  const preview = receipt.kind === 'capcut-native-preview';
  if ((!preview && receipt.kind !== 'capcut-native-export') || receipt.status !== 'captured' || (preview ? receipt.exported !== false || receipt.uploaded !== false : receipt.cloudSync !== false) || receipt.platform !== process.platform
    || receipt.candidateDigest !== await directoryDigest(candidate) || !receipt.capcutVersion) throw new Error('Native capture receipt is stale or incomplete.');
  if (preview && (!receipt.samples?.length || !receipt.evidenceFiles?.length)) throw new Error('Native preview evidence is incomplete.');
  const files = preview ? receipt.evidenceFiles.map(item => [item.path, item.sha256]) : [[receipt.output, receipt.outputSha256], [receipt.reviewVideo, receipt.reviewSha256]];
  for (const [file, hash] of files) {
    await containedPath(job, file);
    if (await fileDigest(file) !== hash) throw new Error('Native capture evidence changed after verification.');
  }
  for (const asset of receipt.assets) if (await fileDigest(asset.path) !== asset.sha256) throw new Error('Candidate media changed after native verification.');
  return receipt;
}
