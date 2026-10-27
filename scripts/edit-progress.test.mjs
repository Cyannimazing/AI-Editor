import test from 'node:test';
import assert from 'node:assert/strict';
import { progressMessage, readableProgress } from '../src/lib/edit-progress.mjs';
import { processEventLine } from '../src/lib/process-events.mjs';

const event = value => JSON.stringify(value);
const disabled = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';

test('repairable input, retry exhaustion and confirmed recovery have distinct UI messages', () => {
  const entry = value => progressMessage(event({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'ai_editor', tool: 'evaluate_keyframes', result: { content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }) }] } } }));
  const problem = { code: 'INVALID_EDIT_PLAN', message: 'Missing text duration.', repairHint: 'Read the complete saved plan.', recoverable: true };
  assert.equal(entry(problem).kind, 'notice'); assert.match(entry(problem).text, /Missing text duration/);
  assert.equal(entry({ ...problem, recoverable: false }).kind, 'error');
  assert.match(entry({ recovery: { status: 'recovered' } }).text, /still needs its editing review/);
  assert.equal(entry({ code: 'EDITING_TOOL_FAILED', message: 'Evidence escapes its job.' }).kind, 'error');
});

test('MCP image results stay out of progress and tool calls receive readable labels', () => {
  const item = { type: 'mcp_tool_call', server: 'ai_editor', tool: 'reference_frames', arguments: {}, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(500000) }] } };
  const cleaned = processEventLine(JSON.stringify({ type: 'item.completed', item }));
  assert.ok(cleaned.length < 1000); assert.ok(!cleaned.includes('A'.repeat(100)));
  const wrapped = { ...item, result: { content: [{ type: 'text', text: JSON.stringify(item.result) }] } };
  const cleanedWrapper = processEventLine(JSON.stringify({ type: 'item.completed', item: wrapped }));
  assert.ok(cleanedWrapper.length < 1000); assert.ok(!cleanedWrapper.includes('A'.repeat(100)));
  assert.match(cleanedWrapper, /media omitted/);
  assert.match(progressMessage(JSON.stringify({ type: 'item.started', item })).text, /timed frames/);
  assert.equal(progressMessage('A'.repeat(1000)), null);
});

test('reported startup events become readable progress without leaking raw JSON or pretending the edit finished', () => {
  const lines = [
    'Preparing an isolated candidate. The original project will remain unchanged.',
    'Loaded editor context: 8 guides and the inspected local tool inventory.',
    'editor: gpt-6.1-sol, medium reasoning. The AI returns JSON; application services perform edits.',
    'Reading prompt from stdin...',
    event({ type: 'thread.started', thread_id: 'internal-id' }),
    event({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: disabled } }),
    event({ type: 'turn.started' }),
    event({ type: 'turn.completed', usage: { input_tokens: 100 } }),
  ];
  const progress = readableProgress(lines);
  assert.equal(progress.length, 3);
  assert.equal(progress[1].text, 'Lead editor is working…');
  assert.equal(progress[2].kind, 'error');
  assert.match(progress[2].text, /editing tools could not start/);
  assert.ok(progress.every(item => !/[{}]|thread_id|input_tokens|finished|successful/i.test(item.text)));
  assert.match(lines[5], /code-mode host/, 'the raw diagnostic is retained');
});

test('real nested errors, failed turns and missing runtimes stay visible', () => {
  for (const input of [
    { type: 'item.completed', item: { type: 'error', message: 'Authentication expired.' } },
    { type: 'error', message: 'Connection lost.' },
    { type: 'turn.failed', error: { message: disabled } },
    { type: 'turn.failed', error: 'Request failed.' },
    { type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable because codex-code-mode-host is not installed.' } },
  ]) {
    const output = progressMessage(event(input));
    assert.equal(output.kind, 'error');
    assert.ok(output.text.length > 20);
  }
  assert.match(progressMessage(event({ type: 'item.completed', item: { type: 'error', message: 'Authentication expired.' } })).text, /Authentication expired/);
});

test('structured plans and reviews become summaries while repairs keep their actual timed defects', () => {
  const plan = { summary: 'Move the title into position.', source: { keyframes: [] }, techniques: [{ name: 'Title entrance' }] };
  const output = progressMessage(event({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(plan) } }));
  assert.match(output.text, /^Editing plan: Move the title/);
  assert.match(output.text, /Title entrance/);
  assert.ok(!output.text.includes('keyframes'));
  assert.match(progressMessage(event({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ decision: 'revise', summary: 'The title is too large.', defects: [] }) } })).text, /Review: The title is too large/);
  const correction = progressMessage('Correction needed: ' + JSON.stringify([{ component: 'title', timeSeconds: 0.2, observed: 'Text is clipped.', expected: 'All words fit.' }]));
  assert.match(correction.text, /title at 0.2s: Text is clipped. Expected: All words fit/);
});

test('unknown and truncated protocol data never falls back to raw JSON in the readable view', () => {
  assert.equal(progressMessage(event({ type: 'future.event', payload: { private_detail: 'not a message' } })), null);
  assert.equal(progressMessage(event({ ok: true, editableTexts: 3 })), null);
  assert.equal(progressMessage(event({ type: 'item.updated', item: { type: 'agent_message', text: '{"partial"' } })), null);
  const truncated = progressMessage('{"type":"item.completed","item":');
  assert.equal(truncated.kind, 'notice');
  assert.ok(!truncated.text.includes('{'));
  assert.equal(readableProgress(['Rendering preview.', 'Rendering preview.']).length, 1);
});

test('temporary connection retries and HTTPS fallback are readable notices with duplicate events collapsed', () => {
  const retry = 'Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)';
  const fallback = 'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: websocket closed by server before response.completed';
  const lines = [
    '2026-10-27T18:22:11.709994Z  WARN codex_core::responses_retry: stream disconnected - retrying sampling request (2/5 in 394ms)... turn_id=private-id retries=2 max_retries=5 sampling_error=stream disconnected',
    event({ type: 'error', message: retry }),
    '2026-10-27T18:22:27.689683Z  WARN codex_core::client: falling back to HTTP',
    event({ type: 'item.completed', item: { type: 'error', message: fallback } }),
  ];
  const progress = readableProgress(lines);
  assert.equal(progress.length, 2);
  assert.ok(progress.every(item => item.kind === 'notice'));
  assert.match(progress[0].text, /Reconnecting to Codex \(2\/5\)/);
  assert.match(progress[1].text, /retrying over HTTPS/);
  assert.ok(progress.every(item => !/turn_id|codex_core|response.completed|2026-|recovered|successful/.test(item.text)));
  assert.match(lines[0], /turn_id=private-id/, 'original technical details remain available');
  assert.equal(progressMessage(event({ type: 'turn.failed', error: { message: fallback } })).kind, 'error', 'a failed turn must not be downgraded to a retry');
  assert.equal(progressMessage('2026-10-27T18:22:27Z ERROR codex_core::client: Credentials rejected.').kind, 'error');
  assert.equal(progressMessage('2026-10-27T18:22:27Z DEBUG codex_core::client: diagnostic state'), null);
});
