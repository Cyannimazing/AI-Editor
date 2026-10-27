const findingKey = finding => JSON.stringify([finding.component, finding.timeSeconds, finding.expected, finding.observed]);

/** Reviewers cannot erase each other's findings or turn missing evidence into a pass. */
export function combineReviews(reports, techniques, nativeVerified, candidateDigest, unresolvedRequirements = []) {
  const defects = new Map(), unknowns = new Set(), assessments = [];
  if (reports.length !== 2) unknowns.add('Both independent visual and manager assessments are required.');
  for (const requirement of unresolvedRequirements) {
    if (typeof requirement !== 'string' || !requirement.trim()) throw new Error('Invalid unresolved requirement.');
    unknowns.add(`Unresolved requirement: ${requirement}`);
  }
  for (const report of reports) {
    if (!['ready', 'revise', 'blocked'].includes(report.decision) || typeof report.summary !== 'string' || !Array.isArray(report.defects) || !Array.isArray(report.unknowns) || !Array.isArray(report.techniques)) throw new Error('Invalid quality assessment.');
    for (const defect of report.defects) {
      if (![defect.component, defect.expected, defect.observed, defect.evidence].every(value => typeof value === 'string' && value.trim()) || !Number.isFinite(defect.timeSeconds) || defect.timeSeconds < 0) throw new Error('Invalid quality defect evidence.');
      defects.set(findingKey(defect), defect);
    }
    report.unknowns.forEach(item => { if (typeof item !== 'string') throw new Error('Invalid review uncertainty.'); unknowns.add(item); });
    const seen = new Set();
    for (const finding of report.techniques) {
      if (!techniques.some(item => item.id === finding.id) || seen.has(finding.id) || !['matched', 'defect', 'unverified'].includes(finding.status) || typeof finding.evidence !== 'string' || !finding.evidence.trim()) throw new Error('Invalid per-technique review.');
      seen.add(finding.id);
    }
    for (const technique of techniques) {
      const finding = report.techniques.find(item => item.id === technique.id);
      if (!finding) unknowns.add(`No assessment for ${technique.name}.`);
      assessments.push(finding || { id: technique.id, status: 'unverified', evidence: 'Required assessment was omitted.' });
    }
  }
  const coverage = techniques.map(technique => {
    const items = assessments.filter(item => item.id === technique.id);
    const status = items.some(item => item.status === 'defect') ? 'defect' : !items.length || items.some(item => item.status === 'unverified') ? 'unverified' : 'matched';
    if (status === 'defect' && ![...defects.values()].some(item => item.component === technique.id)) {
      const defect = { component: technique.id, timeSeconds: technique.start, expected: technique.expectedBehavior || technique.name,
        observed: 'Technique comparison failed.', evidence: items.filter(item => item.status === 'defect').map(item => item.evidence).join('; ') };
      defects.set(findingKey(defect), defect);
    }
    return { id: technique.id, name: technique.name, status, evidence: items.map(item => item.evidence) };
  });
  const hasDefects = defects.size > 0;
  const unresolved = coverage.some(item => item.status !== 'matched') || unknowns.size > 0 || reports.some(report => report.decision !== 'ready');
  return { version: 1, candidateDigest, decision: hasDefects ? 'revise' : !nativeVerified || unresolved ? 'blocked' : 'ready',
    summary: hasDefects ? 'Corrections are required.' : !nativeVerified || unresolved ? 'Required verification remains incomplete.' : 'All required comparisons passed.',
    defects: [...defects.values()], unknowns: [...unknowns], techniques: coverage, nativeVerified };
}

export function assertTechniqueContinuity(required, plan) {
  const missing = required.filter(item => !plan.techniques.some(next => next.id === item.id && next.name === item.name && next.expectedBehavior === item.expectedBehavior && JSON.stringify(next.checks) === JSON.stringify(item.checks)));
  if (missing.length) throw new Error(`A correction removed or weakened required techniques: ${missing.map(item => item.name).join(', ')}. Keep their IDs, names, expected behavior and checks.`);
}

/** Acceptance belongs to the controller; models revise implementation, not the rubric. */
export function retainTechniqueContract(required, plan) {
  const missing = required.filter(item => !plan.techniques.some(next => next.id === item.id));
  if (missing.length) throw new Error(`A correction removed required techniques: ${missing.map(item => item.name).join(', ')}.`);
  return { ...plan, techniques: plan.techniques.map(item => {
    const fixed = required.find(previous => previous.id === item.id);
    return fixed ? { ...item, name: fixed.name, expectedBehavior: fixed.expectedBehavior, checks: [...fixed.checks] } : item;
  }) };
}

export function qualityAction(report, iteration, budget) {
  if (report.defects.length) return iteration < budget ? 'repair' : 'exhausted';
  return report.decision === 'ready' && report.nativeVerified && report.techniques.every(item => item.status === 'matched') ? 'approve' : 'needs-evidence';
}
