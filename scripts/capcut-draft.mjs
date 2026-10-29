import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageJobResources } from '../src/server/capcut/package-resources.mjs';

function assertClosed() {
  if (process.platform === 'darwin') {
    try { execFileSync('/usr/bin/pgrep', ['-x', 'CapCut'], { timeout: 10000 }); }
    catch (error) { if (error.status === 1) return; throw error; }
    throw new Error('Close CapCut before writing draft files.');
  }
  if (process.platform === 'win32' && /"CapCut\.exe"/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }))) {
    throw new Error('Close CapCut before writing draft files.');
  }
}

export async function activeDraft(project, snapshot = false) {
  const { loadDraft, loadedDraftStore } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { draft, filePath } = loadDraft(project, { activeTimeline: existsSync(join(project, 'Timelines')) });
  const offset = relative(resolve(project), filePath);
  if (offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error('Draft escapes project directory.');
  return { file: filePath, draft, ...(snapshot ? { raw: loadedDraftStore(filePath).canonical.raw } : {}) };
}

async function draftFiles(project, folder = project) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && ['Timelines', 'subdraft', 'subdrafts'].includes(entry.name)) files.push(...await draftFiles(project, join(folder, entry.name)));
    else if (entry.isDirectory() && folder !== project) files.push(...await draftFiles(project, join(folder, entry.name)));
    else if (entry.isFile() && ['draft_content.json', 'draft_info.json', 'sub_draft_config.json', 'project.json'].includes(entry.name)) files.push(join(folder, entry.name));
  }
  return files.sort();
}

export async function draftDigest(project) {
  const digest = createHash('sha256');
  for (const file of await draftFiles(project)) digest.update(relative(project, file).replaceAll('\\', '/')).update(await readFile(file));
  return digest.digest('hex');
}

function rebase(value, candidate, destination) {
  if (typeof value === 'string') {
    const expanded = value.replace(/##_draftpath_placeholder_[^#]+_##/g, resolve(destination).replaceAll('\\', '/'));
    const normalized = expanded.replaceAll('\\', '/');
    const prefix = resolve(candidate).replaceAll('\\', '/');
    if (normalized.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) return resolve(destination).replaceAll('\\', '/') + normalized.slice(prefix.length);
    return expanded;
  }
  if (Array.isArray(value)) return value.map((item) => rebase(item, candidate, destination));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, candidate, destination)]));
  return value;
}

export async function commitCandidate(candidate, destination) {
  assertClosed();
  const { draft } = await activeDraft(candidate);
  const { file, draft: original } = await activeDraft(destination);
  for (const name of ['assets', 'subdraft', 'subdrafts']) {
    if (existsSync(join(candidate, name))) await cp(join(candidate, name), join(destination, name), { recursive: true });
  }
  for (const source of await draftFiles(candidate)) {
    const offset = relative(candidate, source);
    if (!offset.startsWith(`subdraft${sep}`) && !offset.startsWith(`subdrafts${sep}`)) continue;
    const target = join(destination, offset);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(rebase(JSON.parse(await readFile(source, 'utf8')), candidate, destination)));
  }
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const jobStore = join(fileURLToPath(new URL('../', import.meta.url)), '.local-tools', 'native-assets');
  await packageJobResources(draft, destination, jobStore);
  loadDraft(destination, { activeTimeline: existsSync(join(destination, 'Timelines')) });
  saveDraft(file, rebase({ ...draft, id: original.id, name: original.name }, candidate, destination), { preserveProjectFields: true });
}

/** Publish a separate project; never overwrite the source or a previous review. */
export async function publishCandidate(candidate, destination) {
  assertClosed();
  if (existsSync(destination)) throw new Error('Review destination already exists.');
  await cp(candidate, destination, { recursive: true, force: false, errorOnExist: true });
  for (const file of await draftFiles(destination)) {
    await writeFile(file, JSON.stringify(rebase(JSON.parse(await readFile(file, 'utf8')), candidate, destination)));
  }
  const { findStoreSeed, storeOutgrowsTemplate } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { restampDraft } = await import('../toolchain/node_modules/capcut-cli/dist/migrate.js');
  const donor = findStoreSeed(dirname(destination));
  const { draft: published } = await activeDraft(destination);
  if (donor && storeOutgrowsTemplate(published.platform?.app_version, donor.appVersion)) {
    const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
    const loaded = loadDraft(destination, { activeTimeline: existsSync(join(destination, 'Timelines')) });
    restampDraft(loaded.draft, donor.draft, donor.projectDir);
    saveDraft(loaded.filePath, loaded.draft, { preserveProjectFields: true });
  }
  await assignCandidateIdentity(destination, basename(destination));
  // Root and active timeline must contain the same compiled content on newer CapCut builds.
  const { draft, file: activeFile } = await activeDraft(destination);
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const jobAssets = resolve(repository, '.local-tools', 'native-assets');
  const copied = await packageJobResources(draft, destination, jobAssets);
  if (copied) {
    const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
    loadDraft(destination, { activeTimeline: existsSync(join(destination, 'Timelines')) });
    saveDraft(activeFile, draft, { preserveProjectFields: true });
  }
  const root = join(destination, existsSync(join(destination, 'draft_content.json')) ? 'draft_content.json' : 'draft_info.json');
  await writeFile(root, JSON.stringify(draft));
  const metadataPath = join(destination, 'draft_meta_info.json');
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    Object.assign(metadata, { draft_id: draft.id, draft_name: draft.name, draft_fold_path: resolve(destination).replaceAll('\\', '/'), draft_root_path: dirname(resolve(destination)).replaceAll('\\', '/') });
    await writeFile(metadataPath, JSON.stringify(metadata));
  }
}

