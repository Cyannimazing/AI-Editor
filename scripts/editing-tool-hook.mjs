// Workers can invoke only the job-bound local MCP tools. Shell, patch, desktop,
// unrelated plugins and unknown tools remain denied on Windows and macOS.
let bytes = '';
for await (const chunk of process.stdin) {
  bytes += chunk;
  if (bytes.length > 1_000_000) process.exit(2);
}
try {
  const { tool_name } = JSON.parse(bytes);
  process.exit(/^mcp__ai_editor__(inspect_job|discover_capabilities|reference_frames|evaluate_keyframes|inspect_timeline|apply_edit_plan)$/.test(tool_name) ? 0 : 2);
} catch { process.exit(2); }
