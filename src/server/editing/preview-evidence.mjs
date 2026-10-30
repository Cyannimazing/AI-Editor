import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadDraft } from '../../../toolchain/node_modules/capcut-cli/dist/draft.js';
import { containedPath, assertNoLinks } from '../security/paths.ts';
import { directoryDigest } from './transaction.ts';
import { qualityAction } from './quality.mjs';
import { intervalTracks } from './timeline-interval.mjs';

async function digest(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Review evidence must be a regular file.');
  const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
const readDraft = candidate => loadDraft(candidate, { activeTimeline: existsSync(join(candidate, 'Timelines')) }).draft;
function requiredFiles(iteration) {
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 4) throw new Error('Preview evidence is incomplete: invalid iteration.');
  return ['preview.mp4', `preview-${iteration}.mp4`, `preview-plan-${iteration}.json`, 'controlled-editing-plan.json', 'manifest.json',
    'quality-report.json', `structural-evidence-${iteration}.json`, `lint-${iteration}.json`, `motion-curves-${iteration}.json`, `preview-coverage-${iteration}.json`,
    `assessment-${iteration}/reviewer.json`, `assessment-${iteration}/manager.json`, `preview-evidence-${iteration}/reference-frames.json`];
}

/** Bind all overlapping layers and their transitive materials, not just the edited clip. */
export function intervalDigest(draft, interval) {
  if (!Number.isFinite(interval?.start) || interval.start < 0 || !Number.isFinite(interval.duration) || interval.duration <= 0)
    throw new Error('Invalid preview review interval.');
  const materials = new Map(Object.values(draft.materials || {}).flat().filter(item => item?.id).map(item => [item.id, item]));
  const required = new Set();
  const visit = value => {
    if (typeof value === 'string' && materials.has(value) && !required.has(value)) { required.add(value); visit(materials.get(value)); }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const tracks = intervalTracks(draft, interval);
  // Identity is restamped for each private copy; other root properties can affect rendering.
  const settings = Object.fromEntries(Object.entries(draft).filter(([key]) => !['id', 'name', 'tracks', 'materials'].includes(key)));
  visit(tracks); visit(settings);
  return createHash('sha256').update(JSON.stringify({ settings, tracks,
    materials: [...required].sort().map(id => materials.get(id)) })).digest('hex');
}

async function assetsFor(candidate) {
  const draft = readDraft(candidate);
  const paths = new Set([...(draft.materials.videos || []), ...(draft.materials.audios || [])].map(item => item.path).filter(Boolean));
  for (const text of draft.materials.texts || []) {
    if (text.font_path) paths.add(text.font_path);
    const content = typeof text.content === 'string' ? JSON.parse(text.content) : text.content;
    for (const style of content?.styles || []) if (style.font?.path) paths.add(style.font.path);
  }
  const resources = new Set(Object.values(draft.materials).flat().filter(item => item && !paths.has(item.path)
    && typeof item.path === 'string' && item.path && isAbsolute(item.path)).map(item => item.path));
  const assets = [];
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error('Candidate media needs an absolute local path.');
    assets.push({ path, kind: 'file', sha256: await digest(path) });
  }
  for (const path of resources) {
    const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('Linked effect resources are not supported.');
    assets.push({ path, kind: info.isDirectory() ? 'directory' : 'file', sha256: info.isDirectory() ? await directoryDigest(path) : await digest(path) });
  }
  return assets;
}

/** Take this before rendering, not after the model assessments. */
export async function snapshotPreviewInputs(candidate) {
  await assertNoLinks(candidate);
  return { candidateDigest: await directoryDigest(candidate), assets: await assetsFor(candidate) };
}

