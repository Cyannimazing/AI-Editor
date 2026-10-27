import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile, lstat, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaTool } from '../platform/runtime.mjs';

const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'linearGradient', 'radialGradient', 'stop']);
const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'id', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'transform', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform']);

export function validateVectorAsset(asset) {
  if (!asset || Object.keys(asset).some(key => !['id', 'svg', 'width', 'height'].includes(key)) || !/^[a-z][a-z0-9-]{0,39}$/.test(asset.id)) throw new Error('Invalid generated vector asset.');
  for (const dimension of [asset.width, asset.height]) if (!Number.isInteger(dimension) || dimension < 16 || dimension > 2048) throw new Error('Vector dimensions must be 16–2048 pixels.');
  const source = asset.svg;
  if (typeof source !== 'string' || Buffer.byteLength(source) > 100000 || !/^\s*<svg\s/.test(source) || !/<\/svg>\s*$/.test(source) || /<!|<\?|&|\b(?:href|src)\s*=|\bon\w+\s*=|@|javascript:|data:|https?:/i.test(source.replace('http://www.w3.org/2000/svg', ''))) throw new Error('Vector assets must be script-free, self-contained shapes without external resources or text.');
  const elements = source.match(/<[^>]+>/g) || [];
  if (!elements.length || elements.length > 500) throw new Error('Vector asset exceeds its element budget.');
  for (const element of elements) {
    const match = /^<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>$/s.exec(element);
    if (!match || !tags.has(match[1])) throw new Error('Unsupported vector element. Keep words as native text.');
    const rest = match[2].replace(/\s+([\w-]+)\s*=\s*("[^"]*"|'[^']*')/g, (_, key, value) => {
      if (!attributes.has(key)) throw new Error(`Unsupported vector attribute: ${key}`);
      if (/url\(/i.test(value) && !/^['"]url\(#[a-zA-Z][\w-]*\)['"]$/.test(value)) throw new Error('Only local gradient references are allowed.');
      return '';
    });
    if (!/^\s*\/?\s*$/.test(rest)) throw new Error('Malformed vector attributes.');
  }
  return asset;
}

export async function renderVectorAssets(assets, folder, source, duration) {
  if (!assets.length) return new Map();
  if (assets.length > 24) throw new Error('Too many generated assets in one build.');
  const seen = new Set();
  for (const asset of assets) {
    const { kind, frameTime, ...vector } = asset;
    if (kind === 'source-frame') {
      if (!source || !/^[a-z][a-z0-9-]{0,39}$/.test(asset.id) || asset.svg !== '' || !Number.isFinite(frameTime) || frameTime < 0 || frameTime >= duration || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 16 || asset.height < 16 || asset.width > 2048 || asset.height > 2048 || Object.keys(asset).some(key => !['id', 'svg', 'width', 'height', 'kind', 'frameTime'].includes(key))) throw new Error('Invalid source-frame generation request.');
    } else { if (kind && kind !== 'svg') throw new Error('Unknown asset generator.'); validateVectorAsset(vector); }
    if (seen.has(asset.id)) throw new Error('Duplicate asset ID.'); seen.add(asset.id);
  }
  const require = createRequire(import.meta.url);
  const sharp = require(require.resolve('sharp', { paths: [dirname(require.resolve('next/package.json'))] }));
  const parent = join(folder, 'generated-assets'); await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error('Generated asset directories cannot be linked.');
  let sourceDigest = '';
  if (assets.some(asset => asset.kind === 'source-frame')) {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(source)) digest.update(chunk);
    sourceDigest = digest.digest('hex');
  }
  const paths = new Map();
  for (const asset of assets) {
    const identity = { generatorVersion: 1, id: asset.id, kind: asset.kind || 'svg', frameTime: asset.frameTime || 0,
      width: asset.width, height: asset.height, svg: asset.svg, sourceSha256: asset.kind === 'source-frame' ? sourceDigest : '' };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const cached = join(parent, `asset-${key}`);
    const cachedStat = await lstat(cached).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (cachedStat) {
      if (!cachedStat.isDirectory() || cachedStat.isSymbolicLink()) throw new Error('Invalid asset cache directory.');
      const png = join(cached, `${asset.id}.png`), receipt = join(cached, 'receipt.json');
      if (!(await lstat(png)).isFile() || (await lstat(png)).isSymbolicLink() || !(await lstat(receipt)).isFile()) throw new Error('Invalid cached asset files.');
      const saved = JSON.parse(await readFile(receipt, 'utf8'));
      if (saved.key !== key || saved.pngSha256 !== createHash('sha256').update(await readFile(png)).digest('hex')) throw new Error('Cached generated asset integrity failed.');
      if (asset.kind !== 'source-frame') {
        const svg = join(cached, `${asset.id}.svg`);
        if (!(await lstat(svg)).isFile() || (await readFile(svg, 'utf8')) !== asset.svg) throw new Error('Cached vector source changed.');
      }
      paths.set(asset.id, png);
      continue;
    }
    const destination = await mkdtemp(join(parent, 'build-'));
    const svg = join(destination, `${asset.id}.svg`), png = join(destination, `${asset.id}.png`);
    if (asset.kind === 'source-frame') {
      await promisify(execFile)(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-ss', String(asset.frameTime), '-i', source, '-frames:v', '1', '-vf', `scale=${asset.width}:${asset.height},format=rgba`, png], { timeout: 30000, windowsHide: true, maxBuffer: 1_000_000 });
      await writeFile(join(destination, `${asset.id}.source.json`), JSON.stringify({ generator: 'source-frame', source, timeSeconds: asset.frameTime, width: asset.width, height: asset.height }));
    } else {
      await writeFile(svg, asset.svg);
      await sharp(Buffer.from(asset.svg), { limitInputPixels: 2048 * 2048 }).resize(asset.width, asset.height, { fit: 'fill' }).ensureAlpha().png().toFile(png);
    }
    await writeFile(join(destination, 'receipt.json'), JSON.stringify({ key, identity, pngSha256: createHash('sha256').update(await readFile(png)).digest('hex') }));
    await rename(destination, cached);
    paths.set(asset.id, join(cached, `${asset.id}.png`));
  }
  return paths;
}
