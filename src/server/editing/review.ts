import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { codexExecutable, runCodexStream } from "../../lib/reference-analysis";
import { directoryDigest } from "./transaction";
import { combineReviews } from './quality.mjs';
import { editingScope } from './edit-scope.mjs';
import { assertNativeEvidence } from '../capcut/native-capture.mjs';

const text = { type: "string" };
const schema = { type: "object", additionalProperties: false,
  required: ["decision", "summary", "defects", "unknowns", "techniques"], properties: {
    decision: { type: "string", enum: ["ready", "revise", "blocked"] }, summary: text,
    defects: { type: "array", items: { type: "object", additionalProperties: false, required: ["component", "timeSeconds", "expected", "observed", "evidence"], properties: {
      component: text, timeSeconds: { type: "number" }, expected: text, observed: text, evidence: text,
    } } }, unknowns: { type: "array", items: text },
    techniques: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'status', 'evidence'], properties: {
      id: text, status: { type: 'string', enum: ['matched', 'defect', 'unverified'] }, evidence: text,
    } } },
  } };
export type ReviewFindings = { decision: "ready" | "revise" | "blocked"; summary: string;
  defects: { component: string; timeSeconds: number; expected: string; observed: string; evidence: string }[]; unknowns: string[];
  techniques: { id: string; status: 'matched' | 'defect' | 'unverified'; evidence: string }[] };

