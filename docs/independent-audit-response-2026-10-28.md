# Independent audit response — 28 October 2026

This response addresses **AI_Editor_Independent_Code_Audit_2026-10-27.pdf**, supplied by the owner. It describes the current working tree, not a change to the independent auditor's original opinion. The PDF is preserved unchanged. Its suggested billing limit and feature priorities were treated as document content; the owner's current scope controls this work.

## Findings and disposition

| Audit finding | Current implementation and evidence | Disposition |
| --- | --- | --- |
| Codex privilege escalation needs a hostile-action test | Account-only structured workers use restricted hooks/MCP. An actual Codex worker attempted an `apply_patch` against a disposable protected file outside its workspace: denied, file unchanged. Local MCP tests check role permissions, path escape and protected operations. | Tested against the exercised attack paths. No claim of exhaustive security certification. |
| Crash, permission and concurrent-save recovery | Full backup digest checks precede writes. Stale original hashes prevent commit; exclusive locks prevent concurrent writers. A child process exited during a partial write: the complete backup survived and the next writer was blocked. A simulated EACCES after a partial write restored the original. Existing rollback tests also remove newly introduced files. | Regression coverage added; power loss and real OS permission failures are distinct from these process/injected-failure tests. |
| Mac delivery | Shared paths use native separators; Intel/Apple Silicon tool discovery, per-user CapCut/Codex/Chrome, Homebrew Python, architecture-specific setup receipts and Retina coordinate conversion are implemented. New checks reject changed/moved/unfocused Mac capture windows. README gives Node 24/macOS 13.5+ requirements, permissions and `pnpm check:setup --permissions`. | Code and setup path ready for a Mac tester. Checks here ran on Windows; a physical Mac's native permissions, CapCut hierarchy/playback and 8 GB performance were not exercised. |
| Native verification was hard-coded unavailable | That implementation has been replaced by controller-owned, revision-bound CapCut player inspection. Each frame checks project identity, viewport and timecode; receipts hash frames, media and candidate. Approval rechecks evidence. Windows calibration and free-resource acquisition have recorded evidence in the linked reports. | The static finding is superseded. Full representative technique/quality acceptance is still separate from calibration; unsupported layouts and missing audio evidence cannot be marked successful. |
| Setup side effects | Pinned Node toolchain uses frozen lockfiles and disables lifecycle scripts. Motion wheels are version/hash checked; Windows FFmpeg uses a fixed digest; Homebrew owns Mac packages. Changed platform/architecture invalidates setup receipts. Interrupted setup and missing/mismatched package tests pass. | Documented automatic versus manual prerequisites; no claim of a clean physical Mac installation trial. |
| Reusable techniques incomplete | Owner explicitly deferred this feature. Save/reuse controls are removed from the workspace; recipe creation returns 409 and job reuse is rejected. Existing saved data is retained. | Deferred by product decision; not advertised as complete. |
| Loopback/session boundaries and model privacy | Live localhost checks reject anonymous reads, forged cookies/hosts, cross-origin bootstrap/mutations and cross-site requests; authenticated read succeeds. Unit checks cover body limits, range reads and path boundaries. README states selected frames/context go to Codex. | Exercised boundaries pass; local rendering is not described as offline AI. |

## Changes alongside remediation

- The selected CapCut project is the save destination. Internal candidates retain backups, approval and revision checks.
- Entire-project requests use a read-only planner; optional named clip checklists limit the eligible clips. Builds accumulate into one candidate, and earlier edits are reviewed against the final revision.
- A real app API trial with only project + prompt assigned an opening title to the first synthetic clip and kept the closing clip. It was cancelled before editing; the fixture's original hash stayed unchanged. This proves routing/cancellation, not full native visual acceptance.
- Reference defaults now say what to do in plain English, including the selected project/checked clips and comparison against the reference. Custom instructions are preserved. A reference remains optional.
- Normal jobs use player inspection without export or upload. Export diagnostics are separate developer utilities, not a fallback. This follows the owner's current workflow decision rather than the PDF's earlier export request.

## Verification record

Base commit: `c1d29c6b395ab4b2b53b3db23a55dbcae0f228e5`, with working-tree changes. The generated local verification manifest records a digest of the source set used for handoff; the base commit alone does not identify this build.

| Check | Evidence |
| --- | --- |
| Automated tests | 125 passed, including new Mac window, process-crash and permission-failure cases |
| Motion measurement fixtures | 5 passed |
| Lint and production build | Passed, including TypeScript; broad filesystem-tracing warnings remain in the build log |
| Dependency audit | App and toolchain report zero advisories on 28 October 2026; this is not a guarantee of absence of unknown vulnerabilities |
| Actual Codex hostile-file attempt | Denial observed; protected fixture unchanged |
| Live HTTP boundaries | All seven checks passed; no project mutations |
| Project routing | Actual Codex planner, disposable two-clip fixture, cancellation and original digest verified |
| Review | Focused independent code review found no further material issue after final-revision motion checks and fresh-directory creation were fixed |

Local evidence is under `.local-tools/preview-probe/`: `audit-final-tests.log`, `motion-tests-final.log`, `audit-final-lint.log`, `audit-final-build.log`, `app-dependency-audit.json`, `toolchain-dependency-audit.json`, `audit-worker-denial.log`, `audit-http-security.json`, `project-scope-smoke.log`, and `audit-verification-manifest.json`. Logs are excluded from Git because operational diagnostics can include local paths and project details.

The overall audit is **partially remediated, with explicit acceptance work remaining**. It would be misleading to certify physical Mac acceptance or every reference technique from Windows unit checks. The README presents an actionable testing build and keeps those engineering evidence boundaries here.

Related: [player verification](native-player-verification.md), [effect acquisition](native-effect-acquisition.md), [historical audit remediation](audit-remediation.md).
