import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const draftsRoot = join(localAppData, "CapCut", "User Data", "Projects", "com.lveditor.draft");

export type ProjectSummary = { id: string; name: string; path: string; clips: { id: string }[] };

function projectFolder(id: string) {
  if (!id || id === "." || id === ".." || /[\\/\0]/.test(id)) throw new Error("Invalid project name.");
  return join(draftsRoot, id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const folders = existsSync(draftsRoot) ? await readdir(draftsRoot, { withFileTypes: true }) : [];
  const projects: ProjectSummary[] = [];
  for (const entry of folders.filter((item) => item.isDirectory())) {
    try {
      const path = projectFolder(entry.name);
      const draft = JSON.parse(await readFile(join(path, "draft_content.json"), "utf8")) as {
        name?: string; tracks?: { segments?: { id?: string }[] }[];
      };
      if (!Array.isArray(draft.tracks)) continue;
      let name = draft.name || entry.name;
      try {
        const metadata = JSON.parse(await readFile(join(path, "draft_meta_info.json"), "utf8")) as { draft_name?: string };
        if (metadata.draft_name) name = metadata.draft_name;
      } catch { name = draft.name || entry.name; }
      const clips = draft.tracks.flatMap((track) => track.segments ?? []).flatMap((segment) => segment.id ? [{ id: segment.id }] : []);
      projects.push({ id: entry.name, name, path, clips });
    } catch { continue; }
  }
  return projects;
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
