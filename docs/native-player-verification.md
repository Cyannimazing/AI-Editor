# Local CapCut player review

Normal editing does not export or upload a video. Codex plans techniques, the official plugin supplies supported discovery/local effect operations, and AI-Editor's desktop adapter writes a separate native candidate. Structural checks read the saved components; independent reviewers inspect captured player frames when the desktop adapter can identify the project, player viewport and exact frame time.

The controller opens an isolated registered copy, steps its playhead, checks the visible timecode, crops only the observed player canvas and records original screenshots, normalized frames and hashes. Short intervals receive every frame (up to 90). Longer intervals use a bounded sample rate, explicitly reported to reviewers. Missing/ambiguous timestamps, moved windows, changed files and unknown layouts stop native verification. It gracefully closes CapCut to flush autosave and checks the saved native document against the candidate. The automatic correction loop uses that evidence; originals still require approval. The retained candidate can be opened for final user review. No Export button or cloud-sync control is used by this path.

## macOS setup and limits

Install the prerequisites in README, sign into Codex and allow setup to finish. CapCut must have a saved empty project to supply a compatible native format. Official CapCut authorization is separate from local editing.

When macOS requests permission, grant it to the actual launcher named by the OS (for example Terminal, your IDE or Codex):

- **Accessibility:** required for controlled player navigation.
- **Screen & System Audio Recording / Screen Recording:** required to inspect the CapCut window. This implementation captures still frames, not system audio.
- **Automation:** allow the launcher to control System Events and CapCut when the OS prompts.
- **Files and Folders:** allow the selected workspace/media locations if macOS requests access.

Quit and reopen the launcher after changing recording permissions if required. Keep the desktop unlocked, CapCut visible and its UI in English. Do not change the candidate, window layout or keyboard shortcuts during capture. The application never edits the TCC database or grants itself access. Full Disk Access and microphone access are not requirements of this still-frame workflow.

Apple references: [screen recording access](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac), [Automation permissions](https://support.apple.com/en-nz/guide/mac-help/mchl108e1718/mac), [UI scripting and Accessibility](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html).

The macOS driver uses local Vision OCR, native window capture, Retina coordinate conversion and checked navigation. It queries the matching Accessibility window for child-view bounds, with bounded traversal, because macOS does not generally expose child views as separate capture windows. Only layouts exposing an identifiable player surface can pass. The returned Mac audit confirms candidate construction and editable curves, but native inspection stopped at Accessibility preflight. Automated checks do not verify that Mac's permissions, CapCut view hierarchy or playback. Follow the [Mac permission and temporary-copy guide](macos-native-review-2026-10-30.md) for the next trial.

Optional overrides: `AI_EDITOR_CAPCUT_PATH`, `AI_EDITOR_DRAFTS_ROOT`, and an absolute `AI_EDITOR_CAPCUT_EFFECT_CACHE` for an existing local effect cache. Windows and macOS bundles must be discovered locally; copying a Windows cache is not a Mac compatibility guarantee.

## Evidence boundaries

Files establish editability, configured curves, placement, resource identity and separate audio/text. Captured player frames establish observed visuals at those times, at the player's displayed resolution. They do not certify export quality or native audio playback. Missing cached effect packages stay explicit; finding a catalog item does not download it. Generated PNG/video assets retain layer controls, but their internal pixels are not editable native text/effects.

Publication performs no blanket lint repair: it registers media identities, then requires strict content equivalence before opening. After native save, the comparator permits exact recorded defaults and inert companion rewrites from the disposable Windows 9.6 calibration, resolves relocated media by byte hashes, and separately checks stacking. Nondefault or unknown additions, timing, curve, effect-chain, text and resource changes fail. The saved document is retained in the hashed evidence. This is a conservative compatibility policy, not proof that every CapCut version has the same defaults; unfamiliar native rewrites need explicit validation.

Developer-only export diagnostics remain separate utilities. Normal app jobs never invoke them or fall back to them.
