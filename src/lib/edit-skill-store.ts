import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export async function snapshotEditSkill(input: {
  id: string; name: string; prompt: string; referencePath: string; effects: string[]; sourceName: string; jobPath: string;
}, root = join(process.cwd(), ".local-tools")) {
  if (!/^[0-9a-f-]{36}$/.test(input.id)) throw new Error("Invalid skill ID.");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Enter a skill name up to 80 characters.");
  const buildDirectory = resolve(input.jobPath);
  const offset = relative(join(root, "native-assets"), buildDirectory);
  if (offset === ".." || offset.startsWith("../") || offset.startsWith("..\\") || isAbsolute(offset)) {
    throw new Error("The completed edit assets are outside the app's storage folder.");
  }
  const [planText, manifestText] = await Promise.all([
    readFile(join(buildDirectory, "spec.json"), "utf8"),
    readFile(join(buildDirectory, "manifest.json"), "utf8"),
    stat(input.referencePath),
  ]);
  const plan = JSON.parse(planText) as { workflowVersion?: number; model?: string; access?: string;
    source?: { path?: string }; tracks?: { items?: { path?: string }[] }[] };
  const manifest = JSON.parse(manifestText) as { supported?: boolean };
  const sourcePath = plan.source?.path ?? plan.tracks?.[0]?.items?.[0]?.path;
  if (!sourcePath || !manifest.supported) throw new Error("The completed edit has no reusable plan.");
  if ((plan.workflowVersion ?? 1) >= 2) {
    const review = JSON.parse(await readFile(join(buildDirectory, "review.json"), "utf8")) as { matched?: boolean; nativeOutput?: string };
    if (!review.matched || !["capcut-preview", "capcut-export"].includes(review.nativeOutput ?? "")) throw new Error("Only a natively reviewed edit can be saved as a skill.");
  }
  const folder = join(root, "skills", input.id);
  const skill = {
    id: input.id, name, prompt: input.prompt, referencePath: input.referencePath,
    effects: input.effects, sourceName: input.sourceName, createdAt: new Date().toISOString(),
    planPath: join(folder, "spec.json"), manifestPath: join(folder, "manifest.json"), buildDirectory, sourcePath,
    workflowVersion: plan.workflowVersion ?? 1, model: plan.model, access: plan.access,
  };
  await mkdir(folder, { recursive: true });
  await Promise.all([
    writeFile(skill.planPath, JSON.stringify(plan, null, 2), "utf8"),
    writeFile(skill.manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
    writeFile(join(folder, "skill.json"), JSON.stringify(skill, null, 2), "utf8"),
  ]);
  if ((plan.workflowVersion ?? 1) >= 2) {
    const sources = (await readdir(buildDirectory)).filter((name) =>
      /^(workflow\.md|reference-analysis\.json|loop-history\.json|review\.json|native-edit\.(mjs|ts)|prompt-(build|review)-\d+\.txt)$/.test(name));
    await Promise.all(sources.map((name) => cp(join(buildDirectory, name), join(folder, name))));
  }
  return skill;
}
