# Project memory

## Confirmed decisions

- Backend Architect leads project guidance, supported by Test Automation Engineer and Application Security Engineer; selection is recorded in project.json.
- Keep the local Codex account workflow, editable CapCut components, approval and original-project protections. No paid services or media uploads.
- The app's lead editor uses GPT-6 Astra with medium reasoning by default and the existing bounded high escalation; focused specialist/reviewer models stay unchanged. This is independent of the development chat's model.

## Current work

- 2026-10-29: addressed the supplied Mac report with compact CLI inventory and bounded contract diagnostics, canonical job-boundary packaging checks, and readiness-based cancellation tests.
- Returned Mac log: 130 passes, one large-output fixture failure, two skips. The original inventory, cancellation/POSIX descendants and resource packaging tests passed. No Mac lint/build/native CapCut result was included.
- Fixed the fixture's EAGAIN handling with bounded partial-write retries and a reproducing regression. Fresh Windows checks: 133 tests passed, one POSIX-only skip; lint/build passed.
- Follow-up and Mac commands: docs/macos-compatibility-fixes-2026-10-29.md. Local server remains stopped.
- First Mac edit failed before AI work on clip duration, without timing diagnostics. Reproduced a low-FPS frame-quantization defect; preparation now uses project FPS, validates video/container timing and retains a structured receipt. Exact Mac media cause still needs its next app run.
- Added current-job Download diagnostics and structured diagnostic view; browser/API trial verified access controls and unchanged disposable source/draft. Export excludes arbitrary error prose that may quote captions. Windows: 139 tests passed, one POSIX-only skip; lint/build passed. Focused native compiler fixture retained editable 100%–130% endpoints. See docs/clip-duration-diagnostics-2026-10-29.md.
- 2026-10-30: returned Mac audit supplies actual timing: 15.866666s source/target interval, 10.471667s original video and 10.533333s prepared video. Missing footage rejection is correct; why the timeline/material mapping disagrees remains unresolved. No extraction behavior was changed for this audit.
- Shared public editor policy now feeds CLI worker, workspace label, result metadata and live MCP smoke. Astra was listed by the signed-in account; a disposable live trial completed four MCP calls and native X/Y keyframe read-back. Fresh Windows checks: 139 passed, one POSIX-only skip, lint/build passed; static review had no runtime/security blockers. Local server remains stopped.
- Subsequent timing investigation reproduced an app-reader defect: stale draft_content at15.866666s could override the CLI's canonical10.471667s document. The app now shares the CLI reader and captures parsed/raw content atomically. Explicit speed resolves missing/unretimed source ranges; ambiguity and missing footage fail before extraction with hashed provenance. Review found two consistency/ambiguous-speed issues; both were reproduced and repaired. Exact failed Mac draft is still absent.
- Supplied Desktop video matches audit (10.471667s/315frames). Read-only source + disposable extraction/compiler trial produced native10471667us duration with editable100→130% X/Y keys, audio present and original SHA unchanged; no desktop opening. See duration-audit-source-trial.json in local preview evidence.
- Final selected-project trial resolved stale15.866666s mirror to canonical10.471667s and merged editable zoom with unchanged source-project/source-file hashes. Final Windows checks:153 passed, one POSIX-only skip; lint/build passed. Numeric diagnostic fields reject arbitrary malformed text; neutral CLI1x companion does not override explicit segment speed. See timing-selected-clip-trial.json and docs/audit-remediation.md.

## Next step

- Push the verified timing repair as requested. Tester updates/restarts and retries the existing selected project/clip; share Download diagnostics if it still fails. No manual IDs, FFprobe or replacing footage as an app-reader workaround.
