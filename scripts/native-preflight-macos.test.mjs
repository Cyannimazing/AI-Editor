import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeUI } from '../src/server/capcut/native-ui.mjs';

// Intentionally exercises the real osascript bridge on Mac. A boolean denial is
// valid here; a missing API, bridge exception or screenshot side effect is not.
test('real macOS JXA can query permission status without a CapCut project or permission grant',
  { skip: process.platform !== 'darwin', timeout: 35000 }, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ai-editor-native-preflight-'));
    try {
      const state = await new NativeUI(folder).perform('permission-status');
      assert.equal(state.platform, 'darwin');
      assert.equal(typeof state.accessibility, 'boolean');
      assert.equal(typeof state.screenRecording, 'boolean');
      assert.ok(['framework', 'explicit'].includes(state.screenCaptureBinding));
      assert.ok((await readdir(folder)).every(name => name.endsWith('.json')), 'No screen pixels may be captured by preflight');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
