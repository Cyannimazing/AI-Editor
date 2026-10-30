import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { promisify } from "node:util";
import { platformPaths } from "../server/platform/runtime.mjs";
import { containedPath } from "../server/security/paths";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve, relative, sep } from "node:path";

const draftsRoot = platformPaths().drafts;
const localProjects = join(process.cwd(), ".local-tools", "projects");

type Segment = {
  id: string; material_id: string; source_timerange?: { start: number; duration: number };
  target_timerange: { start: number; duration: number }; speed?: number; reverse?: boolean;
  extra_material_refs?: string[]; [key: string]: unknown;
};
type VideoMaterial = { id: string; path: string; material_name?: string; width?: number; height?: number; type?: string };
export type ProjectDraft = {
  name?: string; fps?: number; canvas_config?: { width?: number; height?: number };
  tracks: { id?: string; name?: string; type: string; segments: Segment[] }[];
  materials?: { videos?: VideoMaterial[]; speeds?: { id: string; speed?: number; curve_speed?: unknown }[] };
};
export type ClipSummary = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
export type ProjectSummary = { id: string; name: string; path: string; kind: 'project' | 'temporary-review' | 'test-project'; hasTimelineContent: boolean; clips: ClipSummary[] };

function projectFolder(id: string) {
  const local = id.startsWith("local:");
  const name = local ? id.slice(6) : id;
  if (!name || name === "." || name === ".." || /[\\/\0:]/.test(name)) throw new Error("Invalid project name.");
  return { root: local ? localProjects : draftsRoot, folder: join(local ? localProjects : draftsRoot, name) };
}

export async function listProjects(includeLocal = true, signal?: AbortSignal): Promise<ProjectSummary[]> {
  return (await discoverProjects(includeLocal, signal)).projects;
}

