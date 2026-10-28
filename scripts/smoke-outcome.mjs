/** Exit 0 requires verified output; 2 preserves useful but incomplete evidence. */
export function smokeOutcome(data) {
  const result = data.result, quality = result?.quality;
  if (!result || ['failed', 'cancelled', 'interrupted'].includes(data.status) || quality?.defects?.length) {
    return { outcome: 'failed', exitCode: 1 };
  }
  const passed = ['awaiting_approval', 'complete'].includes(data.status) && result.verified === true
    && quality?.decision === 'ready' && quality.nativeVerified === true
    && Array.isArray(quality.unknowns) && quality.unknowns.length === 0
    && Array.isArray(quality.techniques) && quality.techniques.every(item => item.status === 'matched');
  return passed ? { outcome: 'passed', exitCode: 0 } : { outcome: 'incomplete', exitCode: 2 };
}
