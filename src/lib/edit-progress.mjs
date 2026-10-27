// Presentation only: raw events remain in the diagnostic log and never drive
// success/approval. Job state and validated artifacts own those decisions.
const roles = { editor: 'Lead editor', motion: 'Motion specialist', captions: 'Caption specialist', audio: 'Audio specialist', reviewer: 'Visual reviewer', manager: 'Quality manager' };
const text = value => typeof value === 'string' ? value.trim() : '';
const message = (kind, value) => ({ kind, text: value });
const disabledCodeHost = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';

function connectionProgress(detail) {
  const retry = /^Reconnecting\.\.\. (\d+)\/(\d+)\b/.exec(detail)
    || /^stream disconnected - retrying sampling request \((\d+)\/(\d+) in /.exec(detail);
  if (retry) return message('notice', `Connection interrupted. Reconnecting to Codex (${retry[1]}/${retry[2]})…`);
  if (detail === 'falling back to HTTP' || detail.startsWith('Falling back from WebSockets to HTTPS transport.')) {
    return message('notice', 'Codex is retrying over HTTPS after the live connection dropped.');
  }
  return null;
}

function errorMessage(value, fatal = false) {
  const detail = text(value) || 'The AI did not return an error description. See diagnostic details.';
  // MCP editing requires the tool host; this is no longer a harmless startup
  // diagnostic from the older JSON-only planning mode.
  if (!fatal && detail === disabledCodeHost) return message('error', 'Codex’s local editing tools could not start. Check the tool-host setup.');
  const connection = !fatal && connectionProgress(detail);
  if (connection) return connection;
  return message('error', `AI ${fatal ? 'step failed' : 'reported a problem'}: ${detail}`);
}

function structuredMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = text(value.summary);
  if (summary && Array.isArray(value.techniques) && value.source) {
    const names = value.techniques.map(item => text(item?.name)).filter(Boolean);
    return message('message', `Editing plan: ${summary}${names.length ? `\nPlanned techniques: ${names.join(', ')}.` : ''}`);
  }
  if (summary && typeof value.decision === 'string') return message('message', `Review: ${summary}`);
  if (summary) return message('message', `${roles[value.role] || 'AI'}: ${summary}`);
  if (typeof value.error === 'string') return errorMessage(value.error);
  if (value.error?.message) return errorMessage(value.error.message);
  if (value.ok === false || value.success === false) return errorMessage(value.message);
  return null;
}

