import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectPlanSchema, validateProjectPlan } from './project-scope.mjs';
import { codexExecutable, runCodexStream } from '../../lib/reference-analysis';
import type { ProjectSummary, ProjectDraft } from '../../lib/keyframe-helper';

export async function planProjectEdit(input: { job: string; project: ProjectSummary; draft: ProjectDraft; clipIds: string[];
  prompt: string; referenceDescription: string; onLog: (line: string) => void; signal?: AbortSignal }) {
  const schema = join(input.job, 'project-plan-schema.json'), output = join(input.job, 'project-plan.json');
  await writeFile(schema, JSON.stringify(projectPlanSchema));
  const inventory = input.project.clips.map(clip => ({ ...clip, editable: input.clipIds.includes(clip.id) }));
  const layers = input.draft.tracks.map(track => ({ name: track.name, type: track.type, segments: track.segments.map(segment => ({
    id: segment.id, startUs: segment.target_timerange.start, durationUs: segment.target_timerange.duration,
  })) }));
  input.onLog(`Planning changes in “${input.project.name}” across ${input.clipIds.length} eligible clips.`);
  await runCodexStream(await codexExecutable(), ['exec', '--ephemeral', '--skip-git-repo-check', '--json', '--output-schema', schema, '--output-last-message', output, '-'],
    input.job, `Plan the selected active timeline. This is routing, not editing or quality assessment.
User request: ${JSON.stringify(input.prompt)}
Reference: ${input.referenceDescription}. The editors inspect its actual frames later; do not invent its contents now.
Project inventory: ${JSON.stringify(inventory)}
Existing layer inventory (preserve; not permission to edit unselected layers): ${JSON.stringify(layers)}
Return one decision for each allowed ID: ${JSON.stringify(input.clipIds)}. Use edit only where the prompt requires a change, keep with a reason otherwise. Do not repeat an opening/ending instruction on every clip. Global instructions can apply to every eligible clip. Maintain consistency across assignments. Names alone do not establish visible subject identity; if the prompt cannot locate a requested subject, report that uncertainty in unsupported rather than guessing a match. Existing non-video components cannot be modified by this route. Clip order, duration, existing effects/text/audio and other layers must be preserved. New layers and native motion/effects are supported. Every omitted required operation must appear in unsupported. No costs, uploads, execution or claims of completion.`,
    input.onLog, 180000, input.signal, 'planner');
  const plan = validateProjectPlan(JSON.parse(await readFile(output, 'utf8')), input.clipIds);
  await writeFile(output, JSON.stringify(plan));
  return plan as { summary: string; clips: { clipId: string; action: 'edit' | 'keep'; instruction: string; reason: string }[]; unsupported: string[] };
}
