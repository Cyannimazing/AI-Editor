# Preview review without desktop control — implementation plan

> For agentic workers: implement sequentially with executing-plans; review the complete patch before handoff.

Goal: follow the user's explicit change to review the existing preview and native project files, without opening or closing CapCut from the application.

Architecture: normal jobs use an explicit preview review mode, with separately labelled native-rendering limits. Controller-sealed evidence binds the candidate, preview, checks, assets and independent assessments. Writes still require approval, unchanged originals, backups and a read-only CapCut process check. Missing permissions cannot trigger native review because desktop review is no longer in the normal graph.

Stack: existing Next.js/TypeScript, Node24, local CLI, FFmpeg and HyperFrames. No new dependencies.

## Scope and constraints

- Keep account authentication, worker restrictions, bounded correction loops and original protection.
- A preview pass is not native CapCut verification. Missing techniques/resources and actual defects still block approval.
- Use the last saved timeline; reject a changing snapshot rather than sending Quit or Save.
- No automatic effect acquisition that opens CapCut. Reuse installed resources and report missing packages.
- Do not add reusable techniques or new cloud/export workflows.

## Steps

- [x] Reproduce preview readiness rejection and add receipt-integrity/process-status tests.
- [x] Separate preview evidence/readiness from native evidence in quality, review and loop modules. Preserve independent review and correction rules.
- [x] Remove desktop operations from preparation, effect discovery, approval and application opening actions. Keep a running-app Apply failure retryable.
- [x] Recheck earlier clip evidence against the final project interval and revision before combined approval.
- [x] Update UI, worker context, setup and README with the new workflow and evidence boundaries.
- [x] Run regression suite, lint, build and disposable controller/API checks; obtain code review; update audit and saved context; push the verified change.

## Review focus

- Candidate, preview, asset or quality-report changes after review must invalidate approval.
- A valid preview must never claim nativeVerified=true.
- Missing effects or incomplete reviewer coverage must never become a successful edit.
- CapCut running at Apply must preserve candidate readiness and never dispatch quit/open.
- Earlier clips must not reuse stale visual evidence after an overlapping integration change.

Validation: 181 discovered /179 passed /2 platform skips; lint and build passed. Synthetic Mac UI and authenticated localhost legacy-action checks passed. Review findings resolved. Actual CapCut18.2 support remains a separate evidence requirement; no override is authorized.
