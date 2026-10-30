# Project discovery and compatibility reports

## Findings

The Windows project folder contained `Trial101` and `Verify 64358947`. The latter carries the application's `temporary-review` marker, so the default picker intentionally excluded it. Both were readable in the local investigation. `Trial101` had an empty saved timeline. The old UI did not explain that its checkbox also reveals temporary review copies.

Discovery now reports hidden copies, missing/unreadable roots and unreadable child folders. Genuine user projects are never hidden merely because their name starts with “Verify”. Existing temporary copies can be revealed and are explicitly labelled; no project is deleted or changed by discovery.

The supplied Mac screenshot shows an older native-capture workflow failing the CLI version boundary for CapCut 18.2. Its working preview is not evidence that the native copy is valid. The current file-and-preview workflow does not open, close or inspect CapCut, and refuses incompatible original writes before editing. Older failed jobs are not automatically approved.

## What your Mac tester should send

1. Pull the update, restart AI-Editor and refresh the browser.
2. Select the **original disposable test project**, then click **Download compatibility report**. Send `ai-editor-compatibility.json`.
3. If the older Verify copy still exists, enable **Show temporary review copies and test projects**, select it and download its report too. Keep the downloads separately labelled when sending them.

No job ID, terminal commands, screenshots of private paths or full media upload are needed for these reports. Collection does not open CapCut, run an AI edit or write project files.

The original report identifies format markers and saved native timing/curves. Comparing the Verify report identifies missing or inaccessible references left by the older publication flow. `readable` means the AI-Editor process can access a file; it does not establish CapCut permissions or codec support. The report does not contain source video, captions, project names or personal paths. Numeric motion/timing data is included; large reports explicitly mark truncation.

## What is still required for CapCut 18.2 support

Do not pass `--force-write`, remove version markers or downgrade schema numbers. The pinned CLI has not established that it can safely round-trip this format.

After reviewing the reports, format work may require **sanitized disposable project documents saved by CapCut itself**, before and after manually adding a native 100%–130% zoom. The tester's Codex can use the installed `capcut fixture` command to collect this separately, following its actual `--help` and `--check` contract. Use harmless disposable footage/text and review the bundle before sharing: the upstream fixture sanitizer removes common personal paths/device identifiers, but its timeline JSON can retain captions and names. The app's compact compatibility report is deliberately narrower and cannot replace that full schema fixture.

An adapter must preserve unknown fields/envelopes, pass round-trip tests and be opened on the actual Mac before writes for that version are enabled. Current reports make the investigation practical; they do not certify 18.2 support or repair an already incomplete Verify copy.

## Verification

- Seven disposable regressions cover marked-copy filtering/reveal, corrupt and inaccessible project folders, read-only 18.2 reporting, private-data exclusion, media readability, cancellation, report size bounds and malformed-record handling.
- The production browser test checks the actual local project list and reveal checkbox, downloads a report from a synthetic 18.2 fixture, checks unauthenticated/traversal rejection and confirms that no editing or desktop-control requests occur.
- Final Windows checks: 188 tests discovered, 186 passed, two platform skips; lint and production/TypeScript build passed. The live localhost:3000 API reported two saved projects and one hidden review copy.
- No original project was modified and no CapCut window was operated. Actual Mac playback/format acceptance remains a separate trial.

Rerun with `pnpm test`, `pnpm lint` and `pnpm build`. Focused check: `node --experimental-strip-types --test scripts/project-discovery.test.mjs`.