export async function sealPreviewEvidence({ inputs, job, candidate, iteration, quality, interval, evidenceFiles = /** @type {string[]} */ ([]) }) {
  await assertNoLinks(job); await assertNoLinks(candidate);
  const revision = await directoryDigest(candidate);
  const current = await snapshotPreviewInputs(candidate);
  if (!inputs || JSON.stringify(inputs) !== JSON.stringify(current)) throw new Error('Candidate inputs changed during preview rendering or review.');
  if (quality.reviewMode !== 'preview' || quality.nativeVerified !== false || quality.candidateDigest !== revision || qualityAction(quality, 1, 1) !== 'approve')
    throw new Error('Only passing file and preview assessments can be sealed.');
  const structure = JSON.parse(await readFile(join(job, `structural-evidence-${iteration}.json`), 'utf8'));
  if (structure.candidateDigest !== revision || structure.structuralValidation !== 'passed' || !structure.lint?.ok
    || structure.originalUnchanged !== true || structure.unrelatedContentPreserved !== true) throw new Error('Structural evidence is incomplete or stale.');
  const coverage = JSON.parse(await readFile(join(job, `preview-coverage-${iteration}.json`), 'utf8'));
  if (coverage.candidateDigest !== revision || !Array.isArray(coverage.issues) || coverage.issues.length) throw new Error('Preview coverage is incomplete or stale.');
  const savedQuality = JSON.parse(await readFile(join(job, 'quality-report.json'), 'utf8'));
  if (JSON.stringify(savedQuality) !== JSON.stringify(quality)) throw new Error('The saved assessment differs from the reviewed candidate.');
  const paths = [...new Set(requiredFiles(iteration).map(name => join(job, name)).concat(evidenceFiles))];
  const files = [];
  for (const path of paths) { await containedPath(job, path); files.push({ path, sha256: await digest(path) }); }
  const assets = inputs.assets;
  const receipt = { version: 1, kind: 'file-and-preview-review', status: 'reviewed', reviewMode: 'preview', nativeVerified: false,
    candidateDigest: revision, sourceRevision: revision, interval, intervalDigest: intervalDigest(readDraft(candidate), interval),
    iteration, files, assets, quality, createdAt: new Date().toISOString() };
  const path = join(job, `preview-review-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(receipt));
  await assertPreviewEvidence(job, candidate, path);
  return path;
}

export async function assertPreviewEvidence(job, candidate, receiptPath) {
  await assertNoLinks(candidate);
  const receipt = JSON.parse(await readFile(await containedPath(job, receiptPath), 'utf8'));
  if (receipt.kind !== 'file-and-preview-review' || receipt.status !== 'reviewed' || receipt.reviewMode !== 'preview' || receipt.nativeVerified !== false
    || receipt.candidateDigest !== await directoryDigest(candidate) || !receipt.files?.length || !Array.isArray(receipt.assets)
    || receipt.quality?.candidateDigest !== receipt.sourceRevision || receipt.quality?.reviewMode !== 'preview'
    || receipt.quality.nativeVerified !== false || qualityAction(receipt.quality, 1, 1) !== 'approve') throw new Error('Preview review evidence is stale or incomplete.');
  if (receipt.intervalDigest !== intervalDigest(readDraft(candidate), receipt.interval)) throw new Error('Reviewed timeline content changed.');
  const paths = new Set(receipt.files.map(file => resolve(file.path)));
  if (paths.size !== receipt.files.length || requiredFiles(receipt.iteration).some(name => !paths.has(resolve(job, name)))) throw new Error('Preview evidence is incomplete.');
  for (const file of receipt.files) {
    await containedPath(job, file.path);
    if (await digest(file.path) !== file.sha256) throw new Error('Preview review evidence changed after assessment.');
  }
  if (JSON.stringify(await assetsFor(candidate)) !== JSON.stringify(receipt.assets)) throw new Error('Candidate media, fonts or effect resources changed after preview review.');
  return receipt;
}

/** Reuse comparison only if every overlapping layer/material is identical in the final revision. */
export async function carryForwardPreviewEvidence(job, previousCandidate, candidate, evidencePath) {
  const previous = await assertPreviewEvidence(job, previousCandidate, evidencePath);
  if (intervalDigest(readDraft(candidate), previous.interval) !== previous.intervalDigest) throw new Error('An overlapping component changed after this clip was reviewed. A fresh preview review is required.');
  const receipt = { ...previous, candidateDigest: await directoryDigest(candidate), assets: await assetsFor(candidate),
    carriedFrom: previous.candidateDigest, createdAt: new Date().toISOString() };
  const path = join(job, `preview-review-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(receipt));
  await assertPreviewEvidence(job, candidate, path);
  return { evidencePath: path, quality: { ...previous.quality, candidateDigest: receipt.candidateDigest } };
}
