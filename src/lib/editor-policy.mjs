/** Public configuration shared by the CLI worker, job receipts and workspace. */
export const editorPolicy = Object.freeze({
  model: 'gpt-6-astra',
  displayName: 'GPT-6 Astra',
  effort: 'medium',
  label: 'Lead Editor',
  access: 'Job-scoped local MCP editing; original projects protected',
});