export async function discoverProjects(includeLocal = false, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const projects: ProjectSummary[] = [];
  const discovery = { rootStatus: 'available' as 'available' | 'missing' | 'unreadable',
    capcutProjectsFound: 0, hiddenReviewCopies: 0, unreadableProjects: [] as { id: string; name: string; message: string }[] };
  for (const [root, prefix] of [[draftsRoot, ""], [localProjects, "local:"]] as const) {
  if (prefix && !includeLocal) continue;
  const folders = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (!prefix) discovery.rootStatus = error.code === 'ENOENT' ? 'missing' : 'unreadable';
    return [];
  });
  for (const entry of folders.filter((item) => item.isDirectory() && !/^(?:\.recycle_bin|\.cloud_cache_.*)$/.test(item.name))) {
    signal?.throwIfAborted();
    const path = join(root, entry.name);
    // CapCut cache/recycle folders are not projects. Recognizable but broken
    // project documents must be reported instead of silently disappearing.
    try {
      await containedPath(root, path);
      const names = await readdir(/* turbopackIgnore: true */ path);
      if (!['draft_content.json', 'draft_info.json', 'template-2.tmp', 'draft_meta_info.json', 'Timelines'].some(name => names.includes(name))) continue;
    } catch {
      signal?.throwIfAborted();
      if (!prefix) discovery.capcutProjectsFound++;
      discovery.unreadableProjects.push({ id: prefix + entry.name, name: entry.name,
        message: 'This folder could not be accessed safely. Check its file permissions, then refresh.' });
      continue;
    }
    if (!prefix) discovery.capcutProjectsFound++;
    try {
      // Review fixtures are not editing destinations. Do not infer ownership
      // from a user's project name; only our explicit marker hides a copy.
      await containedPath(root, path);
      const marker = await readFile(join(path, '.ai-editor-review.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (!includeLocal && marker?.kind === 'temporary-review') {
        discovery.hiddenReviewCopies++; continue;
      }
      const { draft } = await readProjectDraft(prefix + entry.name, signal);
      let name = draft.name || entry.name;
      try {
        const metadata = JSON.parse(await readFile(join(path, "draft_meta_info.json"), "utf8")) as { draft_name?: string };
        if (metadata.draft_name) name = metadata.draft_name;
      } catch { name = draft.name || entry.name; }
      const clips = draft.tracks.flatMap((track, index) => track.type !== "video" ? [] : (track.segments ?? []).flatMap((segment) => {
        const material = draft.materials?.videos?.find((item) => item.id === segment.material_id);
        if (!material?.path || ![".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(extname(material.path).toLowerCase())) return [];
        return [{ id: segment.id, name: material.material_name || basename(material.path),
          trackName: track.name || `Video track ${index + 1}`, startUs: segment.target_timerange.start,
          durationUs: segment.target_timerange.duration }];
      }));
      projects.push({ id: prefix + entry.name, name, path,
        kind: marker?.kind === 'temporary-review' ? 'temporary-review' : prefix ? 'test-project' : 'project',
        hasTimelineContent: draft.tracks.some((track) => track.segments?.length), clips });
    } catch {
      signal?.throwIfAborted();
      discovery.unreadableProjects.push({ id: prefix + entry.name, name: entry.name,
        message: 'The saved timeline could not be read safely. Download its compatibility report for details.' });
    }
  }
  }
  return { projects, discovery };
}

export async function projectCompatibilityReport(projectId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const location = projectFolder(projectId);
  try {
    const folder = await containedPath(location.root, location.folder);
    const { stdout } = await promisify(execFile)(process.execPath,
      [join(process.cwd(), 'scripts/project-compatibility.mjs'), folder],
      { timeout: 30000, maxBuffer: 4_000_000, windowsHide: true, signal });
    return JSON.parse(stdout);
  } catch {
    signal?.throwIfAborted();
    throw new Error('Could not collect the compatibility report. Check project access and local tool setup, then try again.');
  }
}

export async function readProjectDraft(projectId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const location = projectFolder(projectId);
  const folder = await containedPath(location.root, location.folder);
  // Read the same canonical document/envelope as candidate editing and commits.
  // Preferring draft_content.json here can read an obsolete storage mirror.
  let stdout: string;
  try { ({ stdout } = await promisify(execFile)(process.execPath,
    [join(process.cwd(), "scripts/capcut-draft.mjs"), "snapshot", folder],
    { timeout: 30000, maxBuffer: 30_000_000, windowsHide: true, signal })); }
  catch (error) {
    signal?.throwIfAborted();
    const stderr = String((error as { stderr?: string }).stderr || "");
    const reason = stderr.match(/^Error: refused \[active-timeline-[a-z-]+\]: ([^\r\n]+)/m)?.[1];
    throw new Error(reason || "The CapCut project has no unambiguous readable timeline. Save it in CapCut and refresh projects.");
  }
  const selected = JSON.parse(stdout) as { file: string; raw: string; draft: ProjectDraft };
  const path = selected.file;
  await containedPath(folder, path);
  const raw = selected.raw;
  if (typeof raw !== "string") throw new Error("The canonical timeline snapshot is incomplete. Refresh projects.");
  const draft = selected.draft;
  if (!Array.isArray(draft.tracks)) throw new Error("Unsupported CapCut draft format.");
  return { folder, path, raw, draft };
}

export async function createLocalProject() {
  await mkdir(localProjects, { recursive: true });
  const name = `AI Editor test ${randomUUID().slice(0, 8)}`;
  await promisify(execFile)(process.execPath,
    [join(process.cwd(), "scripts", "create-local-project.mjs"), name],
    { cwd: process.cwd(), timeout: 30000, windowsHide: true });
  const project = (await listProjects()).find(item => item.name === name || item.id === `local:${name}`);
  if (!project) throw new Error("The test project was created but could not be read. Check draft compatibility.");
  return { projectId: project.id };
}

export async function resolveTimelineClip(projectId: string, clipId: string, signal?: AbortSignal) {
  const loaded = await readProjectDraft(projectId, signal);
  const matches = loaded.draft.tracks.flatMap(track => track.type === "video"
    ? (track.segments || []).filter(segment => segment.id === clipId).map(segment => ({ track, segment })) : []);
  if (matches.length > 1) throw new Error("The selected clip ID is ambiguous in this timeline. Save the project in CapCut and refresh.");
  const { track, segment } = matches[0] || {};
  const materials = (loaded.draft.materials?.videos || []).filter(item => item.id === segment?.material_id);
  if (materials.length > 1) throw new Error("Duplicate material IDs make the selected clip's source ambiguous. Relink this clip in CapCut and save the project.");
  const material = materials[0];
  if (!segment || !material?.path) throw new Error("The selected timeline clip was not found. Refresh projects.");
  const speeds = (loaded.draft.materials?.speeds || []).filter(item => segment.extra_material_refs?.includes(item.id));
  if (speeds.length > 1) throw new Error("The selected clip's native speed records are ambiguous. Save the project in CapCut and refresh.");
  const path = resolve(loaded.folder, material.path.replace(/##_draftpath_placeholder_[^#]+_##/g, loaded.folder));
  if (!existsSync(path)) throw new Error("The selected clip's media is missing from disk. Relink it in CapCut first.");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const document = relative(loaded.folder, loaded.path).split(sep);
  const mapping = { document: basename(loaded.path), scope: document[0] === "Timelines" ? "active" : "root",
    timelineIdHash: document[0] === "Timelines" ? hash(document[1]) : undefined,
    draftSha256: hash(loaded.raw), clipIdHash: hash(segment.id), materialIdHash: hash(material.id),
    trackIdHash: typeof track.id === "string" ? hash(track.id) : undefined, sourcePathHash: hash(path) };
  return { ...loaded, segment, material, mediaPath: path, mapping, companionSpeed: speeds[0]?.speed };
}

export async function openCapCutProject(projectId: string) {
  void projectId;
  throw new Error('AI-Editor does not open or close CapCut. Open the project yourself when you are ready.');
}
