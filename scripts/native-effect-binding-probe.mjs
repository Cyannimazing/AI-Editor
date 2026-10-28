// Developer diagnostic: compare native binding encodings on disposable calibration
// copies. A captured image is diagnostic evidence, not a quality/verification pass.
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadDraft, saveDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
import { addEffect } from '../toolchain/node_modules/capcut-cli/dist/factory.js';
import { captureNativePreview } from '../src/server/capcut/native-preview.mjs';
import { directoryDigest } from '../src/server/editing/transaction.ts';
import { acquireLock } from '../src/server/editing/lock.ts';
import { containedPath, assertNoLinks } from '../src/server/security/paths.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaTool } from '../src/server/platform/runtime.mjs';
const root = process.cwd();
const fixture = await containedPath(join(root, '.local-tools/staging'), resolve(process.argv[2]));
await assertNoLinks(fixture);
if (!loadDraft(fixture).draft.name.startsWith('Native calibration')) throw new Error('Only generated calibration fixtures are accepted.');
const bindings = JSON.parse(await readFile(process.argv[3], 'utf8')).bindings;
const binding = bindings.find(b => b.slug === 'motion-blur');
if (!binding?.localPath || !binding.controls?.length) throw new Error('Expected a resolved official local resource binding.');
const records = [];
const modes = process.argv[4] ? [process.argv[4]] : ['track-bound', 'companion-bound', 'global'];
if (modes.some(mode => !['track-bound', 'companion-bound', 'linked-track', 'global'].includes(mode))) throw new Error('Unknown diagnostic binding mode.');
const release = await acquireLock(join(root, '.local-tools/locks/editing.lock'));
try {
  for (const mode of modes) {
    const candidate = await mkdtemp(join(root, '.local-tools/staging/effect-probe-'));
    const job = await mkdtemp(join(root, '.local-tools/native-assets/effect-probe-'));
    await cp(fixture, candidate, { recursive: true });
    const loaded = loadDraft(candidate), draft = loaded.draft;
    const target = draft.tracks.find(t => t.name === 'AI overlay 1').segments[0];
    // A solid full-image rectangle cannot reveal clip-local blur: its edges are
    // clipped by the image bounds. Internal contrasting edges distinguish a real
    // filter from a missing attachment without relying on composited alpha edges.
    const pattern = join(job, 'effect-test-pattern.png');
    await promisify(execFile)(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i',
      'color=c=black:s=100x100,drawbox=x=30:y=20:w=40:h=60:color=red:t=fill', '-frames:v', '1', pattern], { windowsHide: true });
    draft.materials.videos.find(m => m.id === target.material_id).path = pattern;
    const fx = addEffect(draft, { slug: 'motion-blur', start: 0, duration: 3000000, intensity: 1,
      resourceId: binding.resourceId, effectId: binding.effectId, ...(mode === 'global' ? {} : { bindSegmentId: target.id }) });
    const material = draft.materials.video_effects.find(m => m.id === fx.materialId);
    material.adjust_params = structuredClone(binding.controls); material.path = binding.localPath; material.name = 'Motion Blur';
    if (mode === 'companion-bound') {
      target.extra_material_refs.push(material.id);
      delete material.bind_segment_id;
      draft.tracks = draft.tracks.filter(t => t.id !== fx.trackId);
    }
    if (mode === 'linked-track') target.extra_material_refs.push(material.id);
    saveDraft(candidate, draft, loaded.store);
    let error;
    try { await captureNativePreview({ job, candidate, revision: await directoryDigest(candidate), duration: 3, width: 640, height: 360,
      sampleFrames: [30], onLog: line => console.log(`${mode}: ${line}`) }); }
    catch (cause) { error = cause.message; console.log(`${mode}: diagnostic retained: ${error}`); }
    const folder = (await readdir(job)).find(name => name.startsWith('native-preview-'));
    const receipt = folder ? JSON.parse(await readFile(join(job, folder, 'capture.json'), 'utf8')) : null;
    records.push({ mode, candidate, job, error, samples: receipt?.samples, status: receipt?.status });
    await writeFile(join(root, '.local-tools/preview-probe/effect-binding-results.json'), JSON.stringify(records, null, 2));
  }
} finally { await release(); }
console.log(JSON.stringify(records.map(({ mode, status, error, samples }) => ({ mode, status, error, frames: samples?.length }))));
