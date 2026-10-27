import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, win32, posix } from 'node:path';

export function platformPaths(platform = process.platform, home = homedir(), env = process.env) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('AI-Editor supports Windows and macOS.');
  const { join } = platform === 'win32' ? win32 : posix;
  return {
    drafts: env.AI_EDITOR_DRAFTS_ROOT || (platform === 'darwin' ? join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft') : join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')),
    capcut: env.AI_EDITOR_CAPCUT_PATH || (platform === 'darwin' ? '/Applications/CapCut.app' : join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'CapCut', 'Apps', 'CapCut.exe')),
  };
}

export function executableCandidates(name, { platform = process.platform, home = homedir(), env = process.env, cwd = process.cwd() } = {}) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(name)) throw new Error('Invalid tool name.');
  const path = platform === 'win32' ? win32 : posix;
  const filename = name + (platform === 'win32' ? '.exe' : '');
  const candidates = [path.join(cwd, '.local-tools', 'bin', filename)];
  if (name === 'codex' || name === 'codex-code-mode-host') {
    if (platform === 'win32') candidates.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs/OpenAI/Codex/bin', filename));
    else for (const apps of ['/Applications', path.join(home, 'Applications')]) for (const app of ['Codex', 'ChatGPT']) candidates.push(path.join(apps, `${app}.app/Contents/Resources`, filename));
  }
  if (platform === 'win32' && ['python', 'python3'].includes(name)) {
    for (const version of ['313', '312', '311', '310']) {
      candidates.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData/Local'), `Programs/Python/Python${version}/python.exe`));
      if (env.PROGRAMFILES) candidates.push(path.join(env.PROGRAMFILES, `Python${version}/python.exe`));
    }
  }
  for (const folder of (env.PATH || '').split(path.delimiter).map(folder => folder.replace(/^"(.*)"$/, '$1')).filter(path.isAbsolute)) candidates.push(path.join(folder, filename));
  if (platform === 'darwin') {
    candidates.push(path.join('/opt/homebrew/bin', filename), path.join('/usr/local/bin', filename));
    const python = /^python(3\.\d+)$/.exec(name);
    if (python) for (const prefix of ['/opt/homebrew', '/usr/local']) candidates.push(path.join(prefix, `opt/python@${python[1]}/bin`, filename));
  }
  return [...new Set(candidates)];
}

export function findExecutable(name) {
  return executableCandidates(name).find(existsSync) ?? null;
}

export function mediaTool(name) {
  const executable = findExecutable(name);
  if (!executable) throw new Error(`${name} is missing. Complete tool setup first.`);
  return executable;
}

export function codeModeHost() {
  const codex = findExecutable('codex');
  const sibling = codex && join(dirname(codex), `codex-code-mode-host${process.platform === 'win32' ? '.exe' : ''}`);
  // This probes an external installed binary, not a dependency to bundle.
  return sibling && existsSync(/* turbopackIgnore: true */ sibling) ? sibling : findExecutable('codex-code-mode-host');
}
