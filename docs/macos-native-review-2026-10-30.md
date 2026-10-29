# Mac native review: permissions and temporary copies

## What the returned audit establishes

The supplied `MAC_NATIVE_REVIEW_AUDIT.md` reports a successful 10.471667-second zoom candidate with editable native scale curves from 100% to 130%, retained audio, a playable approximate preview and passing structural checks. Native player inspection stopped before any window capture because Accessibility trust was missing. This is a host-permission failure; changing the zoom curve cannot fix it.

The number `-2700` alone is a general JXA error. The specific Accessibility message in this audit establishes the cause. Screen Recording, Automation and the native view hierarchy have not yet passed on that Mac. The report does not identify which app started the server or retain the separate temporary-copy button response.

## Which app needs permission?

Use the application that started the AI-Editor server. For the README's `pnpm dev` instructions in Apple's Terminal, start with **Terminal**. For iTerm or an IDE terminal, check **iTerm** or the relevant **VS Code/Codex** app. The app named in macOS's permission request/settings is the authority; the browser displaying localhost is not the controller. Do not enable every app in the list.

1. Stop the server in its launching terminal with Ctrl+C.
2. Open **System Settings → Privacy & Security → Accessibility**, then enable the launcher. Apple's [Accessibility guide](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac) explains adding an app if it is absent.
3. Under **Screen & System Audio Recording** (called Screen Recording on some versions), allow screen capture for that same launcher. This workflow captures still frames; it does not require microphone permission. See [Apple's recording-permission guide](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac).
4. Fully quit and reopen the launcher, restart AI-Editor and repeat the disposable zoom test.
5. When macOS requests **Automation**, allow that launcher to control **System Events** and **CapCut**. These are separate app-to-app permissions; see [Apple's Automation guide](https://support.apple.com/en-nz/guide/mac-help/mchl108e1718/mac).

Keep CapCut visible, in English, and the desktop unlocked during native review. The app cannot grant itself permission. Full Disk Access, TCC database edits and disabling macOS protections are not part of this fix. Switching launchers may change which application macOS asks you to authorize.

## Application repairs

- Wrapped `osascript` errors retain distinct Accessibility, Screen Recording and Automation guidance. Unknown `-2700` errors are not misdiagnosed as permissions.
- A blocked native review now carries its diagnostic through the editing result into the job and **Download diagnostics**. Reports include the failed stage, candidate digest, sample count and a relative receipt identifier. Private prompts, arbitrary OS stderr, source paths and project text are omitted from sharing reports.
- Capture receipts record preflight, publication, inspection, capture, close and equivalence stages. A failed/empty capture remains unusable for approval, and host failures do not enter the AI correction loop.
- Setup wording describes detected tools separately from permissions. It does not claim that installing the driver proves that macOS allows capture.
- Temporary-copy receipts record close, publish, register, link-media, identity, equivalence and launch. A failure retains the exact stopped stage; a later launch failure also tells the user the generated registered project name.
- The Mac launch helper waits for `/usr/bin/open` to exit and propagates failure. Successful launch handoff is explicitly **not** confirmation that the requested editor window is visible. Automatic verification still checks the actual project title and player evidence afterward.

## Inspect temporary review copy

This button publishes a separate registered project and asks CapCut to open it. If CapCut stays on Home, select the displayed **Verify 12345678**-style project name. The original stays unchanged; opening a copy does not make the candidate verified or enable Apply.

If the button fails, use **Show diagnostic details** or **Download diagnostics** in the same job. There is no need to find a job ID, inspect JSON files or run FFprobe. The downloadable report includes the last opening result and its failed stage when recorded. Reports from older versions cannot reconstruct an opening request that was never retained.

The exact visible-open behavior of CapCut 9.5 on this Mac remains to be observed. We have not changed the draft-file handoff to a folder handoff without evidence that the folder form works better.

## Media packaging finding

The audit's `media-outside-draft` warning refers to the private candidate before publication. The current publisher already copies job-owned uploaded media/effect resources into the review project's `assets/ai-editor`, registers and links media IDs, then compares resource bytes and authored controls before opening. That warning alone does not establish a missing-media defect in a published copy. External original dependencies remain external by design. A CapCut relink/access prompt, if one appears, should be captured in the next test report.

## Follow-up: Screen Recording API bridge failure

The latest returned audit confirms Accessibility is allowed, but `CGPreflightScreenCaptureAccess` was undefined in JXA. That exception occurred before Screen Recording permission could be determined. Error `-2700` alone is not evidence of missing permission.

JXA exposes imported C functions using framework BridgeSupport metadata. Apple documents `ObjC.bindFunction` for linked C symbols missing from that metadata. The driver now explicitly binds `CGPreflightScreenCaptureAccess` as `['bool', []]` when needed, following its C `bool` return type and empty parameter list. The permission check stays in the same `osascript` process as native inspection. An unavailable binding or invalid result produces `NATIVE_MACOS_PREFLIGHT_UNSUPPORTED`; a valid `false` still requires Screen Recording permission. Neither can pass native verification.

Primary references: [Apple JXA release notes — C Functions and Types](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html), [CoreGraphics preflight declaration](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess()?language=objc).

### Test this before another edit

1. Pull the latest code and restart AI-Editor from the same authorized launcher.
2. Open **Setup and connections → Check Mac permissions**. No project or footage is needed. It does not open CapCut, request access, capture pixels, export, upload or use Codex.
3. Check **Compatibility check: Passed**, **Accessibility: Allowed** and **Screen Recording: Allowed**. Compatibility passing with a denied permission means the bridge works, but that permission still needs enabling in macOS settings. Restart the launcher after granting permission and rerun the check.
4. If the check fails, click **Download check report**. Share that report; no job ID, draft inspection or FFprobe command is needed. Raw OS errors stay in local `.local-tools/native-preflight/check-*/failure.local.json`; the downloadable report excludes private paths and arbitrary stderr.
5. Once both permissions pass, repeat the disposable 100%–130% zoom test. Automation, opening the intended project, player capture and native keyframe appearance are separate checks performed during that edit.

For CLI use, `pnpm check:native` runs the same service. Its Node script exits with 0 for both permissions allowed, 1 for denied/failed, and 2 for a non-Mac host (pnpm may normalize a nonzero script exit). `pnpm test` now includes an actual Mac-only `osascript` smoke test which accepts either permission boolean but fails if the API cannot be called. This tests runtime compatibility even before permission is granted and never accesses a CapCut project.

## Validation and next Mac test

Regression coverage exercises nested permission errors, privacy-safe diagnostics, missing preflight permissions before window access, a launch process that spawns successfully then exits with an error, and every failed publication stage. Existing native-evidence tests reject empty, incomplete or altered captures. These are automated checks; they do not stand in for a Mac CapCut playback trial.

Windows checks after the repair: **161 tests passed, one expected POSIX-only skip; lint and the production/TypeScript build passed.** A nested-process regression also verifies that the launch exit code survives its Node wrapper. Static review findings about that code and stale retry diagnostics were corrected before handoff.

The subsequent bridge repair adds regression cases for an absent imported symbol, successful explicit binding, denied access, unavailable/broken binding, malformed return values and a status-only action that cannot access windows or request permission. Run the standalone check above before another full edit. Windows regression tests simulate JXA bridge behavior; the added Mac-only smoke test runs the real bridge on your Mac.

Bridge-repair validation: **165 tests passed, two platform skips on Windows; lint and production/TypeScript build passed.** Authenticated HTTP checks and a headless UI test with simulated Mac results passed, including report download. Actual Mac execution is the next standalone check above.
