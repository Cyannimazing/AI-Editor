/** Invocation-local transport configuration; never modify the user's Codex config.
 * Built-in provider IDs are reserved. This named OpenAI configuration retains
 * Codex-owned ChatGPT authentication/default endpoint and selects HTTP streaming.
 * Do not add API keys, alternate base URLs, or model overrides here.
 */
export function codexTransportArgs() {
  return [
    '--config', 'forced_login_method="chatgpt"',
    '--config', 'model_provider="ai_editor_https"',
    '--config', 'model_providers.ai_editor_https={name="OpenAI (ChatGPT HTTPS)",requires_openai_auth=true,supports_websockets=false,wire_api="responses"}',
  ];
}
