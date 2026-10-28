import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveEditorPlanResult } from '../src/server/editing/editor-plan-result.mjs';
const digest = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

test('saved plan handoff resolves exact current content and rejects stale or missing builds', async () => {
  const plan = { version: 5, summary: 'fixture' }, hash = digest(plan);
  assert.deepEqual(await resolveEditorPlanResult({ planHash: hash, plan: null }, async () => JSON.stringify(plan)), plan);
  await assert.rejects(resolveEditorPlanResult({ planHash: hash, plan: null }, async () => JSON.stringify({ ...plan, summary: 'changed' })), /hash/);
  await assert.rejects(resolveEditorPlanResult({ planHash: hash, plan: null }, async () => { throw new Error('missing'); }), /missing/);
});

test('full plans remain available without reading a stale saved build; malformed or oversized envelopes fail', async () => {
  const plan = { version: 5 };
  assert.deepEqual(await resolveEditorPlanResult({ planHash: '', plan }, async () => { throw new Error('must not read'); }), plan);
  for (const input of [{ planHash: '', plan: null }, { planHash: digest(plan), plan }, { planHash: 'wrong', plan: null },
    { planHash: '', plan, extra: true }, { planHash: '', plan: [] }]) {
    await assert.rejects(resolveEditorPlanResult(input, async () => JSON.stringify(plan)), /Invalid/);
  }
  await assert.rejects(resolveEditorPlanResult({ planHash: '', plan: { text: 'x'.repeat(250001) } }), /budget/);
  await assert.rejects(resolveEditorPlanResult({ planHash: digest(plan), plan: null }, async () => ' '.repeat(250001)), /budget/);
});
