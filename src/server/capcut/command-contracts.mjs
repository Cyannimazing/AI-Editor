/** Validate the installed CLI boundary without echoing a possibly huge payload.
 * A successful exit is not proof that process.exit() flushed piped stdout.
 */
export function parseCommandContracts(output, expectedCommands) {
  const producer = `CapCut describe (${Buffer.byteLength(output)} bytes)`;
  let contract;
  try { contract = JSON.parse(output); }
  catch { throw new Error(`${producer}: invalid or incomplete JSON. Command discovery cannot continue; no partial contract was accepted.`); }
  if (contract?.name !== 'capcut-cli' || contract.schema_version !== 2 || typeof contract.version !== 'string'
    || !Array.isArray(contract.commands) || !contract.commands.length
    || contract.commands.some(command => !command || typeof command.name !== 'string' || !command.name
      || typeof command.summary !== 'string' || typeof command.usage !== 'string' || typeof command.mutates !== 'boolean')
    || new Set(contract.commands.map(command => command.name)).size !== contract.commands.length) {
    throw new Error(`${producer}: invalid command contract schema.`);
  }
  if (expectedCommands && (contract.commands.length !== expectedCommands.length
    || expectedCommands.some(name => !contract.commands.some(command => command.name === name && Array.isArray(command.options))))) {
    throw new Error(`${producer}: requested command contracts are incomplete.`);
  }
  return contract;
}
