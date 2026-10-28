import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directoryDigest } from '../editing/transaction.ts';
import { containedPath, assertNoLinks } from '../security/paths.ts';
import { mediaTool } from '../platform/runtime.mjs';
import { fileDigest } from './native-capture.mjs';
import { prepareNativeCopy } from './native-copy.mjs';
import { NativeUI } from './native-ui.mjs';
import { exactTextTarget } from './native-export-policy.mjs';
import { previewGeometry, playerFrame, previewSchedule, navigationSteps } from './native-preview-policy.mjs';
import { assertPublishedEquivalent, nativeSystemFont } from './native-equivalence.mjs';
import { runCancellableProcess } from '../../lib/cancellable-process.ts';
const run = promisify(execFile);

/** Controller-owned player inspection. Never triggers export or cloud tools. */
export async function captureNativePreview({ job, candidate, revision, start = 0, duration, width, height, signal, onLog = message => { void message; }, sampleFrames = undefined }) {
  job = await containedPath(join(process.cwd(), '.local-tools/native-assets'), job);
  candidate = await containedPath(join(process.cwd(), '.local-tools/staging'), candidate);
  await assertNoLinks(job); await assertNoLinks(candidate); signal?.throwIfAborted();
  if (await directoryDigest(candidate) !== revision) throw new Error('Candidate changed before native preview.');
  const options = { signal, timeout: 30000, windowsHide: true, maxBuffer: 30_000_000 };
  const { draft } = JSON.parse((await run(process.execPath, [join(process.cwd(), 'scripts/capcut-draft.mjs'), 'active', candidate], options)).stdout);
  const fps = draft.fps || 30, schedule = previewSchedule(start, duration, fps);
  // Explicit fixture samples do not represent full visual acceptance.
  const targets = sampleFrames || schedule.frames;
  if (!Array.isArray(targets) || !targets.length || targets.length > 90 || targets.some((f, i) => !Number.isInteger(f) || f < 0 || f >= Math.ceil(draft.duration / 1e6 * fps) || i > 0 && f <= targets[i - 1])) throw new Error('Invalid native sample positions.');
  const assets = [];
  for (const path of new Set([...(draft.materials.videos || []), ...(draft.materials.audios || [])].map(m => m.path).filter(Boolean))) assets.push({ path, sha256: await fileDigest(path) });
  const folder = await mkdtemp(join(job, 'native-preview-')), framesFolder = join(folder, 'frames'); await mkdir(framesFolder);
  const receiptPath = join(folder, 'capture.json');
  const receipt = { version: 1, kind: 'capcut-native-preview', candidateDigest: revision, platform: process.platform, status: 'preparing',
    exported: false, uploaded: false, audioCaptured: false, assets, samples: [], evidenceFiles: [], startedAt: new Date().toISOString(),
    sampling: sampleFrames ? 'fixture samples only' : schedule.consecutive ? 'every frame, paused player inspection' : 'bounded sampled player inspection',
    limitations: ['Paused player frames do not verify real-time playback smoothness or the native audio mix.'], excerpt: { start, duration, width, height } };
  const save = async () => writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  await save();
  try {
    const ui = new NativeUI(join(folder, 'ui'), signal);
    ui.projectOnly = true;
    if (process.platform === 'darwin') await ui.perform('preflight');
    onLog('Opening an isolated CapCut candidate for player inspection. No export or upload. Keep the desktop unlocked.');
    const published = await prepareNativeCopy(candidate, revision, signal);
    Object.assign(receipt, { projectName: published.projectName, publishedPath: published.destination }); await save();
    let state = await ui.waitFor(published.projectName);
    if (state.words.some(w => w.text === 'Home')) {
      await ui.openProject(state, published.projectName);
      state = await ui.waitFor(published.projectName, 45000, { x: 0, y: 0, width: 10000, height: 80 * (state.scale || 1) });
    }
    state = await ui.perform('inspect', { projectOnly: true, protectHeader: true });
    exactTextTarget(state, published.projectName, { x: 0, y: 0, width: state.width, height: 80 * (state.scale || 1) });
    receipt.capcutVersion = state.version; receipt.executable = state.executable; receipt.status = 'capturing'; await save();
    let previous = 0;
    for (const [i, frame] of targets.entries()) {
      signal?.throwIfAborted();
      let current, observed;
      for (const step of navigationSteps(previous, frame, i === 0)) {
        const geometry = previewGeometry(state, width, height);
        await ui.perform('navigate', { projectOnly: true, window: state.window, executable: state.executable, width: state.width, height: state.height,
          anchor: geometry.anchor, reset: step.reset, frames: step.frames, protectHeader: true, captureRegions: [geometry.crop, geometry.clock] });
        state = await ui.perform('inspect', { projectOnly: true, ocrRegion: geometry.clock, protectHeader: true, captureRegions: [geometry.crop, geometry.clock] });
        current = previewGeometry(state, width, height);
        if (JSON.stringify(current.crop) !== JSON.stringify(geometry.crop)) throw new Error('CapCut layout changed during inspection. Retry with a stable window.');
        exactTextTarget(state, published.projectName, { x: 0, y: 0, width: state.width, height: 80 * (state.scale || 1) });
        observed = playerFrame(state.words, current.clock, fps);
        if (observed !== step.expected) throw new Error(`CapCut seek mismatch: expected frame ${step.expected}, observed ${observed}. Check custom keyboard shortcuts.`);
      }
      const path = join(framesFolder, `frame-${String(i + 1).padStart(5, '0')}.png`), c = current.crop;
      await run(mediaTool('ffmpeg'), ['-v', 'error', '-i', state.screenshot, '-vf', `crop=${c.width}:${c.height}:${c.x}:${c.y},scale=${width}:${height}`, '-frames:v', '1', path], options);
      receipt.samples.push({ frame, time: frame / fps - start, path, screenshot: state.screenshot, crop: c });
      for (const file of [path, state.screenshot]) receipt.evidenceFiles.push({ path: file, sha256: await fileDigest(file) });
      previous = observed; await save();
      if (i === 0 || i % 10 === 0 || i === targets.length - 1) onLog(`Inspecting native CapCut preview: ${i + 1}/${targets.length} frames checked.`);
    }
    await run(mediaTool('ffmpeg'), ['-v', 'error', '-framerate', String(schedule.sampleFps), '-i', join(framesFolder, 'frame-%05d.png'),
      '-vf', 'scale=180:-2,tile=6x6:nb_frames=36:padding=4:margin=4', join(folder, 'sheet-%03d.png')], { ...options, timeout: 120000 });
    const sheets = (await readdir(folder)).filter(f => /^sheet-\d+\.png$/.test(f)).sort().map(f => join(folder, f));
    const indexPath = join(folder, 'frames.json');
    await writeFile(indexPath, JSON.stringify({ duration, width, height, nativeFps: fps, sampleFps: schedule.sampleFps, sampling: receipt.sampling,
      audioPath: null, frames: receipt.samples.map(s => ({ path: s.path, time: s.time })), sheets: sheets.map((path, i) => ({ path, firstFrame: i * 36 + 1, layout: '6 columns, left to right, then down' })) }));
    for (const file of [indexPath, ...sheets]) receipt.evidenceFiles.push({ path: file, sha256: await fileDigest(file) });
    if (await directoryDigest(candidate) !== revision) throw new Error('Candidate changed during native inspection.');
    // Flush native autosave before checking the actual document behind the frames.
    await runCancellableProcess(process.execPath, [join(process.cwd(), 'scripts/capcut-session.mjs'), 'close'],
      { cwd: process.cwd(), signal, timeoutMs: 60000, onLine: () => {} });
    const systemFont = nativeSystemFont(state.executable, process.platform);
    const savedDraft = await assertPublishedEquivalent(candidate, published.destination, { nativeSave: true, systemFont });
    const savedPath = join(folder, 'native-saved-draft.json'); await writeFile(savedPath, JSON.stringify(savedDraft));
    receipt.evidenceFiles.push({ path: savedPath, sha256: await fileDigest(savedPath) });
    receipt.documentCheck = { policy: 'strict-native-save-defaults-v1', snapshot: savedPath,
      limitation: 'Known default fields are normalized; unfamiliar native rewrites fail verification.' };
    for (const asset of assets) if (await fileDigest(asset.path) !== asset.sha256) throw new Error('Source changed during native inspection.');
    receipt.status = 'captured'; receipt.completedAt = new Date().toISOString(); await save();
    return { receiptPath, receipt, nativeFrames: { frames: sheets, indexPath, duration, hasAudio: false } };
  } catch (error) { receipt.status = signal?.aborted ? 'cancelled' : 'failed'; receipt.error = error.message; await save(); throw error; }
}
