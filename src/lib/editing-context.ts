export const editingTools = [
  { name: "GSAP / HyperFrames", role: "Local graphics and animation design" },
  { name: "Remotion", role: "Optional local compositions when licensing permits" },
  { name: "FFmpeg", role: "Local frame, audio and timing analysis" },
] as const;
export function editingToolContext() {
  return "Follow ai/contract.md and your role context. Use installed task-relevant tools only. No paid services, cloud transcription, package installation or desktop control by workers. Preserve native editable text, transforms and timing. The host reviews saved controls and the approximate preview. No automatic native player review or CapCut opening/closing is performed; never claim native playback verification.";
}
