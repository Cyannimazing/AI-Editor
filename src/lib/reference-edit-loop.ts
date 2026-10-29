import { reviewAndManage } from "../server/editing/review";
import { referenceFrames as inspectPreview } from "./reference-media";
import { createEditingPlan } from "../server/editing/plan";
import { soundDesignPlanSchema, validateControlledPlan } from "../server/editing/controlled-plan.mjs";
import { editorPlanResultSchema, resolveEditorPlanResult } from '../server/editing/editor-plan-result.mjs';
import { includeAudioDefects } from '../server/editing/audio-mix.mjs';
import { consultSpecialists } from '../server/editing/specialists';
import { measureJobAudio } from '../server/editing/audio-evidence';
import { measureReferenceMotion, motionEvidenceContext, buildMotionComparisons, auditMotionFrames } from '../server/editing/motion-evidence.mjs';
import { guardSourceMotion, motionCurveReport, plannedMotionDefects } from '../server/editing/motion-comparison.mjs';
import { includeMotionDefects } from '../server/editing/motion-coverage.mjs';
import { editingScope, assertEditingScope } from '../server/editing/edit-scope.mjs';
import { availableTextFonts } from '../server/editing/text-fonts.mjs';
import { retainTechniqueContract, combineReviews, qualityAction, needsDesignReview, requireAudioEvidence } from '../server/editing/quality.mjs';
import { toolKnowledge } from "../server/setup/tool-knowledge";
import { capcutPluginStatus, searchCapcutMaterials } from "../server/capcut/plugin";
import { discoverOfficialEffects, officialEffectContext, applyOfficialEffects } from '../server/capcut/effect-application';
import { localEffectBuilder } from '../server/capcut/local-builder.mjs';
import { integrationCapabilities, effectRoutingReceipt } from '../server/capcut/integration-policy.mjs';
import { referenceEvidenceContext } from "../server/editing/reference-context.mjs";
import { editingFailureMessage, requiresHostAttention } from "../server/editing/errors.mjs";
import { captureFailureDiagnostic } from '../server/editing/diagnostics.mjs';
import { nativeReviewCapability } from "../server/capcut/review";
import { captureNativePreview } from "../server/capcut/native-preview.mjs";
import { assertNoLinks, containedPath } from "../server/security/paths";
import { directoryDigest } from "../server/editing/transaction";
import { runCancellableProcess } from "./cancellable-process";
import { execFile } from "node:child_process";
import { copyFile, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { editingToolContext } from "./editing-context";
import { codexExecutable, editingAgent, runCodexStream } from "./reference-analysis";
import { validateNativeCandidate } from "./native-edit-validation";
import type { NativeDraft, NativeManifest, ReferenceAnalysis } from "./native-edit-validation";

const run = promisify(execFile);
const workspace = process.cwd();
const draftHelper = join(workspace, "scripts", "capcut-draft.mjs");
const sessionHelper = join(workspace, "scripts", "capcut-session.mjs");
const cli = join(workspace, "toolchain", "node_modules", "capcut-cli", "dist", "index.js");
export async function capcutSession(action: "close" | "open", project?: string, signal?: AbortSignal) {
  await run(process.execPath, [sessionHelper, action, ...(project ? [project] : [])], { cwd: workspace, timeout: 45000, signal, windowsHide: true });
}

export async function nativeDigest(project: string) {
  return (await run(process.execPath, [draftHelper, "digest", project], { cwd: workspace, timeout: 30000 })).stdout.trim();
}

export async function readNativeDraft(project: string) {
  const { stdout } = await run(process.execPath, [draftHelper, "active", project], { cwd: workspace, timeout: 30000, maxBuffer: 30_000_000 });
  return JSON.parse(stdout) as { file: string; draft: NativeDraft };
}

export async function commitNativeCandidate(candidate: string, destination: string) {
  await run(process.execPath, [draftHelper, "commit", candidate, destination], { cwd: workspace, timeout: 120000, maxBuffer: 2_000_000 });
}

export async function runReferenceEditLoop(input: {
  job: string; candidate: string; original: NativeDraft; source: string; width: number; height: number;
  duration: number; start: number; clipId?: string; originalSource?: string; sourceHasAudio?: boolean; prompt: string;
  reference: { path: string; frames: string[]; indexPath?: string; duration?: number; hasAudio?: boolean };
  targetFrames: string[]; targetEvidence?: string; savedPlan?: string; savedBuildDirectory?: string; savedSourcePath?: string;
  framing?: { policy: string; preparation?: unknown };
  onLog: (line: string) => void; signal?: AbortSignal; assertOriginalUnchanged: () => Promise<void>;
  onPreview?: () => Promise<void>;
}) {
  const { job, candidate, reference, onLog, signal } = input;
  const scope = editingScope(input.prompt);
  const budget = Number(process.env.AI_EDITOR_MAX_ITERATIONS ?? 4);
  if (!Number.isInteger(budget) || budget < 1 || budget > 4) throw new Error("Use one initial build and at most three correction rounds.");
  const executable = await codexExecutable();
  const schemaPath = join(job, "controlled-plan-schema.json");
  const editorResultSchemaPath = join(job, 'editor-result-schema.json');
  const readJobPlanFile = async (path: string) => {
    await containedPath(job, path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw new Error('Invalid editor plan result file.');
    return readFile(path, 'utf8');
  };
  const resolveEditorResult = async (path: string) => resolveEditorPlanResult(JSON.parse(await readJobPlanFile(path)),
    () => readJobPlanFile(join(job, 'mcp-applied-plan.json')));
  const workflow = await readFile(join(workspace, "ai", "contract.md"), "utf8");
  const referenceIndex = reference.indexPath ? JSON.parse(await readFile(reference.indexPath, "utf8")) : undefined;
  const sourceIndex = input.targetEvidence ? JSON.parse(input.targetEvidence) : undefined;
  const referenceEvidence = referenceEvidenceContext(reference, referenceIndex);
  const knowledge = await toolKnowledge();
  const plugin = await capcutPluginStatus().catch(() => ({ authorization: "unavailable", capabilities: { materialSearch: false } }));
  const integration = integrationCapabilities({ materialSearch: plugin.capabilities.materialSearch, localBuilder: localEffectBuilder().available });
  await writeFile(join(job, 'capcut-integration.json'), JSON.stringify(integration));
  onLog(`CapCut integration: ${integration.discovery === 'official-capcut-plugin' ? 'official plugin discovery, local builder and desktop adapter' : 'local catalog; official material search is unavailable'}. No automatic export.`);
  const effectCatalog = [...(knowledge.capcut.catalogs.scene_effects || []), ...(knowledge.capcut.catalogs.character_effects || [])]
    .filter(entry => (entry as { is_vip?: boolean }).is_vip === false) as Parameters<typeof discoverOfficialEffects>[0]['catalog'];
  const nativeEffects = scope === 'keyframes' ? [] : effectCatalog.map(entry => entry.slug);
  const officialResults = new Map<string, unknown>();
  const attemptedAcquisitions = new Set<string>();
  const audioEvidence = await measureJobAudio(job, [
    { name: 'source', path: input.source, hasAudio: Boolean(input.sourceHasAudio) },
    { name: 'reference', path: reference.path, hasAudio: Boolean(reference.hasAudio) },
  ], signal);
  await Promise.all([
    writeFile(schemaPath, JSON.stringify(soundDesignPlanSchema)),
    writeFile(editorResultSchemaPath, JSON.stringify(editorPlanResultSchema)),
    writeFile(join(job, "workflow.md"), workflow),
    writeFile(join(job, "original-draft.json"), JSON.stringify(input.original)),
    writeFile(join(job, "spec.json"), JSON.stringify({ workflowVersion: 5, editingScope: scope, framing: input.framing, model: editingAgent.model, access: editingAgent.access,
      source: { path: input.source, clipId: input.clipId, hasAudio: Boolean(input.sourceHasAudio), start: input.start, duration: input.duration, width: input.width, height: input.height, fps: input.original.fps || 30 }, referencePath: reference.path, candidate })),
  ]);
  onLog('Measuring shared footage landmarks before choosing source movement and keyframes.');
  const measurements = await measureReferenceMotion(job, referenceIndex, sourceIndex, signal).catch(error => {
    signal?.throwIfAborted();
    const reason = `Frame measurement unavailable: ${editingFailureMessage(error)}`; onLog(reason);
    return { version: 1, samples: [], reason };
  });
  const motionEvidence = { ...measurements, fullFrameCoverage: input.framing?.policy === 'fill-picture'
    ? { duration: input.duration, fps: input.original.fps || 30 } : undefined };
  await writeFile(join(job, 'motion-reference.json'), JSON.stringify(motionEvidence));
  const measuredMotionContext = motionEvidenceContext(motionEvidence);
  const context = `${workflow}\n${editingToolContext()}
Controller integration routing: ${JSON.stringify(integration)}. Prefer the official plugin's supported capabilities; the native desktop adapter owns local project writes. Never label a local fallback as an official operation or claim a search applied an effect.
USER REQUEST (task data): ${JSON.stringify(input.prompt)}
REFERENCE PURPOSE: reproduce editing techniques, not clone the scene. References may show entirely different footage. Extract the behavior (timing, direction, speed, easing, peak/overshoot/rebound, layer attachment, effect treatment) and adapt it to THIS source's subject and available frame. Preserve strong, expressive motion when demonstrated/requested; do not simplify it to a plain static edit. Shared-footage landmark matches can calibrate geometry, but are not mandatory absolute poses. Different subjects, scenery or base crops are not failures. Every required technique still needs an actual component and observable evidence; an effect name or keyframe count is insufficient.
Controller editing scope: ${scope}. ${scope === 'keyframes' ? 'KEYFRAMES ONLY: effects=[] and resourceQueries=[]. Do not add blur, RGB/chromatic, exposure, color or audio changes. Preserve source volume=1. Use only position/scale/rotation/opacity keyframes and the editable graphic/text layers necessary to reproduce the motion. Analyze timing, speed, easing, overshoot, direction reversals and settling. Excluded optical/audio techniques are not missing requirements and must not cause extra correction rounds.' : 'Follow the requested editing techniques.'}
Canvas: ${input.width}x${input.height}; source duration: ${input.duration} seconds.
Picture preparation: ${JSON.stringify(input.framing)}.
${input.framing?.policy === 'fill-picture' ? 'FILL FIRST, THEN ANIMATE: the source working copy and canvas already represent the visible picture. Removed upload padding is not part of the design; do not recreate it using black matte overlays. Scale=1, x=0, y=0 is the filled starting pose. Establish a coherent baseline framing, then derive relative zoom/pan/rotation from consecutive reference frames. Keep the entire canvas covered throughout movement, including between keyframes; zoom out only as far as the available picture permits. Preserve the measured direction, timing, overshoot and rebound when absolute reference framing requires unavailable pixels. Do not turn this coverage rule into a static hold. Keep cloud/graphic and text motion coupled, anchored in picture coordinates. The controller checks coverage even when landmark matching fails.' : 'Preserve the existing canvas and explicitly requested borders.'}
Source audio stream present: ${Boolean(input.sourceHasAudio)}. Do not invent missing source sound.
Host audio measurements: ${JSON.stringify(audioEvidence)}.
Host source-to-reference motion measurements: ${measuredMotionContext}.
A landmark correspondence is not a finished keyframe or an instruction to shrink the video. Check directlyApplicable, sourceBounds and referenceBounds before using it. Keep the reference's intended picture area filled during motion. Account for baked-in black bars separately from scene pixels. If an exact framing match needs unavailable pixels, choose and explain the closest coherent framing/compositing solution; do not deliberately ship floating footage or lock a defective zoom to the measurements. Do not copy sparse matches as a jittery linear path or hold the final match for the rest of the video without temporal evidence. Measure overlay and text movement relative to the visible picture, then convert to full-canvas coordinates. Reproduce intentional entrances/exits, but keep settled graphics attached to their intended subject/composition.
You receive ${reference.frames.length} reference images followed by ${input.targetFrames.length} source images. Use the job-bound local MCP tools to inspect individual timed frames, evaluate curves and construct the candidate. Return editing-plan v5 JSON as the final answer. Trusted tools perform all file writes.
Audio is an editorial choice: preserve existing sound when adding sound would distract, violate scope, or obscure speech. Otherwise compose original local SFX or a simple tonal/rhythmic music bed where it supports an identified beat. Explain the decision, not just a generic need for music. This engine has procedural sine/noise synthesis, not a song or speech generation model. No paid services, borrowed recordings, downloads or invented speech. Do not claim to hear images.
Every v5 plan includes audio={decision:'preserve'|'augment',rationale,assets:[],clips:[]}. Preserve requires empty lists; keyframes-only scope MUST preserve. For augment, each asset has id,duration,seed,layers. Layers have wave:'sine'|'noise',start,duration,frequency,endFrequency,gain,attack,release,pan. Compose notes/chords, noise sweeps or transient layers using precise timing; frequency sweeps are logarithmic. At most 12 assets (60s each, 180s total), 256 layers per asset (900 layer-seconds total). Frequencies 20..16000Hz, gain .001.. .8, pan -1..1, attack/release >=.002s and together <= layer duration. Avoid harsh tones and abrupt tails. Clips have assetId,role:'music'|'sfx',reason,start,duration,sourceStart,volume,keyframes. Volume and keys are 0..1; keys use property:'volume',time,value,easing. Key times are local to the audio clip. Assets must be used; each clip fits its asset and the edited interval. Clips become independent native audio-N components with editable timing/gain/fade/duck keys. Preserve source audio by default, use restrained added levels and duck around existing sound; avoid loudness claims without measurements. Review the actual mix report for clipping/silence, and repair the added tracks before success.
Reference evidence and image-to-time mapping: ${referenceEvidence}
Source timing: ${input.targetEvidence ? referenceEvidenceContext({ frames: input.targetFrames }, JSON.parse(input.targetEvidence)) : JSON.stringify([0, 1, 2].map(index => Math.max(0, Math.min(input.duration - 0.04, input.duration * index / 2))))}. Distinguish actual subject movement from digital editing; a freeze layer requires evidence that the reference deliberately holds a frame.
Build the actual edit using native text, layers, effects, keyframes, blend modes and generated vector assets. Compose these primitives for the measured technique, not a fixed template.
Available source keyframes: scale, x, y, rotation, opacity, volume, brightness, contrast, saturation. Brightness/contrast/saturation values range -1..1; all keyframes have explicit local seconds, value and easing.
assets: generate arbitrary decorative art or source-frame assets, up to 24. Every asset has id,kind,frameTime,svg,width,height. kind='svg': frameTime=0; author SVG geometry. kind='source-frame': svg=''; frameTime selects an actual source time for a still/freeze-frame layer, with retained extraction parameters. Use a full-frame image overlay for an editable hold/freeze while preserving underlying audio. SVG may use svg/g/path/rect/circle/ellipse/polygon/polyline/line/defs/linearGradient/radialGradient/stop, local gradients, fills/strokes and transforms. No scripts, external links, CSS, SVG text or embedded images. Use native texts for words. The host retains SVG and rasterizes a transparent PNG locally, so needing a graphic is a generation step, not an unsupported technique.
overlays: each has assetId (a generated asset ID or 'source' for a duplicate footage layer), start,duration,sourceStart,scale,x,y,rotation,opacity,volume,blendMode,keyframes. Array order is back to front regardless of start time: put background/hold footage before foreground graphics. Asset overlays use sourceStart=0 and volume=0. Duplicate source layers are muted. Blend modes: ${knowledge.capcut.blendModes.join(", ")}. Place decorative layers behind native text. Keep each layer inside the edited interval.
effects: each has a slug from this available no-cost native catalog, target ('source', 'overlay-N' or 'text-N', zero-based indexes), start,duration,intensity (0..1),params (numeric controls 0..100; [] uses defaults). Times are project-local within the selected interval; keep effects inside the target layer's interval. The host binds effects to that layer, preserving unrelated footage. Apply blur/directional smearing to a graphic layer with the suitable catalog effect when the reference requires it. Available slugs: ${JSON.stringify(nativeEffects)}.
Official CapCut material search: ${plugin.capabilities.materialSearch ? "connected and usable" : "not connected; use the installed native catalog and local generation"}. For each chosen native effect the host automatically searches the official plugin, selects an unambiguous resource and invokes its installed local application functions. You do not need to ask the user to search. The host bridges validated effect source/timing/controls into desktop native components; named controls are learned from the matching installed resource. resourceQueries: request up to 3 additional task-relevant {kind,query} searches when helpful. This does not upload footage or spend credits. Use actual discovered controls and never invent parameters. With no extra searches needed use [].
Coordinates: x/y range -2..2; 0 centers the object; x=1 means half-canvas right; y=1 means half-canvas up. Scale 1 is unchanged. Opacity 0..1. Volume 0..2.
Images are fitted inside the canvas BEFORE their native scale is applied. For an asset W by H, fit=min(canvasWidth/W,canvasHeight/H); rendered size is W*fit*scale by H*fit*scale. Position refers to the full image center, including transparent margins. Account for the geometry's offset inside the SVG when aligning native text or rotating layers together. Text uses actual canvas pixels, then its native scale; changing image scale does not resize separate text.
All times are local seconds from 0 to ${input.duration}. Text keyframe times are relative to that text's own start. Font size is desired final-canvas pixel size.
Text bold/italic are explicit native range styles; match the reference's visual weight rather than merely its wording. Preserve exact case and punctuation. They are editable native text, not raster text.
Select text.font only from installed local families: ${JSON.stringify(availableTextFonts().map(({ id, name }: { id: string; name: string }) => ({ id, name })))}. Match serif/sans-serif form and weight, and report any uncertain exact font identity. Font paths are supplied by the trusted host.
Provide full defaults: scale=1, x=0, y=0, rotation=0, opacity=1, volume=1, keyframes=[] when unchanged. Add at least one technique describing the actual requested change and its evidence.
Each technique MUST specify components (exact source, text-N, overlay-N or effect-N references), expectedBehavior (observable appearance and motion) and checks (timed acceptance criteria). Bind only components that actually implement that technique. IDs, names, expectedBehavior and checks must survive correction rounds; do not weaken or drop a requested technique to pass review.
Use keyframes for zoom/pan/entrances. Keep the original duration. Do not invent a transcript from silent frames; use exact supplied wording only.
Use [] for assets/overlays/effects when not needed. Use unsupported only for a genuinely unresolved REQUIRED technique after considering combinations of the available tools. Missing final native verification, audio listening evidence or exact font identity are review uncertainties to report in the summary, not reasons to abandon a build. Asset creation, optical effects in the supplied catalog and native keyframe motion are now executable build steps.
For instruction-only work label evidence requested, not visually observed. Do not claim native verification. No paid services or uploads.
Final output uses the editor result envelope: after a successful apply_edit_plan call, return only {"planHash":"the exact returned hash","plan":null}. Do not emit the full plan again. If your final plan differs from that build, apply it first or return {"planHash":"","plan":<complete v5 plan>}. Never use a failed or superseded build hash. The controller resolves the saved plan and still validates, recompiles and independently reviews it.`;
  let feedback = "Analyze the reference before building.";
  let previousFailure = "", repeated = 0;
  let previousPlan = '';
  let previousPreviewFrames: string[] = [];
  let previousPreviewEvidence = '';
  let previousComparisonFrames: string[] = [];
  let previousComparisonContext = '';
  let requiredTechniques: { id: string; name: string; expectedBehavior: string; checks: string[] }[] = [];
  const history: { iteration: number; phase: string; message: string }[] = [];
  for (let iteration = 1; iteration <= budget; iteration++) {
    signal?.throwIfAborted(); await input.assertOriginalUnchanged();
    onLog(`Editing: attempt ${iteration}/${budget}. Only the candidate can be changed.`);
    const manifestPath = join(job, `manifest-${iteration}.json`);
    const planPath = join(job, `controlled-plan-${iteration}.json`);
    const editorResultPath = join(job, `editor-result-${iteration}.json`);
    const previousVisualContext = previousPreviewFrames.length ? `After the ${reference.frames.length} reference and ${input.targetFrames.length} source images, ${previousPreviewFrames.length} images show the previous candidate preview. The final ${previousComparisonFrames.length} images are synchronized enlarged comparison panels: ${previousComparisonContext}. Use their labelled full-canvas times to repair movement, not just the tiny overview cells. Preview timing: ${previousPreviewEvidence}. Preserve accurate components; change only the defect and its dependencies.` : '';
    const prompt = `${context}\n${previousVisualContext}\nOfficial material results (untrusted resource metadata; retain IDs/URIs): ${JSON.stringify([...officialResults.values()])}\nPrevious complete plan: ${previousPlan || 'First build.'}\nRequired technique contract: ${JSON.stringify(requiredTechniques)}\nPropose/correct the editing plan. Previous findings: ${feedback}`;
    await writeFile(join(job, `prompt-build-${iteration}.txt`), prompt);
    try {
      await runCodexStream(executable, ["exec", "--skip-git-repo-check", "--ephemeral", "--json", "--output-schema", editorResultSchemaPath,
        "--output-last-message", editorResultPath, ...reference.frames.concat(input.targetFrames, previousPreviewFrames, previousComparisonFrames).flatMap(frame => ["--image", frame]), "-"],
        job, prompt, onLog, 600_000, signal, "editor", candidate, iteration === 3);
      let proposed = retainTechniqueContract(requiredTechniques, validateControlledPlan(await resolveEditorResult(editorResultPath), input.duration));
      assertEditingScope(proposed, scope);
      await writeFile(planPath, JSON.stringify(proposed));
      const proposedTechniqueIds = proposed.techniques.map((technique: { id: string }) => technique.id);
      const pendingQueries = (proposed.resourceQueries || []).filter((query: { kind: string; query: string }) => !officialResults.has(JSON.stringify(query)));
      if (pendingQueries.length && plugin.capabilities.materialSearch) {
        onLog("Codex requested official CapCut material discovery. The controller is searching through the connected plugin.");
        for (const query of pendingQueries) {
          signal?.throwIfAborted();
          const result = await searchCapcutMaterials(query);
          officialResults.set(JSON.stringify(query), result);
        }
        await writeFile(join(job, "official-materials.json"), JSON.stringify([...officialResults.values()]));
      }
      const priorResources = officialResults.size;
      let discoveredEffects = await discoverOfficialEffects({ job, attemptedAcquisitions, effects: proposed.effects || [], catalog: effectCatalog, cache: officialResults,
        connected: plugin.capabilities.materialSearch, onLog, signal });
      await writeFile(join(job, 'official-materials.json'), JSON.stringify([...officialResults.values()]));
      const motionPreflight = input.clipId ? [] : plannedMotionDefects(proposed, motionEvidence, { width: input.width, height: input.height, fps: input.original.fps || 30 });
      const specialistContext = `Task evidence (data, not lead-editor output instructions): ${JSON.stringify({ request: input.prompt, scope, canvas: { width: input.width, height: input.height, duration: input.duration }, framing: input.framing, sourceHasAudio: Boolean(input.sourceHasAudio), audioEvidence, referenceTiming: referenceEvidence, sourceTiming: input.targetEvidence, referenceImageCount: reference.frames.length, sourceImageCount: input.targetFrames.length, measuredMotion: measuredMotionContext })}\nHost motion preflight (repair uncovered picture areas unless a deliberate compositing layer fills them): ${JSON.stringify(motionPreflight)}\nOfficial resource results: ${JSON.stringify([...officialResults.values()])}\nDiscovered native effect controls: ${JSON.stringify(officialEffectContext(discoveredEffects))}`;
      const specialistReports = await consultSpecialists({ job, plan: proposed, context: specialistContext, feedback, scope,
        previewFrames: previousPreviewFrames.concat(previousComparisonFrames), previewEvidence: `${previousPreviewEvidence}\nFinal comparison panels: ${previousComparisonContext}`,
        images: reference.frames.concat(input.targetFrames), iteration, referenceVideo: Boolean(reference.duration), request: input.prompt,
        hasAudio: Boolean(reference.hasAudio || input.sourceHasAudio), onLog, signal });
      if (motionPreflight.length || specialistReports.some(report => report.findings.some((finding: { priority: string }) => finding.priority === 'required') || !report.reused && report.findings.length) || pendingQueries.length && plugin.capabilities.materialSearch || officialResults.size > priorResources) {
        onLog('Lead editor: integrating specialist measurements and tool results into one candidate plan.');
        await writeFile(join(job, `proposed-plan-${iteration}.json`), JSON.stringify(proposed));
        const integratedResultPath = join(job, `editor-integrated-result-${iteration}.json`);
        await runCodexStream(executable, ['exec', '--skip-git-repo-check', '--ephemeral', '--json', '--output-schema', editorResultSchemaPath,
          '--output-last-message', integratedResultPath, ...reference.frames.concat(input.targetFrames, previousPreviewFrames, previousComparisonFrames).flatMap(frame => ['--image', frame]), '-'], job,
          `${context}\n${specialistContext}\n${previousVisualContext}\nPrevious findings: ${feedback}\nRequired technique contract: ${JSON.stringify(requiredTechniques)}\nProposed plan: ${JSON.stringify(proposed)}\nSpecialist findings (independent proposals): ${JSON.stringify(specialistReports)}\nIntegrate required corrections into the complete v5 plan. Preserve components already matching the evidence. Keep every required technique. Use local MCP evidence/curve checks and apply_edit_plan, then return the hash envelope described above. Use the full-plan envelope only if the final plan could not be built.`,
          onLog, 360000, signal, 'editor', candidate);
        proposed = retainTechniqueContract(requiredTechniques, validateControlledPlan(await resolveEditorResult(integratedResultPath), input.duration));
        assertEditingScope(proposed, scope);
        if (proposedTechniqueIds.some((id: string) => !proposed.techniques.some((technique: { id: string }) => technique.id === id))) throw new Error('Specialist integration omitted a requested technique. Retain every technique ID.');
      }
      // Numeric guard applies to a reported source-framing repair in a fresh-canvas
      // edit. Existing-clip relative transforms remain subject to post-merge review.
      let sourceRepair = false;
      try { sourceRepair = JSON.parse(feedback).some((defect: { component: string; observed: string; expected: string }) => /\bsource\b/i.test(defect.component) && /fram|crop|scale|zoom|position|enlarg|smaller/i.test(`${defect.observed} ${defect.expected}`)); } catch { /* Initial/build failures are not visual source repairs. */ }
      if (previousPlan && sourceRepair && !input.clipId) {
        const guarded = guardSourceMotion(JSON.parse(previousPlan), proposed, motionEvidence, { width: input.width, height: input.height, fps: input.original.fps || 30 });
        await writeFile(join(job, `motion-regression-${iteration}.json`), JSON.stringify({ reverted: guarded.reverted, regressions: guarded.regressions }));
        if (guarded.reverted) { onLog('The proposed source motion worsened the measured match. Retaining the previous source curves while keeping other corrections.'); proposed = guarded.plan; }
      }
      requiredTechniques = proposed.techniques.map(({ id, name, expectedBehavior, checks }: { id: string; name: string; expectedBehavior: string; checks: string[] }) => ({ id, name, expectedBehavior, checks }));
      previousPlan = JSON.stringify(proposed);
      await writeFile(planPath, previousPlan);
      discoveredEffects = await discoverOfficialEffects({ job, attemptedAcquisitions, effects: proposed.effects || [], catalog: effectCatalog, cache: officialResults,
        connected: plugin.capabilities.materialSearch, onLog, signal });
      await writeFile(join(job, 'official-materials.json'), JSON.stringify([...officialResults.values()]));
      const officialApplication = await applyOfficialEffects({ job, iteration, effects: proposed.effects || [], discovered: discoveredEffects,
        width: input.width, height: input.height, duration: input.duration, onLog, signal });
      await writeFile(join(job, `capcut-routing-${iteration}.json`), JSON.stringify(effectRoutingReceipt(proposed.effects || [], officialApplication.bindings, integration)));
      await writeFile(join(job, 'required-techniques.json'), JSON.stringify(requiredTechniques));
      history.push({ iteration, phase: 'specialists_complete', message: specialistReports.map(report => report.role).join(', ') || 'No specialist required for this change.' });
      await writeFile(join(job, 'loop-history.json'), JSON.stringify(history));
      onLog("Compiling validated native editing controls. The AI does not execute editing scripts.");
      let compileFailure = "";
      try {
        await runCancellableProcess(process.execPath, [join(workspace, "scripts", "compile-controlled-edit.mjs"), job, candidate, String(iteration)],
          { cwd: workspace, timeoutMs: 120000, signal, onLine: line => {
            const finding = /^Error:\s*(.+)$/.exec(line)?.[1];
            if (finding) compileFailure = finding.slice(0, 12000);
          } });
      } catch (error) {
        signal?.throwIfAborted();
        if (compileFailure) throw new Error(compileFailure);
        throw error;
      }
      await assertNoLinks(candidate); await assertNoLinks(job);
      await input.assertOriginalUnchanged();
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NativeManifest;
      if (officialResults.size) manifest.toolsUsed.push("Official CapCut material discovery");
      if (officialApplication.applied) manifest.toolsUsed.push('Official CapCut local effect builder and native adapter');
      const analysis = JSON.parse(await readFile(join(job, "reference-analysis.json"), "utf8")) as ReferenceAnalysis;
      const draft = (await readNativeDraft(candidate)).draft;
      const execution = JSON.parse(await readFile(join(job, `execution-${iteration}.json`), 'utf8'));
      const compositionEffectIds = (proposed.effects || []).flatMap((effect: { target?: string }, index: number) => effect.target === 'composition'
        ? draft.tracks.flatMap(track => track.segments).filter(segment => segment.id === execution.refs[`effect-${index}`]).map(segment => segment.material_id) : []);
      await validateNativeCandidate({ original: input.original, candidate: draft, manifest, analysis, clipId: input.clipId,
        start: Math.round(input.start * 1_000_000), duration: Math.round(input.duration * 1_000_000), candidatePath: candidate,
        sourcePaths: [input.source, ...(input.originalSource ? [input.originalSource] : [])], width: input.width, height: input.height, compositionEffectIds });
      const lint = await run(process.execPath, [cli, "lint", candidate, "--json"], { timeout: 120000, signal, windowsHide: true, maxBuffer: 4_000_000 })
        .catch(error => {
          if (error.stdout) { try { JSON.parse(error.stdout); return { stdout: String(error.stdout), stderr: String(error.stderr || "") }; } catch { /* Keep non-JSON process failures. */ } }
          throw error;
        });
      await writeFile(join(job, `lint-${iteration}.json`), lint.stdout);
      const lintReport = JSON.parse(lint.stdout) as { ok: boolean; issues?: { severity: string; code: string; message: string }[] };
      if (!lintReport.ok) throw new Error(`Candidate validation: ${lintReport.issues?.filter(issue => issue.severity === "error").map(issue => `${issue.code}: ${issue.message}`).join("; ") || "structural checks failed"}`);
      const plan = createEditingPlan(draft);
      const checkedComponents = manifest.effects.flatMap(effect => effect.segmentIds);
      const segments = draft.tracks.flatMap(track => track.segments).filter(segment => checkedComponents.includes(segment.id));
      const curveReport = motionCurveReport(proposed, draft, execution.refs, motionEvidence, { width: input.width, height: input.height, duration: input.duration, fps: input.original.fps || 30 });
      await writeFile(join(job, `motion-curves-${iteration}.json`), JSON.stringify(curveReport));
      await writeFile(join(job, `structural-evidence-${iteration}.json`), JSON.stringify({ candidateDigest: await directoryDigest(candidate),
        originalUnchanged: true, unrelatedContentPreserved: true, structuralValidation: 'passed', lint: lintReport,
        durationSeconds: input.duration, sourceHasAudio: Boolean(input.sourceHasAudio),
        components: segments.map(segment => ({ id: segment.id, materialId: segment.material_id, range: segment.target_timerange,
          clip: segment.clip, keyframes: segment.common_keyframes, volume: segment.volume })),
        editableText: draft.materials.texts?.filter(text => segments.some(segment => segment.material_id === text.id)) }));
      await writeFile(join(job, "editing-plan.json"), JSON.stringify(plan));
      await writeFile(join(job, "manifest.json"), JSON.stringify(manifest));
      onLog("Preparing a design preview. CapCut-specific effects still require native verification.");
      let previewReady = false;
      try {
        await runCancellableProcess(process.execPath, [join(workspace, "scripts", "render-preview.mjs"), job, candidate],
          { cwd: workspace, timeoutMs: 180000, signal, onLine: onLog });
        try {
          onLog('HyperFrames: rendering the serialized native motion curves and editable text layout locally.');
          await runCancellableProcess(process.execPath, [join(workspace, 'scripts/render-motion-preview.mjs'), job, candidate, String(iteration)],
            { cwd: workspace, timeoutMs: 240000, signal, onLine: onLog });
          manifest.toolsUsed.push('HyperFrames + GSAP native-curve preview');
          await writeFile(join(job, 'manifest.json'), JSON.stringify(manifest));
        } catch (error) { signal?.throwIfAborted(); onLog(`Motion preview unavailable: ${editingFailureMessage(error)}. Review must retain its fidelity gaps.`); }
        previewReady = true;
        await copyFile(join(job, 'preview.mp4'), join(job, `preview-${iteration}.mp4`));
        await copyFile(join(job, 'preview-plan.json'), join(job, `preview-plan-${iteration}.json`));
        await input.onPreview?.();
      } catch (error) { signal?.throwIfAborted(); onLog(`Preview limitation: ${error instanceof Error ? error.message.slice(0, 500) : "Preview unavailable"}`); }
      let previewFrames: string[] = [];
      let comparisonFrames: string[] = [];
      let comparisonContext = '';
      let previewEvidence = "Preview unavailable.";
      let motionDefects: { component: string; timeSeconds: number; expected: string; observed: string; evidence: string }[] = [];
      try {
        if (previewReady) {
          const evidence = await inspectPreview(join(job, `preview-${iteration}.mp4`), join(job, `preview-evidence-${iteration}`), signal);
          previewFrames = evidence.frames;
          previousPreviewFrames = previewFrames;
          const previewIndex = JSON.parse(await readFile(evidence.indexPath, "utf8"));
          previewEvidence = referenceEvidenceContext(evidence, previewIndex);
          previousPreviewEvidence = previewEvidence;
          try {
            const audit = await auditMotionFrames(job, referenceIndex, previewIndex, motionEvidence, iteration, signal);
            motionDefects = audit.defects;
            if (motionDefects.length) onLog('Frame-by-frame comparison found exposed picture edges. These defects must be corrected.');
            const comparison = await buildMotionComparisons(job, proposed, referenceIndex, sourceIndex, previewIndex, iteration, signal, motionDefects.map(defect => defect.timeSeconds));
            comparisonFrames = comparison.images.map((item: { path: string }) => item.path);
            comparisonContext = comparison.layout;
          } catch (error) { signal?.throwIfAborted(); onLog(`Enlarged motion comparisons unavailable: ${editingFailureMessage(error)}`); }
          previousComparisonFrames = comparisonFrames; previousComparisonContext = comparisonContext;
        }
      }
      catch { signal?.throwIfAborted(); onLog("Preview images are unavailable; visual comparison cannot be completed."); }
      let findings = combineReviews([], proposed.techniques, false, await directoryDigest(candidate), [...proposed.unsupported, ...(manifest.verificationGaps || [])]);
      const capability = nativeReviewCapability();
      if (previewFrames.length && needsDesignReview(capability.available, motionDefects)) {
        onLog("Reviewing: visual reviewer and quality manager are checking the design evidence.");
        findings = await reviewAndManage({ job, candidate, request: input.prompt, referenceFrames: reference.frames,
          previewFrames, comparisonFrames, comparisonContext, referenceEvidence, previewEvidence, nativeVerified: false, iteration, signal, onLog });
      } else if (capability.available) {
        onLog('Fast checks complete. Independent reviewers will assess the actual CapCut player instead of repeating an approximate-preview review.');
      }
      const mixReport = await readFile(join(job, `audio-mix-report-${iteration}.json`), 'utf8').then(JSON.parse).catch(() => null);
      findings = includeMotionDefects(findings, motionDefects, proposed.techniques);
      if (mixReport) findings = includeAudioDefects(findings, mixReport, proposed.techniques);
      findings = requireAudioEvidence(findings, Boolean(proposed.audio?.clips.length), Boolean(mixReport));
      await writeFile(join(job, `quality-report-${iteration}.json`), JSON.stringify(findings));
      await writeFile(join(job, 'quality-report.json'), JSON.stringify(findings));
      const action = qualityAction(findings, iteration, budget);
      history.push({ iteration, phase: `quality_${action}`, message: findings.summary });
      if (action === 'repair') throw new Error(JSON.stringify(findings.defects).slice(0, 10000));
      if (action === 'exhausted') {
        onLog('The correction budget was exhausted with unresolved defects. This candidate has not passed quality review.');
        await writeFile(join(job, 'loop-history.json'), JSON.stringify(history));
        return { manifest, iterations: iteration, model: editingAgent.model, access: editingAgent.access, verified: false, evidencePath: '', quality: findings };
      }
      const revision = await directoryDigest(candidate);
      if (!capability.available) {
        onLog(capability.reason);
        history.push({ iteration, phase: "native_verification_blocked", message: capability.reason });
        await writeFile(join(job, "loop-history.json"), JSON.stringify(history));
        await writeFile(join(job, "review.json"), JSON.stringify({ matched: false, nativeOutput: "unavailable", candidateDigest: revision, notes: capability.reason }));
        return { manifest, iterations: iteration, model: editingAgent.model, access: editingAgent.access, verified: false, evidencePath: "", quality: findings };
      }
      let captured;
      try {
        captured = await captureNativePreview({ job, candidate, revision, start: input.start, duration: input.duration,
          width: input.width, height: input.height, signal, onLog });
        await input.assertOriginalUnchanged();
      } catch (error) {
        signal?.throwIfAborted();
        const reason = editingFailureMessage(error);
        onLog(`Native verification needs attention: ${reason}`);
        findings = { ...findings, decision: 'blocked', unknowns: [...findings.unknowns, `Native capture: ${reason}`] };
        history.push({ iteration, phase: 'native_capture_failed', message: reason });
        await writeFile(join(job, 'loop-history.json'), JSON.stringify(history));
        await writeFile(join(job, 'quality-report.json'), JSON.stringify(findings));
        return { manifest, iterations: iteration, model: editingAgent.model, access: editingAgent.access, verified: false, evidencePath: '', quality: findings,
          diagnostic: captureFailureDiagnostic(error) };
      }
      const nativeFrames = captured.nativeFrames;
      const nativeIndex = JSON.parse(await readFile(nativeFrames.indexPath, 'utf8'));
      const nativeTiming = referenceEvidenceContext(nativeFrames, nativeIndex);
      const nativeAudit = await auditMotionFrames(job, referenceIndex, nativeIndex, motionEvidence, iteration, signal);
      const nativeComparisons = await buildMotionComparisons(job, proposed, referenceIndex, sourceIndex, nativeIndex, iteration, signal, nativeAudit.defects.map((defect: { timeSeconds: number }) => defect.timeSeconds));
      onLog('Comparing actual CapCut output: visual reviewer and quality manager are assessing every technique.');
      findings = await reviewAndManage({ job, candidate, request: input.prompt, referenceFrames: reference.frames,
        previewFrames: nativeFrames.frames, comparisonFrames: nativeComparisons.images?.map((item: { path: string }) => item.path) || [],
        comparisonContext: nativeComparisons.layout, referenceEvidence, previewEvidence: nativeTiming, nativeVerified: true,
        nativeReceiptPath: captured.receiptPath, iteration, signal, onLog });
      findings = includeMotionDefects(findings, nativeAudit.defects, proposed.techniques);
      if (mixReport) findings = includeAudioDefects(findings, mixReport, proposed.techniques);
      findings = requireAudioEvidence(findings, Boolean(proposed.audio?.clips.length), Boolean(mixReport));
      await writeFile(join(job, `native-quality-${iteration}.json`), JSON.stringify(findings));
      await writeFile(join(job, 'quality-report.json'), JSON.stringify(findings));
      previousPreviewFrames = nativeFrames.frames; previousPreviewEvidence = `Native CapCut output: ${nativeTiming}`;
      previousComparisonFrames = nativeComparisons.images?.map((item: { path: string }) => item.path) || [];
      previousComparisonContext = nativeComparisons.layout;
      const nativeAction = qualityAction(findings, iteration, budget);
      history.push({ iteration, phase: `native_${nativeAction}`, message: findings.summary });
      await writeFile(join(job, 'loop-history.json'), JSON.stringify(history));
      if (nativeAction === 'repair') throw new Error(JSON.stringify(findings.defects).slice(0, 10000));
      return { manifest, iterations: iteration, model: editingAgent.model, access: editingAgent.access,
        verified: nativeAction === 'approve', evidencePath: captured.receiptPath, quality: findings };
    } catch (error) {
      signal?.throwIfAborted();
      const message = editingFailureMessage(error);
      if (requiresHostAttention(error)) {
        history.push({ iteration, phase: 'host_attention', message });
        await writeFile(join(job, 'loop-history.json'), JSON.stringify(history));
        onLog(`Local runtime needs attention: ${message}`);
        throw error;
      }
      repeated = message === previousFailure ? repeated + 1 : 1; previousFailure = message;
      history.push({ iteration, phase: "correction", message });
      await writeFile(join(job, "loop-history.json"), JSON.stringify(history));
      feedback = message.slice(0, 12000); onLog(`Correction needed: ${feedback}`);
      if (repeated >= 2) throw error;
    }
  }
  throw new Error(`Editing stopped after ${budget} attempts. Original unchanged. ${feedback}`);
}
