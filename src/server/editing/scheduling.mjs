import { createHash } from 'node:crypto';

export function specialistAssignments(plan, { referenceVideo = false, request = '', hasAudio = false } = {}) {
  const assignments = [];
  const requested = request.replace(/\b(?:no|without|do not add|don't add)\s+[^.!?;\n]*?(?=\bbut\b|[.!?;\n]|$)/gi, ' ');
  // Preservation is a constraint, not a request for new sound design. Strip
  // only the preservation phrase so a later "but add music" remains actionable.
  const audioPreservation = /\b(?:audio|sound|music|soundtrack)\s+(?:unchanged|intact|as[- ]is)\b|\bpreserve\s+(?:the\s+)?(?:(?:original|source|existing)\s+)?(?:audio|sound|music|soundtrack)\b/gi;
  const negatesPreservation = /\b(?:don't|do not|never)\s+(?:keep|leave|preserve)\b/i.test(requested);
  const preservesAudio = !negatesPreservation && Boolean(requested.match(audioPreservation));
  const audioRequest = negatesPreservation ? requested : requested.replace(audioPreservation, ' ')
    .replace(/\b(?:audio|sound|music|soundtrack)\s+duration\s+unchanged\b/gi, ' ');
  const layers = [plan.source, ...plan.texts, ...(plan.overlays || [])];
  if (referenceVideo || plan.effects?.length || plan.overlays?.length || layers.some(layer => layer.keyframes.length)) assignments.push('motion');
  if (plan.texts.length || /\b(captions?|subtitles?|typography|wording)\b/i.test(requested)) assignments.push('captions');
  if (plan.audio?.clips?.length || /\b(audio|sound|music|beat|speech|voice|mix)\b/i.test(audioRequest) || hasAudio && (referenceVideo && !preservesAudio || plan.source.volume !== 1 || plan.source.keyframes.some(frame => frame.property === 'volume'))) assignments.push('audio');
  return assignments;
}

export function specialistCacheKey(role, plan, evidence, feedback) {
  return createHash('sha256').update(JSON.stringify({ role, plan: specialistPlanView(role, plan), evidence, feedback: specialistFeedback(role, feedback) })).digest('hex');
}

// Audio measurements are unchanged when a visual correction moves a graphic or
// resizes text. Unknown feedback remains relevant: never guess away a failure.
export function specialistFeedback(role, feedback) {
  if (role !== 'audio') return feedback;
  if (feedback === 'Analyze the reference before building.') return '';
  try {
    const defects = JSON.parse(feedback);
    if (!Array.isArray(defects)) return feedback;
    const relevant = defects.filter(defect => {
      const words = `${defect.component} ${defect.expected} ${defect.observed}`;
      if (/\b(audio|sound|music|beat|sync|volume|speech|voice|mix|silence|loudness)\b/i.test(words)) return true;
      return !/\b(text|overlay|cloud|graphic|font|typograph|wording|shape|position|size|scale|entrance|blur|color|colour|opacity|rotation)\b/i.test(words);
    });
    return relevant.length ? JSON.stringify(relevant) : '';
  } catch { return feedback; }
}

export function specialistPlanView(role, plan) {
  const { summary: _summary, resourceQueries: _queries, unsupported: _unsupported, ...implementation } = plan;
  void _summary; void _queries; void _unsupported;
  if (role === 'audio') return { source: { volume: plan.source.volume, keyframes: plan.source.keyframes.filter(frame => frame.property === 'volume') },
    audio: plan.audio,
    techniques: plan.techniques.filter(technique => /\b(audio|sound|music|beat|sync|volume|speech|voice|mix|silence|loudness)\b/i.test(JSON.stringify(technique))) };
  if (role === 'captions') return { texts: plan.texts, overlays: plan.overlays || [], assets: plan.assets || [],
    techniques: plan.techniques.filter(technique => !technique.components || technique.components.some(ref => ref.startsWith('text-'))) };
  return implementation;
}

export const specialistSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'findings'], properties: {
    summary: { type: 'string' }, findings: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['techniqueId', 'component', 'priority', 'issue', 'proposedChange', 'evidence'], properties: {
        techniqueId: { type: 'string' }, component: { type: 'string' }, priority: { type: 'string', enum: ['required', 'suggestion'] },
        issue: { type: 'string' }, proposedChange: { type: 'string' }, evidence: { type: 'string' },
      },
    } },
  },
};

export function validateSpecialistReport(report, plan) {
  if (!report || typeof report.summary !== 'string' || report.summary.length > 4000 || !Array.isArray(report.findings) || report.findings.length > 80) throw new Error('Invalid specialist report.');
  for (const item of report.findings) {
    if (!plan.techniques.some(technique => technique.id === item.techniqueId)) throw new Error(`Invalid specialist finding: techniqueId must be one of ${plan.techniques.map(technique => technique.id).join(', ')}. Return findings=[] if no supported finding applies.`);
    if (!['required', 'suggestion'].includes(item.priority) ||
      !['component', 'issue', 'proposedChange', 'evidence'].every(key => typeof item[key] === 'string' && item[key].trim() && item[key].length <= 4000)) throw new Error('Invalid specialist finding.');
  }
  return report;
}
