import { createHash } from 'node:crypto';
import { soundDesignPlanSchema } from './controlled-plan.mjs';

export const editorPlanResultSchema = {
  type: 'object', additionalProperties: false, required: ['planHash', 'plan'], properties: {
    planHash: { type: 'string', description: 'The exact planHash returned by a successful apply_edit_plan call, or empty when returning a complete unbuilt plan.' },
    plan: { anyOf: [soundDesignPlanSchema, { type: 'null' }], description: 'Use null with a successful build hash. Otherwise return the complete plan with an empty planHash.' },
  },
};

/** This resolves a transport envelope, never grants acceptance. Callers still
 * validate the complete plan and all downstream scope/security/quality gates.
 */
export async function resolveEditorPlanResult(result, loadAppliedPlan) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(result) || Object.keys(result).length !== 2 || !Object.hasOwn(result, 'plan') || typeof result.planHash !== 'string')
    throw new Error('Invalid editor plan handoff.');
  let plan;
  if (result.planHash === '') {
    if (!object(result.plan)) throw new Error('Invalid full-plan handoff.');
    plan = result.plan;
  } else {
    if (!/^[a-f0-9]{64}$/.test(result.planHash) || result.plan !== null || typeof loadAppliedPlan !== 'function') throw new Error('Invalid saved-plan handoff.');
    const saved = await loadAppliedPlan();
    if (typeof saved !== 'string' || saved.length > 250000) throw new Error('Saved editing plan exceeds the handoff budget.');
    plan = JSON.parse(saved);
    if (!object(plan)) throw new Error('Invalid saved editing plan.');
    const actual = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    if (actual !== result.planHash) throw new Error('The saved editing plan hash differs from the editor handoff.');
  }
  if (JSON.stringify(plan).length > 250000) throw new Error('Editing plan exceeds the handoff budget.');
  return plan;
}
