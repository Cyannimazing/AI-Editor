import { createHash } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDraft, loadedDraftStore } from '../../../toolchain/node_modules/capcut-cli/dist/draft.js';
import { assessWriteSafety } from '../../../toolchain/node_modules/capcut-cli/dist/version.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const version = value => typeof value === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value) ? value : null;
const range = value => ({ start: number(value?.start), duration: number(value?.duration) });
const list = value => Array.isArray(value) ? value : [];
const within = (root, file) => { const r = relative(root, file); return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
const curveTypes = new Set(['KFTypeScaleX', 'KFTypeScaleY', 'KFTypePositionX', 'KFTypePositionY', 'KFTypeRotation', 'KFTypeAlpha', 'KFTypeVolume', 'KFTypeUniformScale']);

function curves(segment, budget) {
  const all = list(segment.common_keyframes), selected = all.slice(0, Math.min(32, budget.curves));
  budget.curves -= selected.length;
  if (selected.length < all.length) budget.truncated = true;
  return selected.map(curve => {
    const allPoints = list(curve.keyframe_list), points = allPoints.slice(0, Math.min(256, budget.points));
    budget.points -= points.length;
    if (points.length < allPoints.length) budget.truncated = true;
    return { property: curveTypes.has(curve.property_type) ? curve.property_type : 'other',
    points: points.map(point => ({
      timeUs: number(point.time_offset), values: list(point.values).slice(0, 4).map(number),
      curveType: ['Line', 'Free', 'Hold', 'EaseIn', 'EaseOut', 'EaseInOut'].includes(point.curveType) ? point.curveType : null,
      left: { x: number(point.left_control?.x), y: number(point.left_control?.y) },
      right: { x: number(point.right_control?.x), y: number(point.right_control?.y) },
    })),
    };
  });
}

async function mediaAccess(material, project) {
  if (typeof material.path !== 'string' || !material.path) return { access: 'path_missing' };
  let path = material.path.replace(/##_draftpath_placeholder_[^#]+_##/g, project);
  // Do not follow remote references/UNC paths for a diagnostic download.
  if (/^(?:https?:|\\\\|\/\/)/i.test(path)) return { access: 'remote_not_checked' };
  if (/^file:/i.test(path)) {
    try { const url = new URL(path); if (url.hostname && url.hostname !== 'localhost') return { access: 'remote_not_checked' }; path = fileURLToPath(url); }
    catch { return { access: 'invalid_path' }; }
  }
  if (/^[a-z][a-z+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return { access: 'invalid_path' };
  if ((process.platform !== 'win32' && /^[a-z]:[\\/]/i.test(path)) || (process.platform === 'win32' && path.startsWith('/Users/'))) return { access: 'other_platform_path' };
  path = resolve(project, path);
  const extension = extname(path).toLowerCase();
  const details = { extension: ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a', '.aac'].includes(extension) ? extension : 'other',
    location: within(project, path) ? 'project' : within(resolve('.local-tools/native-assets'), path) ? 'job-assets' : 'external' };
  try {
    const info = await stat(path);
    if (!info.isFile()) return { ...details, access: 'not_a_file' };
    await access(path, constants.R_OK);
    return { ...details, access: 'readable', sizeBytes: info.size };
  } catch (error) { return { ...details, access: error.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
}

/** Allowlisted evidence only: never export filenames, paths, captions or raw project JSON. */
export async function inspectProjectCompatibility(project) {
  const cli = JSON.parse(await readFile(new URL('../../../toolchain/node_modules/capcut-cli/package.json', import.meta.url), 'utf8'));
  const report = { version: 1, workflow: 'file-and-preview-v1', generatedAt: new Date().toISOString(),
    runtime: { platform: process.platform, arch: process.arch, node: process.version, capcutCli: version(cli.version) },
    note: 'Read-only report. No media, project names, captions, personal paths or credentials are included. File readability is measured for AI-Editor, not CapCut. No desktop apps were operated. This is not a native playback or full schema compatibility certificate.' };
  try {
    return await inspectDetails(project, report);
  } catch {
    return { ...report, project: { state: 'unreadable' }, failure: { code: 'PROJECT_STRUCTURE_INVALID' },
      compatibility: { writeAllowed: false, nativePlaybackChecked: false } };
  }
}

async function inspectDetails(project, report) {
  let loaded, store;
  try {
    loaded = loadDraft(project, { activeTimeline: existsSync(join(project, 'Timelines')) });
    store = loadedDraftStore(loaded.filePath);
  } catch (error) {
    const known = /refused \[(active-timeline-[a-z-]+|version-boundary)\]/.exec(String(error.message))?.[1];
    return { ...report, project: { state: 'unreadable' }, failure: { code: known || 'PROJECT_UNREADABLE' },
      compatibility: { writeAllowed: false, nativePlaybackChecked: false } };
  }
  const { draft, filePath } = loaded;
  const safety = assessWriteSafety(draft, store.version);
  const segments = [], budget = { curves: 256, points: 4096, truncated: false };
  let segmentCount = 0;
  for (const [trackIndex, track] of list(draft.tracks).entries()) {
    segmentCount += list(track.segments).length;
    for (const [segmentIndex, segment] of list(track.segments).slice(0, 300 - segments.length).entries()) segments.push({
      trackIndex, segmentIndex, trackType: ['video', 'audio', 'text', 'effect', 'filter', 'sticker'].includes(track.type) ? track.type : 'other',
      sourceUs: range(segment.source_timerange), timelineUs: range(segment.target_timerange), speed: number(segment.speed), curves: curves(segment, budget),
    });
  }
  const media = [];
  for (const kind of ['videos', 'audios', 'images']) for (const [index, material] of list(draft.materials?.[kind]).slice(0, 300).entries()) {
    media.push({ kind, index, ...await mediaAccess(material, project) });
  }
  return { ...report, project: { state: 'readable', document: ['draft_content.json', 'draft_info.json', 'template-2.tmp'].includes(basename(filePath)) ? basename(filePath) : 'other',
      timeline: relative(project, filePath).split(sep)[0] === 'Timelines' ? 'active' : 'root',
      documentSha256: createHash('sha256').update(store.canonical.raw).digest('hex') },
    compatibility: { appVersion: version(safety.detected.app_version), schema: number(safety.detected.schema_int),
      writeAllowed: safety.action !== 'refuse', nativePlaybackChecked: false,
      status: safety.action === 'refuse' ? 'outside-evidence-boundary' : 'within-write-boundary',
      nextStep: safety.action === 'refuse' ? 'Share this report. A disposable project saved before and after a native zoom, plus a real CapCut round-trip, is required before enabling writes for a new format.' : 'File checks may proceed. This does not establish native playback compatibility.' },
    timeline: { fps: number(draft.fps), durationUs: number(draft.duration), width: number(draft.canvas_config?.width), height: number(draft.canvas_config?.height),
      segmentCount, truncated: segmentCount > segments.length || budget.truncated, segments },
    mediaTruncated: ['videos', 'audios', 'images'].some(kind => list(draft.materials?.[kind]).length > 300), media };
}
