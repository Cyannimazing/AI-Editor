# Clip preparation and downloadable diagnostics — 29 October 2026

The Mac tester's screenshots show preparation stopping before any AI editing session with “The extracted clip did not match its timeline duration.” The screenshots do not contain the measured duration or source probe, so they do not establish the exact cause for that file.

## Reproduced defect and repair

The previous extraction inherited the source's frame rate, then compared the MP4 container duration against the CapCut interval with a fixed 100 ms allowance. A disposable 5 FPS source reproduces the failure: a 2.21-second timeline interval produces a 2.40-second working file because its last video frame spans a longer interval.

The controller now prepares that working file at the project's frame rate, then checks both its video-stream duration and container duration. The allowance is one project frame plus 25 ms for audio packet quantization. A genuinely short source still fails; the app does not pad missing footage to pass the check. Preparation is isolated in `src/server/editing/clip-extraction.mjs`; native project writes and approval remain in their existing services. Original media files and selected timeline values are not modified during preparation.

The service records source and prepared stream duration, start time, average/nominal FPS, time base, frame counts, audio layout and the source/target interval in a job-local `clip-extraction-report.json`. Failure messages show expected/prepared durations and tolerance. This replaces the previous message without numbers.

## What the tester does

1. Update the app and restart it.
2. Retry the same selected-clip 100%–130% zoom request.
3. If preparation fails, click **Download diagnostics** in Editing progress and send that JSON report. The app selects the current run automatically; no job-ID lookup, FFprobe command or draft-file inspection is required.

**Show diagnostic details** now includes structured measurements and redacted stack frames. Downloaded reports contain runtime/failure information without the prompt, full transcript, media or original media paths. Generic error prose stays in the local app because it can quote requested captions; the export uses safe failure classifications. Known credential patterns and local home/workspace prefixes are redacted. Older failed runs cannot recover measurements that were never saved; the report explains when a retry is needed.

## Verification

`pnpm test:clips` runs the focused extraction/diagnostic regressions and is also included in `pnpm test`.

Disposable tests cover low FPS, variable FPS, fractional project FPS, constant-speed/reverse preparation, audio presence, unchanged original bytes/timing, rejection of materially missing footage, and diagnostic redaction. The low-FPS working clip is passed through the application's real controlled compiler: both native scale-axis curves retain editable 1.0 and 1.3 endpoints over the original 2.21-second timeline, with no text or effect tracks.

A Windows browser trial used a disposable project with a deliberately short source. **Run** displayed expected 2.000000s / prepared 1.000000s, diagnostic mode showed the structured report, and **Download diagnostics** saved the expected JSON. Anonymous download returned 401, cross-origin access returned 403 and an authenticated download returned 200. The fixture draft/media hashes remained unchanged, and no AI editing worker or CapCut desktop operation was started for the failing preparation.

All 140 Node tests were discovered on Windows: 139 passed and the POSIX-only test skipped. Lint and the production build including TypeScript passed. Existing Node module-type and broad build-tracing warnings remain. Evidence is retained under `.local-tools/preview-probe/mac-clip-*` and `diagnostics-ui-receipt.json`. These checks reproduce and repair a preparation defect; the tester's exact Mac media and native playback still require the next app run.
