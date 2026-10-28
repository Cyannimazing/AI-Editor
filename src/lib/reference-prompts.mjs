export const referenceDefaults = {
  video: 'Watch the reference video and apply its editing techniques to the selected project or checked clips. Recreate the timing, keyframe movement, text, effects and sound where appropriate for my footage. Fill the frame as intended, keep the layers editable, and compare the result with the reference to correct mistakes. Preserve unrelated content and explain anything that could not be reproduced.',
  image: 'Use the reference image to guide the layout, text style, colors and framing in the selected project or checked clips. Adapt the design to my footage, keep the layers editable, and preserve unrelated content. A still image does not show movement or sound, so do not invent those details.',
  link: 'Review the video or image at this reference link and apply its editing techniques to the selected project or checked clips. Adapt the techniques to my footage, keep the layers editable, and compare the result with the reference. Preserve unrelated content and explain anything that cannot be viewed or reproduced.',
};

export function suggestedReferencePrompt(kind) { return referenceDefaults[kind] || ''; }

/** Changing a reference may replace our suggestion, but never the user's custom text. */
export function updateReferencePrompt(current, kind) {
  return !current.trim() || Object.values(referenceDefaults).includes(current) ? suggestedReferencePrompt(kind) : current;
}
