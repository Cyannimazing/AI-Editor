import test from 'node:test';
import assert from 'node:assert/strict';
import { codexTransportArgs } from '../src/server/codex/transport.mjs';

test('HTTPS workers retain ChatGPT-only auth and leave the selected model and default endpoint alone', () => {
  const args = codexTransportArgs();
  const config = args.filter((_, index) => index % 2 === 1).join('\n');
  assert.ok(args.filter((_, index) => index % 2 === 0).every(arg => arg === '--config'));
  assert.match(config, /forced_login_method="chatgpt"/);
  assert.match(config, /requires_openai_auth=true/);
  assert.match(config, /supports_websockets=false/);
  assert.match(config, /wire_api="responses"/);
  assert.match(config, /model_provider="ai_editor_https"/);
  assert.ok(!/base_url|env_key|bearer_token|auth\.command|api_key|^model=/mi.test(config));
  assert.ok(!config.includes('model_providers.openai='), 'reserved built-in provider IDs are not overwritten');
  assert.deepEqual(codexTransportArgs(), args);
});
