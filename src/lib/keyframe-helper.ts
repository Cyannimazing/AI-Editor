import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const draftsRoot = join(localAppData, "CapCut", "User Data", "Projects", "com.lveditor.draft");

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
  if (!id || id === "." || id === ".." || /[\\/\0]/.test(id)) throw new Error("Invalid project name.");
  return join(draftsRoot, id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const folders = existsSync(draftsRoot) ? await readdir(draftsRoot, { withFileTypes: true }) : [];
  const projects: ProjectSummary[] = [];
  for (const entry of folders.filter((item) => item.isDirectory())) {
    try {
      const { folder: path, draft } = await readProjectDraft(entry.name);
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
      projects.push({ id: entry.name, name, path, hasTimelineContent: draft.tracks.some((track) => track.segments?.length), clips });
    } catch { continue; }
  }
  return projects;
}

export async function readProjectDraft(projectId: string) {
  const folder = projectFolder(projectId);
  let path = join(folder, "draft_content.json");
  const pointer = join(folder, "Timelines", "project.json");
  if (existsSync(pointer)) {
    const selection = JSON.parse(await readFile(pointer, "utf8")) as { main_timeline_id?: string; timelines?: { id: string; is_marked_delete?: boolean }[] };
    const id = selection.main_timeline_id;
    if (!id || /[\\/\0]/.test(id) || !selection.timelines?.some((timeline) => timeline.id === id && !timeline.is_marked_delete)) {
      throw new Error("The active CapCut timeline could not be identified.");
    }
    const active = join(folder, "Timelines", id, "draft_content.json");
    if (!existsSync(active)) throw new Error("The active CapCut timeline file is missing.");
    path = active;
  }
  const raw = await readFile(path, "utf8");
  const draft = JSON.parse(raw) as ProjectDraft;
  if (!Array.isArray(draft.tracks)) throw new Error("Unsupported CapCut draft format.");
  return { folder, path, raw, draft };
}

export async function resolveTimelineClip(projectId: string, clipId: string) {
  const loaded = await readProjectDraft(projectId);
  const track = loaded.draft.tracks.find((item) => item.type === "video" && item.segments?.some((segment) => segment.id === clipId));
  const segment = track?.segments.find((item) => item.id === clipId);
  const material = loaded.draft.materials?.videos?.find((item) => item.id === segment?.material_id);
  if (!segment || !material?.path) throw new Error("The selected timeline clip was not found. Refresh projects.");
  const path = resolve(loaded.folder, material.path);
  if (!existsSync(path)) throw new Error("The selected clip's media is missing from disk. Relink it in CapCut first.");
  return { ...loaded, segment, material, mediaPath: path };
}

export async function openCapCutProject(projectId: string) {
  const project = (await listProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Selected CapCut project was not found.");
  const executable = join(localAppData, "CapCut", "Apps", "CapCut.exe");
  if (!existsSync(executable)) throw new Error("CapCut is not installed at its usual Windows location.");
  const child = spawn(executable, [join(project.path, "draft_content.json")], { detached: true, stdio: "ignore", windowsHide: false });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return { projectName: project.name };
}
