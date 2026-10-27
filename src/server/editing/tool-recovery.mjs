export function invalidEditInput(error) {
  error.code = 'INVALID_EDIT_PLAN';
  error.recoverable = true;
  error.repairHint = 'Repair the specified fields in the complete plan and retry. For a saved plan, call evaluate_keyframes with planJson="" instead of reconstructing a partial plan. Do not change unrelated components or weaken checks.';
  return error;
}

export function editingToolFailure(error) {
  return { code: error.code === 'INVALID_EDIT_PLAN' ? error.code : 'EDITING_TOOL_FAILED',
    message: error.message || 'The local editing tool failed.', recoverable: error.recoverable === true,
    repairHint: error.repairHint || 'Inspect the diagnostic. Do not bypass permissions, invent success or repeatedly submit the same failed action.',
    ...(error.recoveryAttempts ? { recoveryAttempts: error.recoveryAttempts } : {}) };
}
