import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codexExecutable, runCodexStream } from '../../lib/reference-analysis';
import { specialistAssignments, specialistCacheKey, specialistFeedback, specialistPlanView, specialistSchema, validateSpecialistReport } from './scheduling.mjs';
import type { Role } from '../codex/roles';
import { recoverStructuredReport } from './report-recovery.mjs';

export async function consultSpecialists(input: {
  job: string; plan: Record<string, unknown>; context: string; feedback: string; images: string[]; iteration: number;
  previewFrames?: string[]; previewEvidence?: string;
  scope?: string;
  referenceVideo: boolean; request: string; hasAudio: boolean; onLog: (line: string) => void; signal?: AbortSignal;
}) {
  const roles = (specialistAssignments(input.plan, input) as Role[]).filter(role => input.scope !== 'keyframes' || role === 'motion');
  const folder = join(input.job, 'specialists'); await mkdir(folder, { recursive: true });
  const schemaPath = join(folder, 'schema.json'); await writeFile(schemaPath, JSON.stringify(specialistSchema));
  const reports = [];
  for (const role of roles) {
    input.signal?.throwIfAborted();
    const previewFrames = role === 'audio' ? [] : input.previewFrames || [];
    const visualContext = previewFrames.length ? `\nAfter the ${input.images.length} reference/source images, ${previewFrames.length} images show the previous candidate preview. Compare these actual pixels before proposing changes. Preview timing: ${input.previewEvidence}.` : '';
    const fingerprint = specialistCacheKey(role, input.plan, input.context + visualContext, input.feedback);
    const output = join(folder, `${role}-${fingerprint}.json`);
    let report, reused = false;
    try { report = validateSpecialistReport(JSON.parse(await readFile(output, 'utf8')), input.plan); reused = true; }
    catch {
      input.onLog(`${role} specialist: measuring the proposed edit and specifying concrete corrections.`);
      const prompt = `${input.context}${visualContext}\nAssigned responsibility: ${role}. You are an independent specialist, not the timeline writer.
Relevant proposed components: ${JSON.stringify(specialistPlanView(role, input.plan))}
Allowed technique IDs: ${JSON.stringify((input.plan.techniques as { id: string }[]).map(technique => technique.id))}. Return findings=[] when no demonstrated problem applies. This is a pre-build consultation: a final mix/render report may not exist yet; the controller creates it after integration. Its absence at this stage is not an implementation defect to fix by rewriting the plan.
This is a role-specific view, not a complete editing plan. To check the current complete plan, call evaluate_keyframes with planJson="". Never construct a partial plan from this view. On INVALID_EDIT_PLAN, read the exact missing/extra fields, repair the complete input and retry within the tool budget; stop repeating identical errors. A successful tool retry does not prove final edit quality.
Prior relevant quality findings: ${specialistFeedback(role, input.feedback)}
Check the requested techniques against the timed evidence in your specialty. Return precise numerical timings, keyframes, positions, sizes, resource choices and asset geometry where needed. Identify missing methods as required findings rather than dismissing them. Do not claim installed tools ran. A declared keyframe is not observed motion. Each finding must reference an existing technique ID. The lead editor will integrate your proposal. Do not add unrelated features. Do not invent speech or claim to hear audio from images; analysis measurements establish levels, not semantic matching.
Return only the specialist JSON contract.`;
      report = await recoverStructuredReport({ signal: input.signal, validate: (value: unknown) => validateSpecialistReport(value, input.plan),
        onRetry: () => input.onLog(`${role} specialist: repairing its report format; keeping the current candidate.`),
        generate: async (correction: string) => {
          await runCodexStream(await codexExecutable(), ['exec', '--ephemeral', '--skip-git-repo-check', '--json', '--output-schema', schemaPath,
            '--output-last-message', output, ...input.images.concat(previewFrames).flatMap(path => ['--image', path]), '-'], input.job, `${prompt}\n${correction}`, input.onLog, 240000, input.signal, role);
          return readFile(output, 'utf8');
        } });
    }
    if (reused) input.onLog(`${role} specialist: reusing the assessment; its inputs and relevant evidence are unchanged.`);
    reports.push({ role, fingerprint, reused, ...report });
    await writeFile(join(folder, `round-${input.iteration}.json`), JSON.stringify({ completed: reports.map(item => item.role), planned: roles, reports }));
  }
  return reports;
}
