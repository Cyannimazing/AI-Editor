import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, win32, posix } from 'node:path';

export function browserCandidates({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') return [env.AI_EDITOR_BROWSER_PATH,
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  return [env.AI_EDITOR_BROWSER_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')].filter(Boolean);
}

export function previewBrowser(root = process.cwd()) {
  let cached;
  try {
    const receipt = JSON.parse(readFileSync(join(root, '.local-tools/preview-browser.json'), 'utf8'));
    if (receipt.platform === process.platform && receipt.arch === process.arch) cached = receipt.executablePath;
  } catch { /* First setup, interrupted download or a copied checkout. */ }
  return [...browserCandidates(), cached].filter(Boolean).find(path => {
    try { return isAbsolute(path) && existsSync(path) && statSync(path).isFile(); } catch { return false; }
  }) || null;
}
