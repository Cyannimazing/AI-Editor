import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { preparePreviewPlan, previewFont } from '../src/server/editing/preview-plan.mjs';
import { loadDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
import { buildRenderPlan, checkOutputDuration } from '../toolchain/node_modules/capcut-cli/dist/render.js';

const run = promisify(execFile), root = process.cwd();
const [jobInput, candidateInput] = process.argv.slice(2);
function inside(root, path) { const offset = relative(root, path); return offset !== '..' && !offset.startsWith('../') && !offset.startsWith('..\\') && !isAbsolute(offset); }
const job = await realpath(jobInput), candidate = await realpath(candidateInput);
if (!inside(await realpath(join(root, '.local-tools/native-assets')), job) || !inside(await realpath(join(root, '.local-tools/staging')), candidate)) throw new Error('Invalid preview workspace.');
const { draft } = loadDraft(candidate, { activeTimeline: existsSync(join(candidate, 'Timelines')) });
const original = JSON.parse(await readFile(join(job, 'original-draft.json'), 'utf8'));
const originalPaths = new Set(Object.values(original.materials).flatMap(items => Array.isArray(items) ? items.map(item => item.path).filter(Boolean) : []));
const temporary = join(job, `preview-${randomUUID()}.mp4`);
const options = { out: temporary, scale: 0.5, allVideoTracks: true, burnCaptions: true };
let raw = buildRenderPlan(draft, options);
if (!(raw.width > 0 && raw.height > 0 && raw.width * raw.height <= 8_294_400 && raw.fps > 0 && raw.fps <= 120)) throw new Error('Preview dimensions exceed the local budget.');
for (const input of raw.inputs) {
  if (!isAbsolute(input.path) || !(await lstat(input.path)).isFile()) throw new Error('Preview requires regular local media.');
  const path = await realpath(input.path);
  if (!inside(job, path) && !inside(join(candidate, 'assets'), path) && !originalPaths.has(input.path)) throw new Error('Unknown preview dependency.');
}
// The upstream proxy includes separate audio tracks but omits audio carried by
// video clips. Add virtual preview-only audio tracks after validating media.
const previewDraft = structuredClone(draft), audioPaths = new Map();
previewDraft.materials.audios ||= [];
for (const track of draft.tracks.filter(track => track.type === 'video')) for (const segment of track.segments) {
  const material = draft.materials.videos.find(item => item.id === segment.material_id);
  if (!material || material.type === 'photo' || segment.volume === 0) continue;
  if (!raw.inputs.some(input => input.path === material.path)) continue;
  if (!audioPaths.has(material.path)) {
    const probe = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', material.path], { timeout: 15000, windowsHide: true })).stdout);
    audioPaths.set(material.path, probe.streams?.some(stream => stream.codec_type === 'audio'));
  }
  if (!audioPaths.get(material.path)) continue;
  const id = randomUUID();
  previewDraft.materials.audios.push({ id, path: material.path });
  previewDraft.tracks.push({ type: 'audio', segments: [{ ...segment, id: randomUUID(), material_id: id }] });
}
raw = buildRenderPlan(previewDraft, options);
const plan = preparePreviewPlan(raw, draft, previewFont());
if (plan.filterScript) {
  if (!inside(job, plan.filterScript.path)) throw new Error('Preview filter file escapes the job.');
  await writeFile(plan.filterScript.path, plan.filterScript.content);
}
await writeFile(join(job, 'preview-plan.json'), JSON.stringify(plan));
const args = plan.args.flatMap(arg => arg === '-i' ? ['-protocol_whitelist', 'file,pipe', '-i'] : [arg]);
await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '1', ...args],
  { windowsHide: true, timeout: 170000, maxBuffer: 2_000_000 });
const probe = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', temporary], { windowsHide: true, timeout: 15000 })).stdout);
if (!probe.streams.some(stream => stream.codec_type === 'video')) throw new Error('Preview contains no video stream.');
const check = checkOutputDuration(Math.round(Number(probe.format.duration) * 1e6), plan.fidelity.expected_duration_us, plan.fps);
if (!check.within_tolerance) throw new Error('Preview duration does not match the candidate.');
await rename(temporary, join(job, 'preview.mp4'));
console.log(JSON.stringify({ ok: true, approximate: true, duration: Number(probe.format.duration), dropped: plan.fidelity.dropped }));
