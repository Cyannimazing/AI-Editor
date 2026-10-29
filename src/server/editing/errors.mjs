function diagnosticText(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = typeof error?.stderr === 'string' ? error.stderr : Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : '';
  return { message, stderr, combined: `${stderr}\n${message}` };
}

/** These conditions cannot be corrected by rewriting the editing plan. */
export function requiresHostAttention(error) {
  return /Native capture interrupted:|CapCut could not receive focus|CapCut lost focus|CapCut (?:window changed|window disappeared|moved before input|is minimized|has no usable visible window)|A CapCut dialog is blocking|macOS .*permission|unavailable to this Codex account|sign in|permission|sandbox/i.test(diagnosticText(error).combined);
}

/** Keep a useful tool finding without exposing an entire command/Node stack to the UI. */
export function editingFailureMessage(error) {
  const { message, stderr, combined } = diagnosticText(error);
  if (/Native capture interrupted: another window covers CapCut/i.test(combined))
    return 'A window or overlay is covering CapCut, so the app could not inspect it safely. Dismiss the overlay and keep CapCut visible during native checks. The candidate is retained; the AI does not need to rewrite the edit for this interruption.';
  if (/Native capture interrupted: CapCut focus or window changed|CapCut could not receive focus|CapCut lost focus|CapCut (?:window changed|window disappeared|moved before input|is minimized)/i.test(combined))
    return 'CapCut lost focus, moved or became unavailable during inspection. Keep its window visible and stable while native checks run. The candidate is retained; this is a desktop interruption, not an editing defect.';
  const desktopFinding = /^(?:Error:\s*)?((?:macOS .*(?:permission|access)|A CapCut dialog is blocking|CapCut has no usable visible window)[^\r\n]*)/mi.exec(combined)?.[1];
  if (desktopFinding) return desktopFinding.slice(0, 2000);
  const finding = /^Error:\s*(.+)$/m.exec(stderr)?.[1];
  if (finding) return finding.slice(0, 12000);
  if (message.startsWith('Command failed:')) return 'An editing tool failed before it returned a usable result. The candidate and source files were retained; no original was changed.';
  return message.slice(0, 12000);
}
