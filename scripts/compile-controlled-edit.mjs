import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { compileControlledSpec, validateControlledPlan } from '../src/server/editing/controlled-plan.mjs';
import { mergeClipEdit } from './merge-clip-edit.mjs';
import { renderVectorAssets } from '../src/server/editing/vector-assets.mjs';
import { writeMotionCurves, writeCatalogEffect, enableNativeCompositing, assertCompositeEffectScope } from '../src/server/editing/native-controls.mjs';
import { resolveTextFont } from '../src/server/editing/text-fonts.mjs';
import { assertEditingScope } from '../src/server/editing/edit-scope.mjs';
import { renderAudioAssets } from '../src/server/editing/audio-synthesis.mjs';

const [jobInput, candidateInput, round = '1'] = process.argv.slice(2);
if (!/^[1-4]$/.test(round)) throw new Error('Invalid correction round.');
function inside(root, path) { const offset = relative(root, path); return offset !== '..' && !offset.startsWith('..\\') && !offset.startsWith('../') && !isAbsolute(offset); }
const root = process.cwd(), job = await realpath(jobInput), candidate = await realpath(candidateInput);
if (!inside(await realpath(join(root, '.local-tools', 'native-assets')), job) || !inside(await realpath(join(root, '.local-tools', 'staging')), candidate)) throw new Error('Invalid build workspace.');
const spec = JSON.parse(await readFile(join(job, 'spec.json'), 'utf8'));
const source = await realpath(spec.source.path);
if (!inside(job, source)) throw new Error('Source is outside this job.');
const plan = validateControlledPlan(JSON.parse(await readFile(join(job, `controlled-plan-${round}.json`), 'utf8')), spec.source.duration);
const original = JSON.parse(await readFile(join(job, 'original-draft.json'), 'utf8'));
assertCompositeEffectScope(plan.effects || [], original, spec.source.clipId);
assertEditingScope(plan, spec.editingScope || 'full');
// Unresolved requirements belong in the quality report. Constructing an
// inspectable candidate must not turn uncertainty into either a crash or a pass.
const assets = await renderVectorAssets(plan.assets || [], job, source, spec.source.duration);
const audioAssets = await renderAudioAssets(plan.audio, job, spec.source.duration);
const compilerSpec = compileControlledSpec(plan, { source, duration: spec.source.duration, width: spec.source.width, height: spec.source.height, fps: spec.source.fps }, assets, audioAssets);
await writeFile(join(job, `compile-spec-${round}.json`), JSON.stringify(compilerSpec));
const { compileDraft } = await import('../toolchain/node_modules/capcut-cli/dist/compile.js');
const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
const generatedPath = join(job, `compiled-${round}-${randomUUID().slice(0, 8)}`);
const compiled = compileDraft({ ...compilerSpec, operations: [] }, { outDir: generatedPath, specDir: job, templateDir: join(root, 'toolchain', 'node_modules', 'capcut-cli', 'templates', '_init') });
const { draft: generated, filePath: generatedFile } = loadDraft(generatedPath);
const { addKeyframes, setTextRanges } = await import('../toolchain/node_modules/capcut-cli/dist/decorators.js');
const { applyTextPreset } = await import('../toolchain/node_modules/capcut-cli/dist/preset.js');
const execution = writeMotionCurves(generated, compilerSpec.operations, compiled.refs, addKeyframes);
for (const [index, text] of plan.texts.entries()) {
  const receipt = setTextRanges(generated, compiled.refs[`text-${index}`], [{ start: 0, end: text.text.length, bold: text.bold ?? false, italic: text.italic ?? false }]);
  execution.push({ ...receipt, operation: 'native.text.style', bold: text.bold ?? false, italic: text.italic ?? false });
  if (text.font) {
    const font = resolveTextFont(text.font);
    execution.push({ ...applyTextPreset(generated, compiled.refs[`text-${index}`], { style: { font_name: font.name, font_path: font.path } }), operation: 'native.text.font', font: font.name });
  }
}
const allowedMedia = new Map([[basename(source), source], ...[...assets.values()].map(path => [basename(path), path])]);
for (const material of generated.materials.videos ?? []) {
  const path = allowedMedia.get(basename(material.path));
  if (!path) throw new Error('The compiled build introduced an unknown media dependency.');
  material.path = path;
}
for (const material of generated.materials.audios ?? []) {
  const path = [...audioAssets.values()].find(file => basename(file) === basename(material.path));
  if (!path) throw new Error('Unknown generated audio dependency.');
  material.path = path;
}
const { addEffect, setMixMode } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
const { findEnum } = await import('../toolchain/node_modules/capcut-cli/dist/enums.js');
const bindingFile = join(job, `native-effect-bindings-${round}.json`);
const officialBindings = existsSync(bindingFile) ? JSON.parse(await readFile(bindingFile, 'utf8')).bindings : [];
if (!Array.isArray(officialBindings)) throw new Error('Invalid official effect bindings.');
const effectLimitations = [];
for (const binding of officialBindings) {
  if (binding.localPath && !inside(job, await realpath(binding.localPath))) throw new Error('Native resource escapes this job.');
}
for (const [index, layer] of (plan.overlays || []).entries()) setMixMode(generated, compiled.refs[`overlay-${index}`], layer.blendMode);
for (const ref of ['source', ...(plan.overlays || []).map((_, index) => `overlay-${index}`)]) {
  const receipt = enableNativeCompositing(generated, compiled.refs[ref]);
  if (receipt) execution.push(receipt);
}
for (const [effectIndex, effect] of (plan.effects || []).entries()) {
  const target = compiled.refs[effect.target === 'composition' ? 'source' : effect.target || 'source'];
  if (!target) throw new Error(`The effect target does not exist: ${effect.target}`);
  const segment = generated.tracks.flatMap(track => track.segments).find(segment => segment.id === target);
  const start = Math.round(effect.start * 1e6), end = start + Math.round(effect.duration * 1e6);
  if (start < segment.target_timerange.start || end > segment.target_timerange.start + segment.target_timerange.duration + 2) throw new Error('A native effect extends outside its target layer.');
  const binding = officialBindings.find(item => item.index === effectIndex);
  if (!binding) effectLimitations.push(`${effect.slug}: using the installed native catalog; no unambiguous official effect application receipt is available.`);
  else if (!binding.localPath) effectLimitations.push(`${effect.slug}: official resource resolved, but its native bundle is absent from the local cache. Native availability and playback remain unverified.`);
  if (binding && (binding.exactNativeTiming?.start !== start || binding.exactNativeTiming?.duration !== Math.round(effect.duration * 1e6))) throw new Error('Official effect timing is stale.');
  const receipt = writeCatalogEffect(generated, effect, target, `AI effect ${effectIndex + 1}`, { findEnum, addEffect }, binding);
  execution.push(receipt);
  compiled.refs[`effect-${effectIndex}`] = receipt.segmentId;
}
saveDraft(generatedFile, generated);
const { draft: current, filePath } = loadDraft(candidate, { activeTimeline: existsSync(join(candidate, 'Timelines')) });
let merged;
if (spec.source.clipId) {
  for (const items of Object.values(generated.materials)) if (Array.isArray(items)) for (const item of items)
    if (item.bind_segment_id === compiled.refs.source) item.bind_segment_id = spec.source.clipId;
  merged = mergeClipEdit(original, generated, spec.source.clipId, { compositionEffectIds: execution.filter(op => op.operation === 'native.effect' && op.scope === 'composition').map(op => op.materialId) });
}
else {
  if (original.tracks.some(track => track.segments?.length)) throw new Error('Choose a clip in a populated project.');
  merged = structuredClone(original);
  merged.canvas_config = generated.canvas_config; merged.duration = generated.duration; merged.fps = generated.fps;
  // Preserve every existing empty track and metadata field; append only generated content.
  merged.materials = structuredClone(original.materials);
  for (const [kind, items] of Object.entries(generated.materials)) if (Array.isArray(items)) merged.materials[kind] = [...(merged.materials[kind] || []), ...items];
  const filled = new Set();
  for (const track of generated.tracks) {
    const target = merged.tracks.find(item => item.type === track.type && !item.segments?.length && !filled.has(item.id));
    if (target) { target.segments = track.segments; filled.add(target.id); }
    else merged.tracks.push(track);
  }
}
merged.id = current.id; merged.name = current.name;
// Merge preserves original material metadata. Re-enable requested compositing
// on the private replacement material after that preservation step.
if (spec.source.clipId) {
  const receipt = enableNativeCompositing(merged, spec.source.clipId);
  if (receipt) execution.push(receipt);
}
saveDraft(filePath, merged, { preserveProjectFields: true });
const sourceSegments = merged.tracks.filter(track => track.type === 'video').flatMap(track => track.segments).filter(segment =>
  spec.source.clipId ? segment.id === spec.source.clipId : compiled.refs.source === segment.id);
