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

## Validation and next Mac test

Regression coverage exercises nested permission errors, privacy-safe diagnostics, missing preflight permissions before window access, a launch process that spawns successfully then exits with an error, and every failed publication stage. Existing native-evidence tests reject empty, incomplete or altered captures. These are automated checks; they do not stand in for a Mac CapCut playback trial.

Windows checks after the repair: **161 tests passed, one expected POSIX-only skip; lint and the production/TypeScript build passed.** A nested-process regression also verifies that the launch exit code survives its Node wrapper. Static review findings about that code and stale retry diagnostics were corrected before handoff.

Update the source, restart from the authorized launcher, repeat the same disposable 100%–130% zoom and check whether native review gets beyond preflight. If anything else fails, send the app's downloaded diagnostics and the visible CapCut screen. No new effects, reusability feature or export workflow is needed for this test.
