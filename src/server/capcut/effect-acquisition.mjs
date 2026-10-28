import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initDraft, seedDraftSkeleton, addVideo, addEffect } from '../../../toolchain/node_modules/capcut-cli/dist/factory.js';
import { loadDraft, saveDraft } from '../../../toolchain/node_modules/capcut-cli/dist/draft.js';
import { probeEffectBundle } from './effect-resources.mjs';
import { prepareNativeCopy } from './native-copy.mjs';
import { NativeUI } from './native-ui.mjs';
import { directoryDigest } from '../editing/transaction.ts';
import { containedPath, assertNoLinks } from '../security/paths.ts';
import { runCancellableProcess } from '../../lib/cancellable-process.ts';
import { mediaTool } from '../platform/runtime.mjs';

/** Cache polling is separate from the desktop adapter, so unavailable, partial
 * and cancelled acquisitions can be tested without touching a desktop.
 */
export async function waitForEffectResources(requests, { inspect = probeEffectBundle, signal = /** @type {AbortSignal | undefined} */ (undefined),
  timeoutMs = 90000, settleMs = 2000, now = Date.now, sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const deadline = now() + timeoutMs;
  const observed = new Map();
  let resources;
  do {
    signal?.throwIfAborted();
    resources = requests.map(({ entry, item }, index) => {
      try {
        const resource = inspect(entry, item);
        if (!resource.available) { observed.delete(index); return resource; }
        const previous = observed.get(index);
        if (!previous || previous.fingerprint !== resource.bundleFingerprint) observed.set(index, { fingerprint: resource.bundleFingerprint, since: now() });
        if (now() - observed.get(index).since < settleMs) return { ...resource, available: false, reason: 'Waiting for the native package files to settle.' };
        return resource;
      }
      catch (error) {
        // CapCut can create the version folder before finishing extraction.
        if (error.code === 'ENOENT' || error instanceof SyntaxError) { observed.delete(index); return { available: false, resourceId: item.resource_id, controls: [], reason: 'CapCut resource extraction is incomplete.' }; }
        throw error;
      }
    });
    if (resources.every(resource => resource.available) || now() >= deadline) return resources;
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  } while (true);
}

/** Controller only; caller holds the global editing lock. Let the official
 * desktop client acquire its own packages on a synthetic, disposable timeline.
 * There is no private download endpoint, cookie access, purchase or upload.
 */
export async function acquireEffectResources({ job: jobInput, requests, signal, onLog = message => { void message; } }) {
  const root = process.cwd(), job = await containedPath(join(root, '.local-tools/native-assets'), jobInput);
  await assertNoLinks(job);
  if (!Array.isArray(requests) || !requests.length || requests.length > 8) throw new Error('Acquire between one and eight native effects per batch.');
  // Validate identities and free catalog status before touching the desktop.
  const initial = await waitForEffectResources(requests, { signal, timeoutMs: 2500 });
  if (initial.every(resource => resource.available)) return initial;
  const folder = await mkdtemp(join(job, 'effect-acquisition-'));
  const receipt = { version: 1, provider: 'capcut-desktop-resource-acquisition', platform: process.platform,
    requested: requests.map(({ entry, item }, i) => ({ slug: entry.slug, resourceId: item.resource_id, md5: entry.md5, cachedBefore: initial[i].available })),
    status: 'preparing', uploaded: false, exported: false, nativePlaybackVerified: false };
  let opened = false, resources;
  try {
    signal?.throwIfAborted();
    const template = join(folder, 'template'); await mkdir(template);
    const original = JSON.parse(await readFile(join(job, 'original-draft.json'), 'utf8'));
    const { draft: skeleton } = seedDraftSkeleton(original, { id: '', name: '', canvas: { width: 640, height: 360, ratio: '16:9' }, fps: 30, nowMs: Date.now(), materialKeys: [] });
    await writeFile(join(template, 'draft_content.json'), JSON.stringify(skeleton));
    const group = await mkdtemp(join(root, '.local-tools/staging/effect-acquisition-'));
    const { draftPath: candidate } = initDraft({ name: 'Resource acquisition', draftsDir: group, templateDir: template, seed: 'off' });
    const source = join(folder, 'resource-test.mp4');
    await runCancellableProcess(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source],
      { cwd: root, signal, timeoutMs: 30000, onLine: () => {} });
    const loaded = loadDraft(candidate);
    addVideo(loaded.draft, loaded.filePath, { path: source, start: 0, duration: 3000000, sourceStart: 0, sourceDuration: 3000000, width: 640, height: 360, volume: 0 });
    for (const { entry, item } of requests) addEffect(loaded.draft, { slug: entry.slug, resourceId: item.resource_id, effectId: item.resource_id,
      trackName: `Acquire ${entry.slug}`, start: 0, duration: 3000000, intensity: 1 });
    saveDraft(loaded.filePath, loaded.draft, loaded.store);
    const ui = new NativeUI(join(folder, 'ui'), signal); ui.projectOnly = true;
    if (process.platform === 'darwin') await ui.perform('preflight');
    onLog(`CapCut is fetching ${requests.map(({ entry }) => entry.name).join(', ')} for local editing. No footage upload or export.`);
    opened = true;
    const published = await prepareNativeCopy(candidate, await directoryDigest(candidate), signal);
    Object.assign(receipt, { candidate, projectName: published.projectName });
    let state = await ui.waitFor(published.projectName);
    if (state.words.some(word => word.text === 'Home')) {
      await ui.openProject(state, published.projectName);
      state = await ui.waitFor(published.projectName, 45000, { x: 0, y: 0, width: 10000, height: 80 * (state.scale || 1) });
    }
    receipt.capcutVersion = state.version;
    resources = await waitForEffectResources(requests, { signal });
    receipt.status = resources.every(resource => resource.available) ? 'acquired' : 'unavailable';
    receipt.resources = resources;
  } catch (error) {
    receipt.status = signal?.aborted ? 'cancelled' : 'failed'; receipt.error = error.message;
    throw error;
  } finally {
    try {
      if (opened) await runCancellableProcess(process.execPath, [join(root, 'scripts/capcut-session.mjs'), 'close'],
        { cwd: root, timeoutMs: 60000, onLine: () => {} });
    } catch (error) { receipt.status = 'failed'; receipt.closeError = error.message; throw error; }
    finally { await writeFile(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2)); }
  }
  return resources;
}
