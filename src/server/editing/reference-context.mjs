/** Map each attached contact sheet to the actual frame times the host extracted. */
export function referenceEvidenceContext(reference, index) {
  if (!reference.frames.length) return 'Reference: none. Follow the user instructions; do not invent observed reference techniques.';
  if (!index) return 'Reference: still image(s). Analyze visual composition only; motion, timing and audio cannot be established from a still.';
  const sheets = reference.frames.map((path, imageIndex) => {
    const sheet = index.sheets.find(item => item.path === path);
    if (!sheet || !Number.isInteger(sheet.firstFrame) || sheet.firstFrame < 1) throw new Error('Reference contact-sheet timing metadata is missing.');
    return { attachedImage: imageIndex + 1, layout: sheet.layout,
      timesSeconds: index.frames.slice(sheet.firstFrame - 1, sheet.firstFrame - 1 + 36).map(frame => frame.time) };
  });
  return JSON.stringify({ kind: 'video', durationSeconds: index.duration, nativeFps: index.nativeFps, sampleFps: index.sampleFps,
    sampling: index.sampling, audioExtracted: Boolean(index.audioPath),
    audioEvidence: 'Audio extraction is not a transcript or listening evidence. Do not infer sound from contact sheets.', sheets });
}
