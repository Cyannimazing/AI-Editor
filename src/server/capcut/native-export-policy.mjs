import { join } from 'node:path';

export function nativeExportCommand(platform, { scriptRoot, requestPath }) {
  if (platform === 'win32') return { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-File', join(scriptRoot, 'native-ui-windows.ps1'), requestPath] };
  if (platform === 'darwin') return { executable: '/usr/bin/osascript', args: ['-l', 'JavaScript', join(scriptRoot, 'native-ui-macos.js'), requestPath] };
  throw new Error('Native export requires a supported desktop platform.');
}

export function validateExportProbe(probe, expected) {
  if (![expected.duration, expected.width, expected.height, expected.fps].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid export expectation.');
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Native export has no video stream.');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - expected.duration) > Math.max(0.15, 2 / expected.fps)) throw new Error('Native export duration differs from the candidate.');
  if (video.width !== expected.width || video.height !== expected.height) throw new Error('Native export resolution differs from the candidate.');
  const [num, den] = String(video.avg_frame_rate).split('/').map(Number), fps = num / den;
  if (!Number.isFinite(fps) || Math.abs(fps - expected.fps) / expected.fps > 0.01) throw new Error('Native export frame rate differs from the candidate.');
  return { duration, width: video.width, height: video.height, fps, hasAudio: probe.streams.some(stream => stream.codec_type === 'audio') };
}

export function exactTextTarget(state, text, region) {
  const normalize = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = (state.words || []).filter(word => normalize(word.text) === normalize(text)
    && (!region || word.x >= region.x && word.y >= region.y && word.x + word.width <= region.x + region.width && word.y + word.height <= region.y + region.height));
  if (!matches.length) throw new Error(`CapCut control not found: ${text}.`);
  if (matches.length !== 1) throw new Error(`CapCut control is ambiguous: ${text}.`);
  const item = matches[0];
  if (![item.x, item.y, item.width, item.height].every(Number.isFinite) || item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0 || item.x + item.width > state.width || item.y + item.height > state.height) throw new Error('CapCut control is outside window bounds.');
  return { x: Math.round(item.x + item.width / 2), y: Math.round(item.y + item.height / 2) };
}
