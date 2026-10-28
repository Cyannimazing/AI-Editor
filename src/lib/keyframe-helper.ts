import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { platformPaths } from "../server/platform/runtime.mjs";
import { containedPath } from "../server/security/paths";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

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
  tracks: { name?: string; type: string; segments: Segment[] }[];
  materials?: { videos?: VideoMaterial[]; speeds?: { id: string; curve_speed?: unknown }[] };
};
export type ClipSummary = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
export type ProjectSummary = { id: string; name: string; path: string; hasTimelineContent: boolean; clips: ClipSummary[] };

function projectFolder(id: string) {
  const local = id.startsWith("local:");
  const name = local ? id.slice(6) : id;
  if (!name || name === "." || name === ".." || /[\\/\0:]/.test(name)) throw new Error("Invalid project name.");
  return { root: local ? localProjects : draftsRoot, folder: join(local ? localProjects : draftsRoot, name) };
}

export async function listProjects(includeLocal = true): Promise<ProjectSummary[]> {
  const projects: ProjectSummary[] = [];
  for (const [root, prefix] of [[draftsRoot, ""], [localProjects, "local:"]] as const) {
  if (prefix && !includeLocal) continue;
  const folders = existsSync(/* turbopackIgnore: true */ root) ? await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true }) : [];
  for (const entry of folders.filter((item) => item.isDirectory())) {
    try {
      const { folder: path, draft } = await readProjectDraft(prefix + entry.name);
      // Review fixtures are not editing destinations. Do not infer ownership
      // from a user's project name; only our explicit marker hides a copy.
      if (!includeLocal) {
        const marker = await readFile(join(path, '.ai-editor-review.json'), 'utf8').then(JSON.parse).catch(() => null);
        if (marker?.kind === 'temporary-review') continue;
      }
      if (!Array.isArray(draft.tracks)) continue;
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
      projects.push({ id: prefix + entry.name, name, path, hasTimelineContent: draft.tracks.some((track) => track.segments?.length), clips });
    } catch { continue; }
  }
  }
  return projects;
}

export async function readProjectDraft(projectId: string) {
  const location = projectFolder(projectId);
  const folder = await containedPath(location.root, location.folder);
  let path = join(folder, existsSync(join(folder, "draft_content.json")) ? "draft_content.json" : "draft_info.json");
  const pointer = join(folder, "Timelines", "project.json");
  if (existsSync(pointer)) {
    const selection = JSON.parse(await readFile(pointer, "utf8")) as { main_timeline_id?: string; timelines?: { id: string; is_marked_delete?: boolean }[] };
    const id = selection.main_timeline_id;
    if (!id || /[\\/\0]/.test(id) || !selection.timelines?.some((timeline) => timeline.id === id && !timeline.is_marked_delete)) {
      throw new Error("The active CapCut timeline could not be identified.");
    }
    const activeFolder = await containedPath(folder, join(folder, "Timelines", id));
    const active = join(activeFolder, existsSync(join(activeFolder, "draft_content.json")) ? "draft_content.json" : "draft_info.json");
    if (!existsSync(active)) throw new Error("The active CapCut timeline file is missing.");
    path = active;
  }
  await containedPath(folder, path);
  const raw = await readFile(path, "utf8");
  const draft = JSON.parse(raw) as ProjectDraft;
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

export async function resolveTimelineClip(projectId: string, clipId: string) {
  const loaded = await readProjectDraft(projectId);
  const track = loaded.draft.tracks.find((item) => item.type === "video" && item.segments?.some((segment) => segment.id === clipId));
  const segment = track?.segments.find((item) => item.id === clipId);
  const material = loaded.draft.materials?.videos?.find((item) => item.id === segment?.material_id);
  if (!segment || !material?.path) throw new Error("The selected timeline clip was not found. Refresh projects.");
  const path = resolve(loaded.folder, material.path.replace(/##_draftpath_placeholder_[^#]+_##/g, loaded.folder));
  if (!existsSync(path)) throw new Error("The selected clip's media is missing from disk. Relink it in CapCut first.");
  return { ...loaded, segment, material, mediaPath: path };
}

export async function openCapCutProject(projectId: string) {
  const project = (await listProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Selected CapCut project was not found.");
  await promisify(execFile)(process.execPath, [join(process.cwd(), "scripts", "capcut-session.mjs"), "open", project.path], { timeout: 45000, windowsHide: true });
  return { projectName: project.name };
}