/** Registration links only. General lint fixes can change authored text/timing. */
async function linkPublishedMedia(project) {
  assertClosed();
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { linkLocalMaterialIds, readSidecar } = await import('../toolchain/node_modules/capcut-cli/dist/materials-register.js');
  const { lintDraft, summarize, DEFAULT_LINT_OPTIONS } = await import('../toolchain/node_modules/capcut-cli/dist/lint.js');
  const { draft, filePath } = loadDraft(project, { activeTimeline: existsSync(join(project, 'Timelines')) });
  const linked = linkLocalMaterialIds(draft, readSidecar(project), project);
  if (linked.length) saveDraft(filePath, draft, { preserveProjectFields: true });
  const issues = lintDraft(draft, { ...DEFAULT_LINT_OPTIONS, draftDir: project });
  const summary = summarize(issues);
  await writeFile(join(project, 'ai-editor-inspection-lint.json'), JSON.stringify({ summary, issues, linked }));
  if (summary.errors) throw new Error(`Published draft has ${summary.errors} lint errors. No content repair was applied.`);
  process.stdout.write(JSON.stringify({ linked: linked.length, warnings: summary.warnings }));
}

async function isolateCandidate(project) {
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const offset = relative(join(repository, '.local-tools', 'staging'), resolve(project));
  if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error('Only a staged candidate can be isolated.');
  await assignCandidateIdentity(project);
}

async function assignCandidateIdentity(project, publishedName) {
  const { file, draft } = await activeDraft(project);
  const { assertDraftWriteable } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { discoverDraftStore, serializeDraftCandidate } = await import('../toolchain/node_modules/capcut-cli/dist/store.js');
  assertDraftWriteable(file, draft);
  const store = discoverDraftStore(project, { activeTimeline: existsSync(join(project, 'Timelines')) });
  const id = randomUUID().toUpperCase();
  const name = publishedName || `AI Editor review ${id.slice(0, 8)}`;
  const pointerPath = join(project, 'Timelines', 'project.json');
  let pointer;
  let newFolder;
  if (existsSync(pointerPath)) {
    pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
    const previousId = pointer.main_timeline_id;
    newFolder = join(project, 'Timelines', id);
    await cp(dirname(file), newFolder, { recursive: true });
    pointer.main_timeline_id = id;
    pointer.timelines = pointer.timelines.map((timeline) => timeline.id === previousId ? { ...timeline, id } : timeline);
  }
  // Preserve document envelopes and stamp every selected/root mirror. Updating
  // only the canonical document leaves template-2.tmp with an old name and
  // makes the CLI correctly reject our own isolated copy on its next read.
  for (const target of store.targets) {
    const path = newFolder && dirname(target.path) === dirname(file) ? join(newFolder, basename(target.path)) : target.path;
    await writeFile(path, serializeDraftCandidate({ ...target, keepGuid: id }, { ...draft, id, name }));
  }
  if (pointer) await writeFile(pointerPath, JSON.stringify(pointer));
  const metadataPath = join(project, 'draft_meta_info.json');
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    Object.assign(metadata, { draft_id: id, draft_name: name, draft_fold_path: resolve(project).replaceAll('\\', '/'), draft_root_path: dirname(resolve(project)).replaceAll('\\', '/') });
    await writeFile(metadataPath, JSON.stringify(metadata));
  }
  // Check before any model turn or compilation can spend work on this copy.
  await activeDraft(project);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, project, destination] = process.argv.slice(2);
  if (!project) throw new Error('Expected a project directory.');
  if (action === 'digest') process.stdout.write(await draftDigest(project));
  else if (action === 'active') process.stdout.write(JSON.stringify(await activeDraft(project)));
  else if (action === 'snapshot') process.stdout.write(JSON.stringify(await activeDraft(project, true)));
  else if (action === 'isolate') await isolateCandidate(project);
  else if (action === 'commit' && destination) await commitCandidate(project, destination);
  else if (action === 'publish' && destination) await publishCandidate(project, destination);
  else if (action === 'link-media') await linkPublishedMedia(project);
  else throw new Error('Usage: capcut-draft.mjs digest|active|snapshot|isolate <project> | commit <candidate> <destination>');
}