// Codex can wrap MCP content in another JSON text block. Inspect only bounded
// text envelopes; never show image bytes or mistake a tool retry for edit approval.
function toolOutcome(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === 'string') {
    if (value.length > 100000) return null;
    try { return toolOutcome(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (value.code === 'INVALID_EDIT_PLAN') return message(value.recoverable ? 'notice' : 'error',
    `${value.recoverable ? 'The proposed edit needs a correction; the agent can repair it' : 'Repeated invalid edit; automatic retries stopped'}: ${text(value.message)}`);
  if (value.code === 'EDITING_TOOL_FAILED') return errorMessage(value.message);
  if (value.recovery?.status === 'recovered') return message('notice', 'The corrected tool request passed. The candidate still needs its editing review.');
  const content = Array.isArray(value.content) ? value.content : [];
  // Prefer a confirmed recovery receipt over the ordinary result summary.
  for (const block of [...content].reverse()) {
    if (block.type === 'text') { const found = toolOutcome(block.text, depth + 1); if (found) return found; }
  }
  return null;
}

export function progressMessage(line) {
  const clean = text(line);
  if (!clean || clean === 'Reading prompt from stdin...' || clean.startsWith('Loaded ') && clean.includes(' context:')) return null;
  // Older saved runs may contain the tail of a truncated binary-media event.
  if (/^[A-Za-z0-9+/=]{256}/.test(clean)) return null;
  const log = /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([a-zA-Z0-9_:]+):\s*([\s\S]*)$/.exec(clean);
  if (log) {
    if (log[1] !== 'ERROR' && ['codex_core::responses_retry', 'codex_core::client'].includes(log[2])) {
      const connection = connectionProgress(log[3]);
      if (connection) return connection;
    }
    if (['TRACE', 'DEBUG', 'INFO'].includes(log[1])) return null;
    return message(log[1] === 'ERROR' ? 'error' : 'notice', `Codex ${log[1].toLowerCase()}: ${log[3]}`);
  }
  const role = /^(editor|motion|captions|audio|reviewer|manager): [^,]+, .*reasoning\./.exec(clean);
  if (role) return message('status', `${roles[role[1]]} is working…`);
  if (clean.startsWith('Correction needed: ')) {
    try {
      const defects = JSON.parse(clean.slice('Correction needed: '.length));
      if (Array.isArray(defects)) return message('notice', `Corrections needed:\n${defects.map(defect => `${text(defect.component) || 'Edit'}${Number.isFinite(defect.timeSeconds) ? ` at ${defect.timeSeconds}s` : ''}: ${text(defect.observed)}${text(defect.expected) ? ` Expected: ${defect.expected}` : ''}`).join('\n')}`);
    } catch { /* Ordinary error text is already readable. */ }
  }
  if (!/^[{\[]/.test(clean)) return message('status', clean);
  let event;
  try { event = JSON.parse(clean); }
  catch { return message('notice', 'A diagnostic event was shortened. Its details are available in the diagnostic view.'); }
  if (!event || typeof event !== 'object') return null;
  if (['thread.started', 'turn.started', 'turn.completed'].includes(event.type)) return null;
  if (event.type === 'turn.failed') return errorMessage(event.error?.message || text(event.error) || event.message, true);
  if (event.type === 'error') return errorMessage(event.message || event.error?.message || text(event.error));
  if (event.type === 'warning' && text(event.message)) return message('notice', event.message);
  if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
    const item = event.item;
    if (!item) return null;
    if (item.type === 'error') return errorMessage(item.message || item.text);
    if (item.type === 'mcp_tool_call' && item.server === 'ai_editor' && event.type === 'item.started') {
      const labels = { inspect_job: 'Inspecting the local editing tools and picture geometry…', reference_frames: 'Examining individual timed frames…',
        evaluate_keyframes: 'Checking the proposed keyframe movement…', apply_edit_plan: 'Building editable layers and keyframes in the CapCut candidate…',
        inspect_timeline: 'Reading back the saved CapCut controls…', discover_capabilities: 'Checking the installed editing controls and effect catalog…' };
      return labels[item.tool] ? message('status', labels[item.tool]) : null;
    }
    if (item.type === 'agent_message' && event.type === 'item.completed') {
      const content = text(item.text);
      if (!content) return null;
      if (/^[{\[]/.test(content)) {
        try { return structuredMessage(JSON.parse(content)); }
        catch { return message('notice', 'The AI returned incomplete structured output. The app will validate it before editing.'); }
      }
      return message('message', content);
    }
    if (item.type === 'mcp_tool_call' && event.type === 'item.completed') {
      const outcome = toolOutcome(item.result) || toolOutcome(item.error?.message);
      if (outcome) return outcome;
      if (item.result?.isError) return errorMessage('An editing tool failed. The agent must inspect the diagnostic before retrying.');
    }
    if (item.status === 'failed' || item.error) return errorMessage(item.error?.message || item.message || 'An AI tool action failed. See diagnostic details.');
    // Reasoning, tool arguments, IDs and partial data belong in diagnostics.
    return null;
  }
  return structuredMessage(event);
}

export function readableProgress(lines) {
  const entries = [];
  for (const line of lines) {
    const entry = progressMessage(line);
    if (entry && (entries.at(-1)?.text !== entry.text || entries.at(-1)?.kind !== entry.kind)) entries.push(entry);
  }
  return entries;
}
