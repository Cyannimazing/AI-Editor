/** Keep a useful tool finding without exposing an entire command/Node stack to the UI. */
export function editingFailureMessage(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  const finding = /^Error:\s*(.+)$/m.exec(stderr)?.[1];
  if (finding) return finding.slice(0, 12000);
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Command failed:')) return 'An editing tool failed before it returned a usable result. The candidate and source files were retained; no original was changed.';
  return message.slice(0, 12000);
}
