# Preview review without opening or closing CapCut

This replaces the normal desktop-review workflow at the user's request.

## What changed

Run reads the saved selected project, builds a private candidate and renders the app preview. File checks and the independent visual reviewer/quality manager still drive bounded corrections. The app never opens, closes, captures or exports CapCut during Run, review or Apply. The Inspect temporary review copy button is removed, and old opening endpoints refuse desktop control.

Approval is explicitly file-and-preview review, not native playback verification. Its receipt binds the candidate, source media, fonts, effect packages, preview, structural checks and both assessments. Inputs are hashed before rendering and rechecked after review. Changes invalidate approval. Overlapping visual components and transitions omitted by the renderer prevent a false pass. Existing free effect packages and official discovery remain available; automatic downloads that opened CapCut are disabled.

When the preview checks pass and you are happy with it, Apply saves to the selected project. Save and close CapCut manually before Apply. A read-only process check retains the candidate if CapCut is running; it never sends Quit/Open. If the original changed, run a fresh edit. Backups, journaled rollback and original checks remain. A failed prerequisite before the first write must not restore an old backup over a concurrent save.

Normal editing requires no macOS Accessibility, Screen Recording or Automation permissions. The optional diagnostic remains available for separate developer investigations.

## The reported failures

The earlier automatic Quit command was intended to flush autosaves for a stable snapshot, followed by desktop rendering inspection. The supplied error did not expose enough AppleScript output to identify its exact OS failure. That command is now absent from the normal flow, rather than caught and ignored.

The later screenshot shows a temporary Verify project with raw.mp4 marked File not accessible. This establishes a media-access problem in that copy, not a codec diagnosis. Generated working media is packaged into the selected project's assets on Apply; a regression checks that the packaged path still reads after the working folder is removed. Actual macOS file privacy, the failed copy's stored path and its on-disk bytes cannot be established from a screenshot.

## CapCut 18.2 compatibility

The installed capcut-cli is 0.31.1. Its upstream write guard considers CapCut versions beyond 9.x outside its evidence range. The [upstream changelog](https://github.com/renezander030/capcut-cli/blob/master/CHANGELOG.md) explains the guard and its version/schema checks. The range is not a guarantee that every 6.x–9.x configuration has been tested.

This update does not widen the guard, erase version markers or force writes. A read-only check now rejects incompatible selected documents before AI work, including newer last-writer/mirror markers. Commit rechecks both projects before staging assets. Download diagnostics reports CAPCUT_VERSION_UNSUPPORTED and safe version/schema fields.

The removed publication path could restamp a temporary copy using a newer local donor project. Without that failed job's full report, this remains a possible explanation for a candidate building before publication failed. A saved document authored by 18.2 is still subject to the upstream refusal. Removing inspection does not establish 18.2 support.

To add support safely, collect a sanitized **disposable** 18.2 project before/after a manually authored 100%→130% native scale edit, preserving all root/active timeline documents and project metadata. The tester's Codex can use the pinned CLI's `fixture --help` and fixture collection/sanitization checks. Review the bundle for private filenames/text/paths before sharing; no original footage is needed. Develop a narrowly versioned adapter, test document preservation and editable keys, then have the tester open/save/reopen a disposable generated result in 18.2. Only evidence from that round trip can justify widening compatibility. No automatic app control or force-write is required by the normal app.

## Retest

1. Pull the update and restart AI-Editor.
2. Save a disposable CapCut project, close CapCut yourself, and select it in AI-Editor.
3. Request a continuous editable 100%→130% zoom with unchanged timing/audio. No reference is required.
4. Run, watch the app preview and inspect its checks. No CapCut window should open or close.
5. If the supported project's checks pass, choose Apply. Then open the selected project yourself to inspect the native keyframes.
6. If the version check refuses 18.2, download diagnostics and collect the sanitized compatibility fixture above. Do not override the guard or repeatedly spend AI usage on the same unsupported version.

Automated checks use disposable fixtures. Windows automated checks and simulated Mac process/status cases do not claim an actual CapCut 18.2 round trip.
