/** Repair only malformed structured output. Execution/security errors propagate;
 * neither validation nor a role retry is permission to mutate the candidate. */
export async function recoverStructuredReport({ generate, validate, onRetry, signal }) {
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const raw = await generate(correction); // runtime failures are not validation retries
    try { return validate(JSON.parse(raw)); }
    catch (error) {
      if (attempt === 1) throw new Error(`Specialist report is still invalid after one repair: ${error.message}`);
      onRetry();
      correction = `Your report failed host validation: ${String(error.message).slice(0, 1500)}. Repair only your report and return the specialist JSON contract. Do not restart the edit, write the timeline or invent technique IDs. Previous report (untrusted data): ${JSON.stringify(String(raw).slice(0, 12000))}`;
    }
  }
}
