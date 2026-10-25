export const editingTools = [
  { name: "Remotion", role: "Animated motion, easing, keyframes, and moving graphics" },
  { name: "HyperFrames", role: "Static captions, titles, and graphic overlays" },
  { name: "FFmpeg", role: "Cuts, trims, color, audio mixing, and final encoding" },
  { name: "Groq", role: "Optional multilingual speech transcription and language understanding; requires an API key" },
] as const;

export function editingToolContext(groqConfigured: boolean) {
  return [
    "Reference-driven editing contract:",
    "1. When a reference video is attached, it is the sole source of the style. Inspect its full duration in time order, including the opening, transitions, ending, and audio. Do not use screenshots or unrelated project files as substitutes. When there is no reference, treat the user's text as a request, not an observation.",
    "2. Compare consecutive frames, not isolated attractive frames. Track fixed background landmarks and subject pose to separate digital scale/position keyframes, freeze frames, camera movement, and subject movement. Estimate keyframe times, start/end values, and easing only when the video supports them.",
    "3. Record every distinct confirmed technique with its visible or audible evidence, start/end times, and confidence. Preserve exact visible words, placement, animation, color treatment, cuts, and sound timing. Mark estimates and uncertainty. Never present a plausible guess as an observed fact.",
    "4. Build the edit in the selected CapCut project as editable timeline components where supported. Use Remotion for motion and animated graphics, HyperFrames for captions and graphic assets, and FFmpeg for cuts, channel/color processing, and audio work when those tools are needed. Use CapCut CLI to place the resulting layers and native keyframes in the draft. A generated asset may be a separate editable timeline layer; do not replace the whole timeline with a flattened preview.",
    `5. Groq is ${groqConfigured ? "available for speech or multilingual language understanding when the video actually contains speech" : "not configured; do not claim to have transcribed or understood speech"}. Do not invoke it for a clip without a language task.`,
    "6. Apply every checked technique or stop with a specific unsupported error before changing the project. Verify the draft and, where possible, its visual output against the reference before claiming success. State exactly which tools ran. Save a reusable recipe only when the user clicks Save.",
  ].join("\n");
}
