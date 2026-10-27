import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath, lstat, rename } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { mediaTool } from '../platform/runtime.mjs';

const run = promisify(execFile);
const inside = (root, file) => { const path = relative(root, file); return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path); };

// Only continuous, paired, nearly black edge bands qualify. This is not a
// subject crop: an isolated dark corner or a one-sided shadow is left alone.
export function pictureBounds(gray, width, height) {
  if (gray.length !== width * height) throw new Error('Invalid picture sample.');
  const rows = new Uint32Array(height), cols = new Uint32Array(width);
  let lit = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (gray[y * width + x] > 12) {
    rows[y]++; cols[x]++; lit++;
  }
  if (lit < width * height * 0.08) return null;
  const edge = (values, cross) => {
    const threshold = Math.max(2, cross * 0.003);
    let first = 0, last = values.length - 1;
    while (first < last && values[first] <= threshold) first++;
    while (last > first && values[last] <= threshold) last--;
    return [first, last + 1];
  };
  const [left, right] = edge(cols, height), [top, bottom] = edge(rows, width);
  if (right - left < width * 0.5 || bottom - top < height * 0.5) return null;
  return { left, top, right, bottom };
}

export function stablePictureCrop(samples, width, height, sampleWidth = width, sampleHeight = height) {
  const full = { x: 0, y: 0, width, height };
  if (samples.length < 3 || samples.some(sample => !sample)) return full;
  const axis = (start, end, size, original) => {
    const starts = samples.map(s => s[start]), ends = samples.map(s => s[end]);
    // Movement of the boundary is scene content/animation, not stable padding.
    if (Math.max(...starts) - Math.min(...starts) > 2 || Math.max(...ends) - Math.min(...ends) > 2) return [0, original];
    const first = Math.min(...starts), last = Math.max(...ends);
    if (first < 4 || size - last < 4 || Math.abs(first - (size - last)) > size * 0.04) return [0, original];
    // Round outward so measured picture pixels are never discarded.
    const lo = Math.floor(first * original / size / 2) * 2;
    const hi = Math.min(original, Math.ceil(last * original / size / 2) * 2);
    return [lo, hi];
  };
  const [x, right] = axis('left', 'right', sampleWidth, width);
  const [y, bottom] = axis('top', 'bottom', sampleHeight, height);
  return { x, y, width: right - x, height: bottom - y };
}

export function pictureFramingPolicy(prompt, selectedClip = false) {
  if (selectedClip) return 'existing-canvas';
  return /\b(?:keep|preserve|retain)\b[^.!?\n]{0,50}\b(?:black bars|borders|letterbox|pillarbox|mattes)\b/i.test(prompt)
    ? 'preserve-borders' : 'fill-picture';
}

async function probe(path, signal) {
  const { stdout } = await run(mediaTool('ffprobe'), ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,avg_frame_rate,sample_aspect_ratio:stream_side_data=rotation', '-of', 'json', path],
  { timeout: 30000, maxBuffer: 1000000, windowsHide: true, signal });
  const data = JSON.parse(stdout), video = data.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(data.format?.duration), [n, d] = (video?.avg_frame_rate || '30/1').split('/').map(Number);
  if (!video || !Number.isFinite(duration) || duration < 0.1 || duration > 600 ||
    !(video.width >= 64 && video.height >= 64 && video.width * video.height <= 34_000_000)) throw new Error('Video exceeds the picture preparation limits.');
  return { width: video.width, height: video.height, duration, fps: n / d || 30,
    audio: data.streams.filter(stream => stream.codec_type === 'audio').length,
    orientationSupported: !(video.side_data_list || []).some(item => item.rotation % 360) && ['1:1', 'N/A', undefined].includes(video.sample_aspect_ratio) };
}

/** Prepare job-owned source media BEFORE measuring motion. Originals stay next
 * to the derivative. No authored effect, text, layer or keyframe is flattened.
 * Reference normalization is limited to a nearly identical picture aspect.
 */
export async function preparePictureMedia({ source, job, name, canvas, signal }) {
  if (!['source-picture', 'reference-picture'].includes(name)) throw new Error('Invalid picture preparation role.');
  const root = await realpath(job), path = await realpath(source);
  if (!inside(root, path) || (await lstat(source)).isSymbolicLink()) throw new Error('Picture preparation requires job-owned media.');
  const original = await probe(path, signal);
  if (!original.orientationSupported) return { path, ...original, changed: false, reason: 'Rotated or anamorphic input retained; automatic edge crop requires square pixels and upright media.' };
  const ratio = Math.min(1, 1920 / Math.max(original.width, original.height));
  const sw = Math.floor(original.width * ratio / 2) * 2, sh = Math.floor(original.height * ratio / 2) * 2;
  const count = Math.min(9, Math.max(3, Math.floor(original.duration * original.fps)));
  const { stdout: pixels } = await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', path,
    '-map', '0:v:0', '-vf', `fps=${count / original.duration},scale=${sw}:${sh},format=gray`,
    '-frames:v', String(count), '-an', '-f', 'rawvideo', 'pipe:1'],
  { encoding: 'buffer', timeout: 120000, maxBuffer: sw * sh * (count + 1), windowsHide: true, signal });
  const samples = [];
  for (let start = 0; start + sw * sh <= pixels.length; start += sw * sh) samples.push(pictureBounds(pixels.subarray(start, start + sw * sh), sw, sh));
  const crop = stablePictureCrop(samples, original.width, original.height, sw, sh);
  const cropped = crop.x !== 0 || crop.y !== 0 || crop.width !== original.width || crop.height !== original.height;
  const matchCanvas = canvas && Number.isInteger(canvas.width) && Number.isInteger(canvas.height) &&
    canvas.width >= 64 && canvas.height >= 64 && canvas.width * canvas.height <= 34_000_000 &&
    Math.abs((crop.width / crop.height) / (canvas.width / canvas.height) - 1) <= 0.03;
  const width = matchCanvas ? canvas.width : crop.width, height = matchCanvas ? canvas.height : crop.height;
  const resize = width !== crop.width || height !== crop.height;
  const output = cropped || resize ? join(root, `${name}.mp4`) : path;
  const filters = [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`];
  if (resize) filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
  filters.push('setsar=1');
  const receipt = { version: 1, policy: 'fill-picture', original: { path, ...original }, crop,
    output: { path: output, width, height }, sampleCount: samples.length, samples, sampleWidth: sw, sampleHeight: sh,
    changed: output !== path, filters: output !== path ? filters : [],
    explanation: 'Stable paired encoded edge padding removed from a retained working copy before motion analysis. Reference aspect is cover-matched only within 3%; no stretching. Native layers and curves are authored afterward.' };
  if (output !== path) {
    const temporary = join(root, `${name}.partial.mp4`);
    await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path,
      '-map', '0:v:0', '-map', '0:a?', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary],
    { timeout: 180000, maxBuffer: 2000000, windowsHide: true, signal });
    const result = await probe(temporary, signal);
    if (result.width !== width || result.height !== height || result.audio !== original.audio ||
      Math.abs(result.duration - original.duration) > Math.max(0.05, 1 / original.fps)) throw new Error('Picture preparation changed media timing, audio or dimensions.');
    await rename(temporary, output);
  }
  receipt.original.sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
  receipt.output.sha256 = output === path ? receipt.original.sha256 : createHash('sha256').update(await readFile(output)).digest('hex');
  await writeFile(join(root, `${name}.json`), JSON.stringify(receipt, null, 2));
  return { path: output, width, height, duration: original.duration, changed: receipt.changed, receipt };
}
