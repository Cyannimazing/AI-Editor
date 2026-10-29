# Mac compatibility report follow-up — 29 October 2026

The supplied `MAC_COMPATIBILITY_REPORT.md` identified two reproducible defects and one cancellation test that passed 20 reruns on the reporter's Mac. These changes address those boundaries without changing editing plans or starting CapCut.

## Command inventory

The pinned CapCut CLI 0.31.1 writes its output and immediately calls `process.exit(0)`. Full discovery is 125,842 bytes here; the report observed exactly 65,536 bytes through a Mac pipe. Increasing the parent's buffer cannot recover bytes the producer never flushed.

Startup now requests the supported `describe --compact` index (17,725 bytes with the current package). It retains all 88 commands, their summaries, usage and mutation flags. Detailed positionals/options remain available through the existing per-topic `describe --command` calls; all six topics were checked against the installed CLI. Keyframe properties and resource catalogs are still inspected directly from the pinned package.

A shared parser validates producer, schema, unique command names and requested detailed contracts. Malformed output reports the producer and byte count without printing the payload or accepting a partial contract. Regression tests exercise simulated 64 KiB truncation through the actual inventory process, complete output above 64 KiB, and useful rejection diagnostics. No dependency or lockfile change is required.

## Generated resource packaging

macOS may expose its temporary directory through `/var` while `realpath()` resolves it under `/private/var`. Packaging now walks the original resource components until it reaches the canonical job-store boundary. It does not walk into system aliases above that boundary.

Walking only the canonical source would hide links inside the store, so the original components are still checked. Tests accept aliased/canonical root combinations and reject linked resources, linked internal parents, a link back to the store root, parent traversal and linked bundle dependencies. Complete effect bundles and retained asset sources continue to be copied into the review project.

## Cancellation

The original Mac cancellation failure remains unconfirmed: the reporter's 20 reruns passed. A deterministic fixture here reproduced the same `pid > 0` assertion failure when an ordinary diagnostic line overwrote the test's PID. Both stdout and stderr are delivered to the callback; every line cannot be treated as a PID.

The test now consumes an explicit `READY <pid>` marker and ignores unrelated diagnostics. Production cancellation and process-group termination are unchanged. A POSIX descendant-process regression was added for Mac/Linux runs, alongside the Windows tree-cancellation test. The POSIX test is explicitly skipped on Windows.

## Mac rerun

Use an updated checkout containing these changes and the existing pinned setup. From the repository root:

```sh
node scripts/inspect-editing-tools.mjs > /tmp/ai-editor-inventory.json
node --experimental-strip-types --test scripts/ai-context.test.mjs scripts/cancellable-process.test.mjs scripts/capcut-plugin.test.mjs
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Repeat cancellation independently, stopping on the first failure:

```sh
for run in $(seq 1 20); do
  node --experimental-strip-types --test scripts/cancellable-process.test.mjs || break
done
```

The Windows-only cancellation test is an expected Mac skip. The optional official-builder integration test also skips if its pinned plugin or Python is absent. Record these reasons rather than treating a skipped integration as a pass. A disposable native CapCut trial follows the code checks and setup readiness checks; the Windows results below do not establish Mac permissions or player behavior.

Local verification results are recorded in `docs/audit-remediation.md`. The supplied report and original media were not modified. The local server remains stopped.
