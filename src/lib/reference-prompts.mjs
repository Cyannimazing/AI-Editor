export const referenceDefaults = {
  video: 'Study the reference video’s editing techniques and reproduce them on my footage, adapting to my subject instead of cloning the scene. Measure timing, keyframe movement, easing, overshoot, rebound, text/graphic motion, transitions and effects. Fill the intended picture area before animating it. Preserve the reference’s energy; do not simplify it to a plain static edit. Use local tools to generate needed assets and build editable native layers and controls. Compare the result and correct missing or inaccurate techniques. Keep unrelated content unchanged and explain unresolved evidence or tool gaps.',
  image: 'Study the reference image’s layout, typography, colors, framing and visual hierarchy. Transfer those visual techniques to my footage, adapting to my subject and canvas rather than cloning the scene. Use editable native controls and keep the intended picture filled. Do not infer motion, timing or audio from a still image. Keep unrelated content unchanged and explain limitations.',
  link: 'Inspect the accessible media at this public reference link. Identify its editing techniques, with timestamps for video. Transfer those techniques to my footage, adapting to my subject rather than cloning the scene. Preserve the observed movement and energy using editable native controls. Explain inaccessible content and unsupported techniques; do not invent missing motion, audio or wording.',
};

export function suggestedReferencePrompt(kind) { return referenceDefaults[kind] || ''; }

/** Changing a reference may replace our suggestion, but never the user's custom text. */
export function updateReferencePrompt(current, kind) {
  return !current.trim() || Object.values(referenceDefaults).includes(current) ? suggestedReferencePrompt(kind) : current;
}
