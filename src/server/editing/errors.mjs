function diagnosticText(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = typeof error?.stderr === 'string' ? error.stderr : Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : '';
  return { message, stderr, combined: `${stderr}\n${message}` };
}

const launcherHelp = 'Use the app that starts the AI-Editor server: Terminal/iTerm, or VS Code/Codex when started from its terminal. Confirm the app named by macOS, then fully quit and reopen that launcher and restart AI-Editor.';
export const nativeFailureMessages = Object.freeze({
  NATIVE_MACOS_ACCESSIBILITY_REQUIRED: `macOS Accessibility permission is required. In System Settings > Privacy & Security > Accessibility, enable the launching app. ${launcherHelp}`,
  NATIVE_MACOS_SCREEN_RECORDING_REQUIRED: `macOS Screen & System Audio Recording permission is required to inspect CapCut. In System Settings > Privacy & Security, allow screen recording for the launching app. ${launcherHelp}`,
  NATIVE_MACOS_AUTOMATION_REQUIRED: `macOS Automation permission is required. In System Settings > Privacy & Security > Automation, allow the launching app to control System Events and CapCut when requested. ${launcherHelp}`,
  NATIVE_WINDOW_UNAVAILABLE: 'CapCut has no usable visible window. Keep its project window open and the desktop unlocked, then retry native review.',
  NATIVE_REVIEW_FAILED: 'Native CapCut review stopped. The candidate is retained; see the failed stage in diagnostic details.',
  NATIVE_REVIEW_COPY_FAILED: 'The temporary CapCut review copy could not finish opening. See the failed stage in diagnostic details.',
});

/** Match specific OS findings inside nested execFile/JXA wrappers. -2700 alone is not a permission error. */
export function nativeFailureCode(error) {
  const { combined } = diagnosticText(error);
  if (/macOS Accessibility permission is required|osascript is not allowed assistive access/i.test(combined)) return 'NATIVE_MACOS_ACCESSIBILITY_REQUIRED';
  if (/macOS Screen(?: & System Audio)? Recording permission|macOS Screen Recording permission/i.test(combined)) return 'NATIVE_MACOS_SCREEN_RECORDING_REQUIRED';
  if (/Not authori[sz]ed to send Apple events|\(-1743\)|macOS Automation permission is required/i.test(combined)) return 'NATIVE_MACOS_AUTOMATION_REQUIRED';
  if (/CapCut has no usable visible window/i.test(combined)) return 'NATIVE_WINDOW_UNAVAILABLE';
  if (error?.nativeFailure) return error.nativeFailure.kind === 'review-copy' ? 'NATIVE_REVIEW_COPY_FAILED' : 'NATIVE_REVIEW_FAILED';
}

/** These conditions cannot be corrected by rewriting the editing plan. */
export function requiresHostAttention(error) {
  return Boolean(nativeFailureCode(error)) || /Native capture interrupted:|CapCut could not receive focus|CapCut lost focus|CapCut (?:window changed|window disappeared|moved before input|is minimized|has no usable visible window)|A CapCut dialog is blocking|macOS .*permission|unavailable to this Codex account|sign in|permission|sandbox/i.test(diagnosticText(error).combined);
}

/** Keep a useful tool finding without exposing an entire command/Node stack to the UI. */
export function editingFailureMessage(error) {
  const { message, stderr, combined } = diagnosticText(error);
  const nativeCode = nativeFailureCode(error);
  if (nativeCode && !['NATIVE_REVIEW_FAILED', 'NATIVE_REVIEW_COPY_FAILED'].includes(nativeCode)) return nativeFailureMessages[nativeCode];
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
