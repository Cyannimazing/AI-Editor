import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEditSelection, validateProjectPlan, runScopedBuilds } from '../src/server/editing/project-scope.mjs';
import { applyFinalProjectChecks } from '../src/server/editing/project-review-checks.mjs';
import { qualityAction } from '../src/server/editing/quality.mjs';

const project = { hasTimelineContent: true, clips: [{ id: 'a', name: 'Opening.mp4', startUs: 0 }, { id: 'b', name: 'Closing.mp4', startUs: 2000000 }] };
test('project is the default scope; checked clips are strict and legacy requests remain scoped', () => {
  assert.deepEqual(resolveEditSelection(project, {}).clipIds, ['a', 'b']);
  assert.deepEqual(resolveEditSelection(project, { clipId: 'b' }).clipIds, ['b']);
  assert.deepEqual(resolveEditSelection(project, { editScope: 'clips', clipIds: ['b', 'a'] }).clipIds, ['a', 'b']);
  for (const input of [{ editScope: 'clips', clipIds: [] }, { editScope: 'clips', clipIds: ['gone'] }, { editScope: 'clips', clipIds: ['a', 'a'] }, { editScope: 'project', clipIds: ['a'] }, { clipIds: 'a' }]) assert.throws(() => resolveEditSelection(project, input));
  assert.throws(() => resolveEditSelection(project, { rawVideo: {} }), /empty/);
  assert.throws(() => resolveEditSelection({ hasTimelineContent: false, clips: [] }, {}), /footage/);
  assert.equal(resolveEditSelection({ hasTimelineContent: false, clips: [] }, { rawVideo: {} }).mode, 'footage');
});

test('routing accounts for every allowed clip, cannot broaden scope or hide unresolved work', () => {
  const plan = { summary: 'Opening only', clips: [{ clipId: 'a', action: 'edit', instruction: 'Slow zoom', reason: 'Requested opening' }, { clipId: 'b', action: 'keep', instruction: '', reason: 'Closing is unrelated' }], unsupported: [] };
  assert.equal(validateProjectPlan(plan, ['a', 'b']).clips.length, 2);
  assert.throws(() => validateProjectPlan(plan, ['a']), /scope/);
  assert.throws(() => validateProjectPlan({ ...plan, clips: plan.clips.slice(0, 1) }, ['a', 'b']), /every/);
  assert.throws(() => validateProjectPlan({ ...plan, clips: [plan.clips[0], plan.clips[0]] }, ['a', 'b']), /duplicate/i);
  assert.deepEqual(validateProjectPlan({ ...plan, unsupported: ['Changing existing subtitle wording needs another adapter.'] }, ['a', 'b']).unsupported, ['Changing existing subtitle wording needs another adapter.']);
});

test('scoped builds accumulate one candidate; skipped clips and failures never commit originals', async () => {
  const plan = { clips: [{ clipId: 'a', action: 'edit' }, { clipId: 'b', action: 'edit' }, { clipId: 'c', action: 'keep' }] };
  const calls = [];
  const result = await runScopedBuilds(plan, 'original', async (task, baseline) => { calls.push([task.clipId, baseline]); return { candidatePath: `${baseline}-${task.clipId}` }; });
  assert.deepEqual(calls, [['a', 'original'], ['b', 'original-a']]);
  assert.equal(result.candidate, 'original-a-b');
  let attempts = 0;
  await assert.rejects(runScopedBuilds(plan, 'original', async () => { attempts++; throw new Error('build failed'); }), /build failed/);
  assert.equal(attempts, 1);
});

test('final project review cannot erase deterministic motion failures or missing audio evidence', () => {
  const ready = { decision: 'ready', nativeVerified: true, defects: [], unknowns: [], techniques: [{ id: 'zoom', status: 'matched' }] };
  const plan = { techniques: [{ id: 'zoom', components: ['source'] }], audio: { clips: [] } };
  const defect = { component: 'source / picture coverage', timeSeconds: 1, observed: 'Exposed edge', expected: 'Covered picture', evidence: 'Native frame' };
  const checked = applyFinalProjectChecks(ready, { defects: [defect] }, plan, null);
  assert.equal(qualityAction(checked, 4, 4), 'exhausted');
  assert.ok(checked.defects.includes(defect));
  assert.throws(() => applyFinalProjectChecks(ready, null, plan, null), /audit/);
  assert.equal(applyFinalProjectChecks(ready, { defects: [] }, { ...plan, audio: { clips: [{}] } }, null).decision, 'blocked');
  assert.equal(qualityAction(applyFinalProjectChecks(ready, { defects: [] }, plan, null), 4, 4), 'approve');
});
