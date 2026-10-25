import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function assertClosed() {
  if (process.platform === 'win32' && /"CapCut\.exe"/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }))) {
    throw new Error('Close CapCut before writing draft files.');
  }
}

export async function activeDraft(project) {
  const pointer = join(project, 'Timelines', 'project.json');
  let file = join(project, 'draft_content.json');
  if (existsSync(pointer)) {
    const selection = JSON.parse(await readFile(pointer, 'utf8'));
    const id = selection.main_timeline_id;
    if (!id || /[\\/\0]/.test(id) || !selection.timelines?.some((item) => item.id === id && !item.is_marked_delete)) throw new Error('Invalid active timeline pointer.');
    file = join(project, 'Timelines', id, 'draft_content.json');
  }
  return { file, draft: JSON.parse(await readFile(file, 'utf8')) };
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
  loadDraft(destination, { activeTimeline: true });
  saveDraft(file, rebase({ ...draft, id: original.id, name: original.name }, candidate, destination), { preserveProjectFields: true });
}

async function isolateCandidate(project) {
  assertClosed();
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const offset = relative(join(repository, '.local-tools', 'staging'), resolve(project));
  if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error('Only a staged candidate can be isolated.');
  const { file, draft } = await activeDraft(project);
  const id = randomUUID().toUpperCase();
  const name = `AI Editor review ${id.slice(0, 8)}`;
  const pointerPath = join(project, 'Timelines', 'project.json');
  if (existsSync(pointerPath)) {
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
    const previousId = pointer.main_timeline_id;
    const newFolder = join(project, 'Timelines', id);
    await cp(dirname(file), newFolder, { recursive: true });
    pointer.main_timeline_id = id;
    pointer.timelines = pointer.timelines.map((timeline) => timeline.id === previousId ? { ...timeline, id } : timeline);
    await writeFile(pointerPath, JSON.stringify(pointer));
    await writeFile(join(newFolder, 'draft_content.json'), JSON.stringify({ ...draft, id, name }));
  }
  await writeFile(join(project, 'draft_content.json'), JSON.stringify({ ...draft, id, name }));
  const metadataPath = join(project, 'draft_meta_info.json');
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    Object.assign(metadata, { draft_id: id, draft_name: name, draft_fold_path: resolve(project), draft_root_path: dirname(resolve(project)) });
    await writeFile(metadataPath, JSON.stringify(metadata));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, project, destination] = process.argv.slice(2);
  if (!project) throw new Error('Expected a project directory.');
  if (action === 'digest') process.stdout.write(await draftDigest(project));
  else if (action === 'active') process.stdout.write(JSON.stringify(await activeDraft(project)));
  else if (action === 'isolate') await isolateCandidate(project);
  else if (action === 'commit' && destination) await commitCandidate(project, destination);
  else throw new Error('Usage: capcut-draft.mjs digest|active|isolate <project> | commit <candidate> <destination>');
}
