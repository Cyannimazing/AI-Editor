/** Selection is resolved from a fresh project snapshot, never client names. */
export function resolveEditSelection(project, input) {
  const ids = input.clipIds ?? (input.clipId ? [input.clipId] : []);
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(ids).size !== ids.length) throw new Error('Invalid or duplicate selected clips.');
  const mode = input.editScope || (ids.length ? 'clips' : 'project');
  if (!['clips', 'project'].includes(mode) || (mode === 'project' && ids.length)) throw new Error('Choose entire project or selected clips.');
  if (input.clipId && input.clipIds && (ids.length !== 1 || ids[0] !== input.clipId)) throw new Error('Conflicting clip selection.');
  if (!project.hasTimelineContent) {
    if (ids.length || mode === 'clips') throw new Error('This empty project has no clips to select.');
    if (!input.rawVideo) throw new Error('Add footage to this empty project.');
    return { mode: 'footage', clipIds: [] };
  }
  if (input.rawVideo) throw new Error('Raw footage can only be added to an empty project in this workflow.');
  if (!project.clips.length) throw new Error('The active timeline has no editable video clips. Existing text and audio remain unchanged.');
  if (mode === 'project' && project.clips.length > 100) throw new Error('This timeline exceeds the 100-clip planning limit. Select a smaller set of clips.');
  if (mode === 'clips' && !ids.length) throw new Error('Check at least one clip, or choose Entire project.');
  if (ids.some(id => !project.clips.some(clip => clip.id === id))) throw new Error('A selected clip is stale or belongs to another project. Refresh the project.');
  return { mode, clipIds: project.clips.filter(clip => mode === 'project' || ids.includes(clip.id)).sort((a, b) => a.startUs - b.startUs).map(clip => clip.id) };
}

const string = { type: 'string' };
export const projectPlanSchema = { type: 'object', additionalProperties: false, required: ['summary', 'clips', 'unsupported'], properties: {
  summary: string, unsupported: { type: 'array', items: string }, clips: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['clipId', 'action', 'instruction', 'reason'], properties: { clipId: string, action: { type: 'string', enum: ['edit', 'keep'] }, instruction: string, reason: string } } },
} };

export function validateProjectPlan(plan, allowed) {
  const bounded = (s, max) => typeof s === 'string' && s.length <= max;
  if (!plan || !bounded(plan.summary, 2000) || !plan.summary.trim() || !Array.isArray(plan.clips) || !Array.isArray(plan.unsupported)
    || plan.unsupported.length > 30 || plan.unsupported.some(s => !bounded(s, 1500) || !s.trim())) throw new Error('Invalid project editing plan.');
  const seen = new Set();
  for (const task of plan.clips) {
    if (!allowed.includes(task.clipId)) throw new Error('Project planner attempted to widen the selected scope.');
    if (seen.has(task.clipId)) throw new Error('Duplicate project clip assignment.');
    seen.add(task.clipId);
    if (!['edit', 'keep'].includes(task.action) || !bounded(task.instruction, 8000) || !bounded(task.reason, 1500) || !task.reason.trim()
      || (task.action === 'edit' && !task.instruction.trim()) || (task.action === 'keep' && task.instruction !== '')) throw new Error('Invalid clip assignment.');
  }
  if (allowed.some(id => !seen.has(id))) throw new Error('The plan must account for every allowed clip.');
  return { ...plan, clips: allowed.map(id => plan.clips.find(task => task.clipId === id)) };
}

/** The caller owns locks/approval. This never commits an intermediate result. */
export async function runScopedBuilds(plan, initial, build, signal) {
  let candidate = initial;
  const results = [];
  for (const task of plan.clips) {
    signal?.throwIfAborted();
    if (task.action === 'keep') continue;
    const result = await build(task, candidate);
    if (!result?.candidatePath) throw new Error('A scoped build did not produce a candidate.');
    candidate = result.candidatePath; results.push(result);
  }
  return { candidate, results };
}
