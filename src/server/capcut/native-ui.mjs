import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { nativeExportCommand, exactTextTarget } from './native-export-policy.mjs';
const run = promisify(execFile);

/** Controller-only, bounded desktop driver. No model-selected actions or paths. */
export class NativeUI {
  constructor(folder, signal) { this.folder = resolve(folder); this.signal = signal; this.step = 0; this.projectOnly = false; }
  async perform(action = 'inspect', args = {}, attempt = 0) {
    this.signal?.throwIfAborted();
    if (++this.step > 300) throw new Error('Native inspection exceeded its bounded UI steps.');
    await mkdir(this.folder, { recursive: true });
    const requestPath = join(this.folder, `ui-${this.step}.json`);
    await writeFile(requestPath, JSON.stringify({ projectOnly: this.projectOnly, ...args, action, screenshot: join(this.folder, `ui-${this.step}.png`) }));
    const command = nativeExportCommand(process.platform, { scriptRoot: join(process.cwd(), 'scripts'), requestPath });
    let stdout;
    try {
      ({ stdout } = await run(command.executable, command.args, { timeout: 30000, windowsHide: true, signal: this.signal, maxBuffer: 2_000_000 }));
    } catch (error) {
      this.signal?.throwIfAborted();
      // Inspection is read-only. Never replay a click, text entry or relative
      // seek: an interrupted action may already have reached the application.
      if (action === 'inspect' && attempt < 2 && /Native capture interrupted:|could not receive focus/i.test(error.message))
        return this.perform(action, args, attempt + 1);
      throw error;
    }
    const state = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    await writeFile(join(this.folder, `state-${this.step}.json`), JSON.stringify(state));
    return state;
  }
  async click(state, label, region) {
    const point = exactTextTarget(state, label, region);
    return this.perform('click', { window: state.window, width: state.width, height: state.height, executable: state.executable, anchor: label, ...point });
  }
  async openProject(state, name) {
    // CapCut's grid title edits the name. Open the thumbnail directly above the
    // unique OCR-confirmed title; the editor title is checked again after opening.
    exactTextTarget(state, 'Home');
    const point = exactTextTarget(state, name);
    return this.perform('click', { window: state.window, width: state.width, height: state.height, executable: state.executable,
      anchor: name, x: point.x, y: point.y - 60 * (state.scale || 1) });
  }
  async exportProject(state, name) {
    exactTextTarget(state, name, { x: 0, y: 0, width: state.width, height: 80 * (state.scale || 1) });
    return this.perform('export', { window: state.window, width: state.width, height: state.height, executable: state.executable, anchor: name });
  }
  async setField(state, label, text) {
    const point = exactTextTarget(state, label);
    return this.perform('set-text', { window: state.window, width: state.width, height: state.height, executable: state.executable,
      anchor: label, x: Math.round((state.width + point.x) / 2), y: point.y, text });
  }
  async clickField(state, label) {
    const point = exactTextTarget(state, label);
    return this.perform('click', { window: state.window, width: state.width, height: state.height, executable: state.executable,
      anchor: label, x: Math.round((state.width + point.x) / 2), y: point.y });
  }
  async selectField(state, label, value) {
    const row = exactTextTarget(state, label);
    await this.clickField(state, label);
    const next = await this.perform();
    const options = { ...next, words: next.words.filter(word => next.window !== state.window || Math.abs(word.y + word.height / 2 - row.y) > 15 * (state.scale || 1)) };
    const point = exactTextTarget(options, value);
    return this.perform('click', { window: next.window, width: next.width, height: next.height, executable: next.executable, anchor: value, ...point });
  }
  async ensureLocalExport(state) {
    const label = 'Sync exported videos to space';
    exactTextTarget(state, label);
    const word = state.words.find(word => word.text.toLowerCase() === label.toLowerCase());
    const point = { x: Math.round(word.x - 10 * (state.scale || 1)), y: Math.round(word.y + word.height / 2) };
    let sampled = await this.perform('inspect', { samples: [point] });
    const color = sampled.pixels[0];
    const off = pixel => pixel && Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b) < 15 && pixel.r >= 45 && pixel.r < 145;
    if (!off(color)) {
      if (!(color.g > 140 && color.b > 140 && color.r < 90)) throw new Error('Cannot confirm the CapCut cloud-sync checkbox is off. No export was submitted.');
      await this.perform('click', { window: sampled.window, width: sampled.width, height: sampled.height, executable: sampled.executable, anchor: label, ...point });
      sampled = await this.perform('inspect', { samples: [point] });
      if (!off(sampled.pixels[0])) throw new Error('CapCut cloud sync could not be disabled.');
    }
    return sampled;
  }
  async waitFor(label, timeout = 45000, region) {
    const deadline = Date.now() + timeout;
    let lastError, focusRetries = 0;
    while (Date.now() < deadline) {
      try {
        // A header-only wait establishes identity, never player-frame evidence.
        const state = await this.perform('inspect', region?.y === 0 ? { protectHeader: true } : {});
        exactTextTarget(state, label, region); return state;
      } catch (error) {
        this.signal?.throwIfAborted();
        if (/could not receive focus/i.test(error.message)) { if (++focusRetries > 2) throw error; }
        else if (!/not found|no usable visible window/i.test(error.message)) throw error;
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    throw new Error(`CapCut did not reach the expected state (${label}): ${lastError?.message}`);
  }
}