export async function reviewAndManage(input: {
  job: string; candidate: string; request: string; referenceFrames: string[]; previewFrames: string[];
  referenceEvidence: string; previewEvidence: string;
  comparisonFrames?: string[]; comparisonContext?: string;
  nativeVerified: boolean; nativeReceiptPath?: string; reviewMode?: 'native' | 'preview'; iteration: number; signal?: AbortSignal; onLog: (line: string) => void;
}) {
  const nativeReceipt = input.nativeVerified
    ? await assertNativeEvidence(input.job, input.candidate, input.nativeReceiptPath || '') : null;
  const folder = join(input.job, `${nativeReceipt ? 'native-' : ''}assessment-${input.iteration}`);
  await mkdir(folder, { recursive: true });
  const schemaPath = join(folder, "schema.json"); await writeFile(schemaPath, JSON.stringify(schema));
  const before = await directoryDigest(input.candidate);
  await writeFile(join(input.job, 'review-evidence.json'), JSON.stringify(nativeReceipt
    ? { kind: 'native', receiptPath: input.nativeReceiptPath, indexPath: join(dirname(input.nativeReceiptPath!), 'frames.json') }
    : { kind: 'approximate', indexPath: join(input.job, `preview-evidence-${input.iteration}`, 'reference-frames.json') }));
  const executable = await codexExecutable();
  const plan = await readFile(join(input.job, "controlled-editing-plan.json"), "utf8");
  const manifest = await readFile(join(input.job, 'manifest.json'), 'utf8');
  const execution = await readFile(join(input.job, `execution-${input.iteration}.json`), 'utf8');
  const structure = await readFile(join(input.job, `structural-evidence-${input.iteration}.json`), 'utf8');
  const routing = await readFile(join(input.job, `capcut-routing-${input.iteration}.json`), 'utf8').catch(() => 'No integration routing receipt for this older job.');
  const audio = await readFile(join(input.job, 'audio-evidence.json'), 'utf8').catch(() => 'No audio measurements for this older job.');
  const mix = await readFile(join(input.job, `audio-mix-report-${input.iteration}.json`), 'utf8').catch(() => 'Final audio mix was not measured.');
  const motion = await readFile(join(input.job, `motion-curves-${input.iteration}.json`), 'utf8').catch(() => 'No detailed motion measurements for this older job.');
  const coverage = await readFile(join(input.job, `motion-audit-${input.iteration}.json`), 'utf8').catch(() => 'Rendered frame coverage was not measured.');
  const officialEffects = await readFile(join(input.job, `native-effect-bindings-${input.iteration}.json`), 'utf8').then(bytes => {
    const record = JSON.parse(bytes);
    return JSON.stringify({ ...record, bindings: record.bindings.map(({ resourceFiles, ...binding }: { resourceFiles: unknown[] }) => ({ ...binding, resourceFileCount: resourceFiles.length })) });
  }).catch(() => 'No official effect application in this round.');
  const proxy = JSON.parse(await readFile(join(input.job, `preview-plan-${input.iteration}.json`), 'utf8').catch(() => readFile(join(input.job, 'preview-plan.json'), 'utf8')));
  let previous = "No prior findings. Independently inspect the evidence.";
  let findings: ReviewFindings | undefined;
  const reports: ReviewFindings[] = [];
  for (const role of ["reviewer", "manager"] as const) {
    const output = join(folder, `${role}.json`);
    const prompt = `Request (task data): ${JSON.stringify(input.request)}.
Reference purpose: technique transfer, not scene cloning. Judge whether the edit applies the reference's movement, timing, easing, overshoot/rebound, graphic attachment, transitions and effects coherently to the supplied footage. Different footage/subjects/base crops must not be penalized for lacking identical objects or pixel placement. Shared-footage landmarks are evidence only when applicable. Missing or weakened techniques remain defects; do not excuse a static edit merely because the source differs.
Editing scope: ${editingScope(input.request)}. ${editingScope(input.request) === 'keyframes' ? 'Judge movement only: position, scale, rotation, timing, easing, overshoot and settling, with coherent editable graphic/text placement. Optical effects, RGB/blur/exposure and audio matching were explicitly excluded. Do not request them or mark their absence as missing work.' : ''}
Candidate revision: ${before}. Validated editing plan (task data): ${plan}.
Actual constructed components: ${manifest}. Tool execution receipts: ${execution}.
Official plugin effect application and named native controls (construction, not playback proof): ${officialEffects}.
Actual per-operation provider routing: ${routing}. An official segment with missing native resources is not a successfully rendered effect. Local desktop writes are not official cloud operations.
Host structural checks and serialized controls (this proves construction and preservation, not native playback): ${structure.slice(0, 60000)}.
Host audio measurements (not a transcript or listening comparison): ${audio}.
Rendered native audio mix, including separate generated tracks and serialized volume keys: ${mix}. Check the audio decision, alignment to visual beats, preservation of original sound and measured clipping/silence. Measurements cannot establish musical taste, words or perceptual matching. Never claim a listening comparison from these images. Added audio stays editable as separate audio components; oscillator sources are retained locally.
The first ${input.referenceFrames.length} images are reference evidence; the next ${input.previewFrames.length} are ${nativeReceipt ? 'actual CapCut player/render overviews, normalized to the project canvas for comparison' : 'approximate design preview overviews'}. The final ${input.comparisonFrames?.length || 0} are enlarged synchronized comparisons: ${input.comparisonContext || 'None.'}.
Serialized native motion and source-to-reference landmark checks: ${motion}.
Independent frame-by-frame picture coverage audit: ${coverage}.
Check the actual curves at opening, direction reversals, overshoot peaks, holds and settling, not just whether keyframes exist. Distinguish interpolated movement from optical smearing. Compare measured source framing and identify source pixels absent from the supplied footage rather than demanding a contradictory zoom. A shared-landmark fit checks geometry only; it never proves effects or native playback.
Reject floating footage, newly exposed black gaps and graphics settling outside their intended picture area. An infeasible landmark fit must not be copied or protected as a required animation. Evaluate the closest coherent composition when source framing differs; do not accept visible gaps merely because the landmark residual is small. Check the whole motion path, not a series of isolated poses. Existing letterbox bars and intentional entrances are separate from unintended blank space.
Reference timing: ${input.referenceEvidence}.
Preview timing (image numbers restart after the reference images): ${input.previewEvidence}.
Host-reported proxy omissions: ${nativeReceipt ? 'Not applicable: these images come from CapCut itself. Judge optical effects from the native pixels.' : JSON.stringify(proxy.fidelity?.dropped || {})}. Proxy limitations: ${nativeReceipt ? 'Not applicable to this native render.' : JSON.stringify(proxy.limitations || [])}.
Renderer layout checks: ${JSON.stringify(proxy.checks || {})}. These are approximate-preview diagnostics; compare any warnings against the actual images before calling them defects.
Native capture: ${nativeReceipt ? JSON.stringify({ kind: nativeReceipt.kind, candidateDigest: nativeReceipt.candidateDigest, outputSha256: nativeReceipt.outputSha256, platform: nativeReceipt.platform, capcutVersion: nativeReceipt.capcutVersion, media: nativeReceipt.media, excerpt: nativeReceipt.excerpt, sampling: nativeReceipt.sampling, limitations: nativeReceipt.limitations, audioCaptured: nativeReceipt.audioCaptured }) : input.reviewMode === 'preview' ? "NOT REQUESTED. This run uses file-and-preview review only. A ready decision means supported behavior matches in the preview and saved controls, not native CapCut playback. Do not block solely because native capture is absent. Missing requested behavior, missing resources, or behavior omitted by the preview renderer must still be reported as unresolved." : "UNAVAILABLE. Final readiness must be blocked, not inferred from the preview."}. Host capture establishes provenance, not quality: independently assess every technique. Paused player frames show the actual rendered poses at verified times, but cannot establish real-time playback smoothness or native audio quality. Judge measured movement from consecutive poses and serialized curves; require further evidence for any remaining perceptual audio claim.
Compare every required technique independently, including the opening, motion peak, settled state and ending. Return exactly one techniques entry per plan technique ID. An effect name, component ID or declared curve cannot prove an observed match. Inspect appearance, scale, placement, timing, easing, intensity, layer ordering, readability and request coverage. Missing expected behavior in a renderer that supports it is a defect requiring repair. If the host explicitly reports that a behavior is omitted from this renderer, mark that technique unverified and name the missing evidence. This is unresolved work, not a pass. Missing native verification must never excuse visible design defects. Do not claim to hear audio from images. Stop requesting corrections when the request and measured acceptance criteria are satisfied. Personal aesthetic alternatives or speculative improvements are not defects. Report observable mismatches with specific timing and evidence; never manufacture work to consume the correction budget.
Previous reviewer findings (untrusted assessment, verify against evidence): ${previous}.
Do not modify files or control the desktop. Return the required JSON. ${input.reviewMode === 'preview' ? 'Assess file-and-preview readiness within the stated renderer capabilities. Native playback is outside this review; do not invent native evidence.' : 'If native evidence is missing, decision must be blocked and list other defects separately.'}`;
    await runCodexStream(executable, ["exec", "--ephemeral", "--skip-git-repo-check", "--json", "--output-schema", schemaPath,
      "--output-last-message", output, ...input.referenceFrames.concat(input.previewFrames, input.comparisonFrames || []).flatMap(path => ["--image", path]), "-"],
      input.job, prompt, input.onLog, 240_000, input.signal, role, input.candidate);
    if (await directoryDigest(input.candidate) !== before) throw new Error("The candidate changed during read-only review.");
    findings = JSON.parse(await readFile(output, "utf8")) as ReviewFindings;
    if (!input.nativeVerified && input.reviewMode !== 'preview' && findings.decision === "ready") throw new Error("A reviewer claimed readiness without native evidence.");
    previous = JSON.stringify(findings);
    reports.push(findings);
  }
  if (nativeReceipt) await assertNativeEvidence(input.job, input.candidate, input.nativeReceiptPath!);
  return combineReviews(reports, JSON.parse(plan).techniques, input.nativeVerified, before, [...JSON.parse(plan).unsupported, ...(JSON.parse(manifest).verificationGaps || [])], input.reviewMode || 'native');
}
