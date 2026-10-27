// Read-only, offline discovery. Never installs tools or imports user-authored plugins.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { findExecutable } from '../src/server/platform/runtime.mjs';
import { localEffectBuilder } from '../src/server/capcut/local-builder.mjs';
import { motionRuntimeReady } from '../src/server/editing/motion-runtime.mjs';

const run = promisify(execFile), root = process.cwd(), modules = join(root, 'toolchain', 'node_modules');
async function packageInfo(name) {
  const file = join(modules, name, 'package.json');
  const bytes = await readFile(file);
  const info = JSON.parse(bytes);
  return { name: info.name, version: info.version, manifestSha256: createHash('sha256').update(bytes).digest('hex') };
}
async function probe(name, args) {
  const executable = findExecutable(name);
  if (!executable) return { found: false };
  try {
    const result = await run(executable, args, { timeout: 15000, windowsHide: true, maxBuffer: 2_000_000 });
    return { found: true, verified: true, output: (result.stdout + result.stderr).trim() };
  } catch { return { found: true, verified: false }; }
}
const cli = join(modules, 'capcut-cli', 'dist', 'index.js');
const [{ stdout: described }, ffmpeg, ffprobe, codex, ...packages] = await Promise.all([
  run(process.execPath, [cli, 'describe'], { timeout: 15000, windowsHide: true, maxBuffer: 2_000_000 }),
  probe('ffmpeg', ['-hide_banner', '-filters']), probe('ffprobe', ['-version']), probe('codex', ['--version']),
  ...['capcut-cli', 'hyperframes', 'gsap', 'fontkit', '@remotion/cli', 'remotion', '@modelcontextprotocol/sdk'].map(packageInfo),
]);
const { keyframeProperties, keyframeEasings, bubbleCatalogue } = await import('../toolchain/node_modules/capcut-cli/dist/decorators.js');
const { mixModeSlugs, filterCatalogue } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
const enumBytes = await readFile(join(modules, 'capcut-cli', 'dist', 'enums.json'));
const enums = JSON.parse(enumBytes).capcut;
const commands = JSON.parse(described);
const filters = ffmpeg.verified ? ffmpeg.output.split(/\r?\n/).flatMap(line => /^\s*[TSC.]{2,3}\s+(\S+)\s+[AVN|]+->[AVN|]+\s+/.exec(line)?.slice(1, 2) || []) : [];
const docs = {};
for (const path of ['capcut-cli/docs/command-reference.md', 'capcut-cli/dist/compile.js', 'capcut-cli/dist/decorators.js', 'hyperframes/README.md']) {
  try { docs[path] = createHash('sha256').update(await readFile(join(modules, path))).digest('hex'); }
  catch { docs[path] = null; }
}
const result = { version: 1, inspectedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  packages, documentationSha256: docs, capcut: { commands, keyframes: keyframeProperties(), easing: keyframeEasings(),
    blendModes: mixModeSlugs(), enumsSha256: createHash('sha256').update(enumBytes).digest('hex'), catalogs: enums,
    bubbles: bubbleCatalogue(), filters: filterCatalogue(), catalogEntriesAreNotNativeVerification: true },
  ffmpeg: { found: ffmpeg.found, verified: ffmpeg.verified ?? false, filters },
  ffprobe: { found: ffprobe.found, verified: ffprobe.verified ?? false, versionLine: ffprobe.output?.split(/\r?\n/)[0] },
  codex: { found: codex.found, verified: codex.verified ?? false, versionLine: codex.output?.split(/\r?\n/)[0] },
  optionalRuntimes: { whisperExecutableFound: Boolean(findExecutable('whisper-cli') || findExecutable('whisper')),
    localFrameMeasurementVerified: await motionRuntimeReady(root),
    officialCapcutLocalBuilderInstalled: localEffectBuilder().available,
    parakeetModelVerified: false, kokoroModelVerified: false, localImageVideoModelVerified: false,
    hyperframesBrowserRenderVerified: false, remotionRenderVerified: false },
  applicationAdapter: { planVersion: 5,
    executable: ['source transforms and volume', 'v5 local procedural SFX/music composition with editable native audio tracks and volume curves, retained synthesis recipes, source-preserving measured preview mix', 'complete native transform/opacity/volume/brightness/contrast/saturation curves with hold support', 'native editable timed text and text keyframes', 'local script-free vector generation with retained SVG source and transparent PNG', 'independent image and duplicate-source overlay layers', 'native blend modes', 'exact no-cost catalog resource binding for native scene/character effects (playback still requires verification)', 'controller-mediated official CapCut material discovery selected by the planner', 'conditional motion/caption/audio specialist scheduling and lead integration', 'HyperFrames + GSAP local preview sampled from serialized native curves when local Chrome is available', 'independent per-technique reviews and enforced bounded repair'],
    gaps: ['general filters/masks/transition dispatch', 'cuts/retiming dispatch', 'local transcription/model setup dispatch', 'automatic native capture/export comparison'],
    rule: 'An adapter gap is not evidence the installed CLI lacks a capability. Documentation does not itself implement an adapter.' } };
process.stdout.write(JSON.stringify(result));
