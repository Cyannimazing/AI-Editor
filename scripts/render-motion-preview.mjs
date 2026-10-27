import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { previewFont } from '../src/server/editing/preview-plan.mjs';
import { motionComposition } from '../src/server/editing/motion-preview.mjs';
import { availableTextFonts } from '../src/server/editing/text-fonts.mjs';
import { readNativeText } from '../src/server/editing/native-text.mjs';
import { renderNativeAudio } from '../src/server/editing/audio-mix.mjs';
import { previewBrowser } from '../src/server/platform/browser.mjs';
import { validateControlledPlan } from '../src/server/editing/controlled-plan.mjs';
import { loadDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';

const run = promisify(execFile), root = process.cwd();
const [jobInput, candidateInput, round] = process.argv.slice(2);
const inside = (root, path) => { const offset = relative(root, path); return offset !== '..' && !offset.startsWith('../') && !offset.startsWith('..\\') && !isAbsolute(offset); };
const job = await realpath(jobInput), candidate = await realpath(candidateInput);
if (!/^[1-4]$/.test(round) || !inside(await realpath(join(root, '.local-tools/native-assets')), job) || !inside(await realpath(join(root, '.local-tools/staging')), candidate)) throw new Error('Invalid preview workspace.');
const spec = JSON.parse(await readFile(join(job, 'spec.json'), 'utf8'));
const plan = validateControlledPlan(JSON.parse(await readFile(join(job, 'controlled-editing-plan.json'), 'utf8')), spec.source.duration);
const execution = JSON.parse(await readFile(join(job, `execution-${round}.json`), 'utf8'));
const { draft } = loadDraft(candidate, { activeTimeline: existsSync(join(candidate, 'Timelines')) });
const duration = spec.source.duration, fps = draft.fps || 30;
if (!(duration > 0 && duration <= 600 && fps > 0 && fps <= 60)) throw new Error('Motion preview exceeds the current local render budget.');
const ratio = Math.min(1, 960 / Math.max(spec.source.width, spec.source.height));
const width = Math.max(2, Math.round(spec.source.width * ratio / 2) * 2), height = Math.max(2, Math.round(spec.source.height * ratio / 2) * 2);
const folder = join(job, `motion-preview-${round}`); await mkdir(folder, { recursive: true });
const layers = [];
for (const [ref, id] of Object.entries(execution.refs).filter(([ref]) => !ref.startsWith('effect-') && !ref.startsWith('audio-'))) {
  const segment = draft.tracks.flatMap(track => track.segments).find(segment => segment.id === id);
  if (!segment) throw new Error(`Missing preview component ${ref}.`);
  const start = segment.target_timerange.start / 1e6 - (spec.source.start || 0);
  if (ref.startsWith('text-')) {
    const material = draft.materials.texts.find(item => item.id === segment.material_id);
    const text = readNativeText(material, draft.canvas_config.width, draft.canvas_config.height);
    const font = text.fontPath ? availableTextFonts().find(font => font.path.replaceAll('\\', '/').toLowerCase() === text.fontPath.replaceAll('\\', '/').toLowerCase()) : undefined;
    if (text.fontPath && !font) throw new Error('Serialized native font is not an available approved local font.');
    if (font) await copyFile(font.path, join(folder, `${font.id}.ttf`));
    layers.push({ kind: 'text', segment, start, fontSize: text.fontSize * ratio, text: text.text, color: text.color, bold: text.bold, italic: text.italic, font: font?.id });
    continue;
  }
  const material = draft.materials.videos.find(material => material.id === segment.material_id);
  if (!material || !isAbsolute(material.path) || !(await lstat(material.path)).isFile()) throw new Error('Preview media must be regular local files.');
  const path = await realpath(material.path);
  if (!inside(job, path) && !inside(candidate, path)) throw new Error('Preview media escapes the job.');
  const probe = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', path], { windowsHide: true, timeout: 15000 })).stdout);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  if (!video || !(video.width > 0 && video.height > 0 && video.width * video.height <= 33_177_600)) throw new Error('Invalid preview media dimensions.');
  const file = `media-${createHash('sha256').update(path).digest('hex').slice(0, 16)}${extname(path)}`;
  if (!existsSync(join(folder, file))) await copyFile(path, join(folder, file));
  layers.push({ kind: material.type === 'photo' ? 'photo' : 'video', segment, start, file, width: video.width, height: video.height,
    blendMode: ref.startsWith('overlay-') ? plan.overlays[Number(ref.slice(8))].blendMode : 'normal' });
}
// DESIGN is derived from the editing plan, never from an unrelated template.
await writeFile(join(folder, 'DESIGN.md'), `# Native editing design\n${plan.summary}\nCanvas ${spec.source.width}x${spec.source.height}.\nText palette: ${plan.texts.map(text => text.color).join(', ')}.\nLocal preview font; native font fidelity needs verification.\nPreserve the measured composition, layering and serialized curves. Do not add decorative presets.\n`);
await copyFile(previewFont(), join(folder, 'font.ttf'));
await copyFile(join(root, 'toolchain/node_modules/gsap/dist/gsap.min.js'), join(folder, 'gsap.min.js'));
await writeFile(join(folder, 'index.html'), motionComposition(layers, { width, height, duration, fps }));
const cli = join(root, 'toolchain/node_modules/hyperframes/bin/hyperframes.mjs');
const browser = previewBrowser(root);
if (!browser) throw new Error('Complete automatic tool setup to prepare the background preview browser.');
const env = { ...process.env, HYPERFRAMES_BROWSER_PATH: browser, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', DO_NOT_TRACK: '1', PATH: `${dirname(mediaTool('ffmpeg'))}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` };
const options = { cwd: folder, env, windowsHide: true, timeout: 180000, maxBuffer: 2_000_000 };
const checks = {};
for (const [command, args] of [['lint', []], ['validate', ['--no-contrast', '--timeout', '3000']], ['inspect', ['--at', [0, duration / 2, Math.max(0, duration - 1 / fps)].join(',')]]]) {
  const result = await run(process.execPath, [cli, command, folder, '--json', ...args], options).catch(error => {
    // Layout defects need rendered evidence for review/correction. They must
    // not silently downgrade the whole job to a static preview.
    if (command === 'inspect' && error.stdout) {
      const report = JSON.parse(error.stdout);
      if (report.schemaVersion === 1 && Array.isArray(report.issues)) return { stdout: String(error.stdout) };
    }
    throw error;
  });
  await writeFile(join(folder, `${command}.json`), result.stdout);
  const report = JSON.parse(result.stdout);
  checks[command] = { completed: true, passed: report.ok !== false, issues: report.issues || [], report: `motion-preview-${round}/${command}.json` };
}
const output = join(folder, 'motion.mp4');
await run(process.execPath, [cli, 'render', folder, '--output', output, '--workers', '1', '--quality', 'draft', '--no-best-effort'], options);
const temporary = join(job, `preview-${randomUUID()}.mp4`);
const original = JSON.parse(await readFile(join(job, 'original-draft.json'), 'utf8'));
const audio = await renderNativeAudio({ draft, original, job, candidate, start: spec.source.start || 0, duration, refs: execution.refs });
await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', output, ...(audio.report.tracks.length ? ['-i', audio.path] : []), '-map', '0:v:0', ...(audio.report.tracks.length ? ['-map', '1:a:0'] : []), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(duration), temporary], { windowsHide: true, timeout: 30000 });
const probe = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', temporary], { windowsHide: true, timeout: 15000 })).stdout);
if (!probe.streams.some(stream => stream.codec_type === 'video') || Math.abs(Number(probe.format.duration) - duration) > 1 / fps + 0.01) throw new Error('Motion render failed media validation.');
await rename(temporary, join(job, 'preview.mp4'));
await writeFile(join(job, `audio-mix-report-${round}.json`), JSON.stringify(audio.report));
const receipt = { previewKind: 'native-curves-local-preview', renderer: 'HyperFrames + GSAP', approximate: true, width, height, fps, duration,
  nativeMotion: true, nativeEffects: false, checks, source: 'Serialized candidate curves and native text materials; no planner text/size substitution',
  audio: audio.report, fidelity: { dropped: { nativeEffects: plan.effects.length, volumeKeyframes: 0 } },
  limitations: ['Native effect resources are not rendered by the browser.', ...audio.report.limitations, 'Native font metrics and color adjustments require CapCut calibration.', 'Preview shows the edited interval; unrelated project content is checked structurally.'] };
await writeFile(join(job, 'preview-plan.json'), JSON.stringify(receipt));
console.log(JSON.stringify({ ok: true, ...receipt }));