const textIds = new Set(generated.tracks.filter(track => track.type === 'text').flatMap(track => track.segments.map(segment => segment.id)));
const addedIds = new Set(generated.tracks.flatMap(track => track.segments.map(segment => segment.id)).filter(id => id !== compiled.refs.source));
const affectedTracks = merged.tracks.filter(track => track.segments.some(segment => sourceSegments.includes(segment) || addedIds.has(segment.id)));
const componentRefs = { ...compiled.refs, source: sourceSegments[0]?.id };
const manifest = { supported: true, requestComplete: plan.unsupported.length === 0, unresolvedRequirements: plan.unsupported, sourceSegmentIds: sourceSegments.map(segment => segment.id),
  effects: plan.techniques.map(technique => {
    const segmentIds = technique.components ? technique.components.map(ref => componentRefs[ref]) : [...sourceSegments.map(segment => segment.id), ...addedIds];
    if (segmentIds.some(id => !id)) throw new Error(`Technique ${technique.id} has an unresolved native component.`);
    return { id: technique.id, technique: technique.name, trackNames: affectedTracks.filter(track => track.segments.some(segment => segmentIds.includes(segment.id))).map(track => track.id),
      segmentIds, components: technique.components || [], expectedBehavior: technique.expectedBehavior || technique.name, checks: technique.checks || [],
      status: 'constructed', method: 'Native components written; visual match requires independent timed comparison.' };
  }),
  toolsUsed: ['CapCut draft compiler', ...(plan.audio?.clips.length ? ['Local procedural sound composition', 'Native editable audio tracks and volume curves'] : []), ...(plan.assets?.some(asset => !asset.kind || asset.kind === 'svg') ? ['Local vector asset renderer'] : []), ...(plan.assets?.some(asset => asset.kind === 'source-frame') ? ['FFmpeg source-frame extraction'] : []), ...(plan.effects?.length ? ['Native CapCut effects'] : [])], limitations: [], verificationGaps: [...new Set(effectLimitations)], notes: plan.summary };
await writeFile(join(job, `manifest-${round}.json`), JSON.stringify(manifest));
await writeFile(join(job, 'reference-analysis.json'), JSON.stringify({ techniques: plan.techniques }));
await writeFile(join(job, 'controlled-editing-plan.json'), JSON.stringify(plan));
await writeFile(join(job, `execution-${round}.json`), JSON.stringify({ version: 1, refs: componentRefs, operations: execution }));
console.log(JSON.stringify({ ok: true, sourceSegments: sourceSegments.length, editableTexts: textIds.size }));
