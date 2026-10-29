# AI-Editor

A local editing workspace powered by your signed-in ChatGPT Codex CLI. Select your CapCut project, describe the changes, optionally add a reference, and review editable layers, text, effects, audio and keyframes. Approve the result to save it back to the project you selected.

**Windows and macOS testing build.** Platform setup, local tool discovery and native desktop adapters are included. Follow the steps below for your first test. See [the audit response and test evidence](docs/independent-audit-response-2026-10-28.md) for the checks behind this build.

## Set up the application

This is a source checkout running on your computer. Use native PowerShell on Windows 10/11 or Terminal on **macOS 13.5 or newer**, using a macOS version still supported by Apple. The Mac minimum follows [Node 24's requirements](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list). Install native ARM64 tools on Apple Silicon and x64 tools on Intel.

### 1. Install the prerequisites once

| Requirement | Windows | macOS |
| --- | --- | --- |
| Node.js | Install **Node.js 24.x** from [Node.js](https://nodejs.org/en/download). | Install **Node.js 24.x** for your Mac: ARM64 for Apple Silicon, x64 for Intel. |
| Codex | Install the official [Codex app/CLI](https://developers.openai.com/codex/quickstart), including its `codex-code-mode-host`. | Same requirement. System and per-user Codex app locations are checked. |
| CapCut desktop | Install [CapCut desktop](https://www.capcut.com/tools/desktop-video-editor), open it once, and save a test project. | Same requirement. Both `/Applications/CapCut.app` and `~/Applications/CapCut.app` are discovered. |
| Local media tools | Install [Python 3.13](https://www.python.org/downloads/) (3.10–3.13 supported); enable its PATH option. FFmpeg installs automatically if missing. | Install [Homebrew](https://brew.sh/) if compatible Python and FFmpeg are not already available. Setup uses it to install missing FFmpeg/Python 3.13. |
| Downloading this code | Install Git, or download and extract the repository ZIP. | Same requirement. |

Reopen your terminal after installing prerequisites. An existing Google Chrome installation can supply the **headless** preview browser. Otherwise setup obtains the browser managed by the pinned HyperFrames release. Preview rendering does not require a visible Chrome window.

### 2. Download and start

Run these commands in PowerShell on Windows, or Terminal on macOS:

```sh
git clone https://github.com/Cyannimazing/AI-Editor.git
cd AI-Editor
npm install --global pnpm@10.32.1
pnpm install --frozen-lockfile
pnpm dev
```

If you downloaded a ZIP, open a terminal inside its extracted folder and start with the `npm install` command. If you already have this repository, use its existing folder. Keep the terminal running while using the app.

Open [localhost:3000](http://localhost:3000). The server listens only on this computer (`127.0.0.1`). If port 3000 is occupied, stop the other app using it and retry. To stop AI-Editor, use **Stop** for any active editing job, then press **Ctrl+C** in the terminal.

### 3. Sign in and let setup finish

| Connection | Needed? | What to do |
| --- | --- | --- |
| ChatGPT / Codex | **Required** for AI editing. Uses your account and its usage limits. | Choose **Sign in with ChatGPT** in the app and complete the official sign-in page. An existing Codex sign-in is reused. API keys are not supported. |
| Local editing MCP | **No additional sign-in.** | Nothing to configure. AI-Editor starts its private MCP tools for each editing role. |
| Official CapCut MCP | **Optional.** Adds official material discovery. | Install the compatible official CapCut plugin in Codex if you want this connection, then use **Sign in to CapCut MCP** under **Official CapCut MCP** in AI-Editor. Complete consent on CapCut's page and return to the app. Local editing works without this connection. |

On startup, the app prepares the pinned Node editing packages before loading the workspace. After ChatGPT sign-in, it automatically checks/prepares FFmpeg, the private Python measurement environment, the background preview browser, and AI tool instructions. The setup screen shows progress and any prerequisite that still needs attention. This first run needs internet and may take several minutes; it is not instant.

Later launches reuse checked tools. A changed tool version, platform or CPU architecture triggers fresh checks. Use **Resume tool setup** after fixing a failed prerequisite; an interrupted setup can continue using downloaded packages. Never copy `node_modules`, `toolchain/node_modules` or `.local-tools` from Windows to Mac (or between Intel and Apple Silicon). Clone/extract the source and install on the destination computer.

Only compatible packages from the lockfiles are installed; package lifecycle scripts are disabled for the editing toolchain. Windows FFmpeg downloads use a fixed SHA-256 checksum. Python setup uses a private `.local-tools/motion-python` environment and pinned, hash-verified OpenCV/NumPy wheels, without source builds or changes to system Python packages. Homebrew manages its own FFmpeg/Python packages. `pnpm setup:motion` can retry just frame-measurement setup.

### 4. Try an edit

1. Wait for setup to finish, then choose **Open workspace**.
2. Select the saved CapCut project you want to update. Leave **Entire project** selected, or choose **Selected clips** for a checklist with filenames, tracks and time ranges. An empty test project needs footage.
3. Enter your editing instructions. A video, image or public-link reference is optional. Adding a reference suggests a plain-language prompt you can change.
4. Run the edit. The app builds a candidate, checks it and requests corrections when needed.
5. Review the result. **Inspect temporary review copy** opens the editable candidate in CapCut. **Apply to [project name]** saves approved changes to your selected project after verification, backup and a conflict check.

Use a test project for the first run. The app inspects the actual CapCut player without exporting. If the project, frame time or player layout cannot be identified reliably, it explains the problem and retains the candidate for review. A successful approximate preview alone cannot authorize replacing your original project.

### Mac permissions and readiness check

Grant permissions to the app that **starts AI-Editor**, such as Terminal, your IDE or Codex, as named by macOS:

- **Privacy & Security → Accessibility:** controlled CapCut navigation.
- **Screen & System Audio Recording / Screen Recording:** player frame inspection; this workflow does not record microphone or system audio.
- **Automation:** allow System Events and CapCut when prompted.
- **Files and Folders:** allow your selected workspace/media locations when requested.

Use the add button if the launcher is not listed in Accessibility or Screen Recording. Restart the launcher if macOS requests it. Keep the desktop unlocked and CapCut visible and in English during inspection. Full Disk Access and disabling Gatekeeper are not required. See [Apple's recording permissions guide](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac) and [Automation guide](https://support.apple.com/en-nz/guide/mac-help/mchl108e1718/mac).

After setup, run `pnpm check:setup` to check prerequisites without editing a project. On Mac, `pnpm check:setup --permissions` also checks Accessibility and Screen Recording. Resolve reported items, then resume setup in the app. On a memory-constrained MacBook, begin with a short clip and close other heavy applications.

### Common setup problems

- **Codex or its tool host was not found:** update/install the official Codex distribution. The app needs both executables, not only account credentials. If your installation is custom, add the directory containing both native executables to PATH, restart the terminal, then restart the app.
- **Python is missing or incompatible:** use Python 3.10–3.13. On Mac, setup checks both Intel and Apple Silicon Homebrew paths, including versioned Python installations. Apple's system Python may be too old.
- **Homebrew was not found:** install it from its official site, or install compatible FFmpeg and Python yourself and make them available on PATH. Then resume setup.
- **Downloads or browser checks failed:** restore internet access, check the reported error, and resume setup. Do not bypass checksum failures. `AI_EDITOR_BROWSER_PATH` can point to a compatible Chrome executable in a custom location.
- **CapCut/project not detected:** open CapCut once and save a project. Custom locations can be supplied with `AI_EDITOR_CAPCUT_PATH` and `AI_EDITOR_DRAFTS_ROOT` before starting the app. On macOS the application override points to the `.app` bundle; on Windows it points to `CapCut.exe`.
- **Mac asks for permission to quit/open CapCut:** review the macOS Automation prompt for the app/terminal you are using. Desktop automation permissions are separate from ChatGPT and MCP sign-in. Do not disable Gatekeeper or macOS security protections.
- **Mac command inventory or effect-packaging tests failed:** see the [29 October compatibility fixes and rerun commands](docs/macos-compatibility-fixes-2026-10-29.md). Startup uses the supported compact command index, and packaging accepts macOS temporary-folder aliases while retaining internal-link checks.
- **Clip duration does not match the timeline:** the message now shows expected and measured timing. Retry with the current build, then use **Editing progress → Download diagnostics** if it fails. The app collects the report automatically; see [clip preparation and diagnostics](docs/clip-duration-diagnostics-2026-10-29.md).

For a production-mode local server, use `pnpm build` followed by `pnpm start`. Both startup modes prepare the editing packages. Native review checks each candidate separately.

## Local and optional online features

The default uses the app's CLI, local media tools and your existing Codex account. AI reasoning uses that account's allowance; instructions and selected reference/preview frames are sent to Codex. Local rendering does not mean offline AI inference.

The app starts a private local stdio MCP connection per editing role. Codex can inspect individual reference frames, discover installed command contracts and no-cost catalog resources, test curves, build native candidate layers and read back the actual saved controls. Only the lead can write the candidate; reviewers are read-only. The official Codex app/CLI must include its bundled `codex-code-mode-host`. No separate CapCut MCP account or paid backend is required.

CapCut sign-in is optional for local draft editing. Its official plugin offers online templates, shared web drafts, captions and media generation. These are plugin capabilities, not completed app integrations. Cloud workflows may upload media. Paid services, credit purchases and paid generation are disabled. Connecting an account does not enable uploads or spending.

For supported native effects, the connected app automatically looks up official resources and uses the installed local CapCut builder before translating its result into an editable desktop candidate. No separate effect search is required from the user. Actual named controls come from matching installed effect bundles; native output verification remains a separate release gate.

When a selected free effect is missing locally, the controller opens a small disposable project so CapCut can download its own resource, then checks the expected package and controls before continuing. Existing downloads are reused. No footage is uploaded or exported, and paid effects remain excluded. CapCut may briefly appear during this step. Automatic acquisition passed Windows tests for Flicker and Strobe; real Mac testing and reference-effect visual acceptance remain pending. See [effect acquisition evidence](docs/native-effect-acquisition.md).

GSAP/HyperFrames, appropriately licensed Remotion and FFmpeg can create local graphics and animation through CLI jobs. Photorealistic image/video generation requires a separately supported model/runtime; no provider is silently enabled.

## Editing workflow

1. Select a saved CapCut project or create a disposable test project in the app.
2. Use **Entire project** to let AI plan changes across the active timeline, or **Selected clips** to check one or more clips by filename, track and time. An empty project still needs footage. Enter instructions; a reference is optional.
3. The controller checks account/model availability, isolation, tools, source paths and an exclusive lock.
4. The editor changes an isolated candidate. Structural checks, an approximate design preview and independent reviewer/manager findings guide corrections.
   References transfer techniques to your footage; they do not clone another scene. New raw-footage projects fill the picture before animation. You can focus a run with “Keyframes only”; other runs retain effect and asset tools.
5. File checks inspect editable controls; the controller opens a disposable candidate and inspects CapCut's player at checked timeline times without exporting. Independent reviewers assess the actual frames. Missing native/audio evidence or unsupported layouts remain explicit; an approximate preview cannot pass native verification. See [permissions and evidence limits](docs/native-player-verification.md).
6. The user approves the exact verified revision. Fresh digest checks, a complete backup and a journal protect the commit. Failed validation restores the whole original directory. Unresolved crash journals block later writes.

The selected project is the save destination. **Apply to [project name]** updates that project after verification and approval; temporary working/review copies are internal safety stages. In multi-clip jobs the planner assigns the prompt once across eligible clips, explains kept clips, and the controller accumulates changes into one candidate. Earlier clips are checked again against the final revision. The displayed design preview is labeled as the last edited clip, not the complete project. Existing non-video layer changes, clip reordering, duration changes and cross-boundary transitions are not enabled by this selection feature; required unsupported operations prevent approval. Multi-clip jobs share the existing 30-minute deadline and cannot yet be saved as reusable recipes.

Defaults: one build plus three corrections, 30-minute deadline, standard model speed and at most one high-reasoning escalation. Stop cancels active tools. Interrupted jobs retain files and are marked interrupted; full automatic continuation is unfinished.

Reusable technique saving and reuse are **deferred** for this release. Their workspace controls are removed and new save/reuse requests are disabled. Existing saved data is retained.

## Code map

| Location | Responsibility |
| --- | --- |
| `ai/` | Role contexts, contracts and workflow references |
| `src/app/api/` | Thin authenticated HTTP handlers |
| `src/server/security/` | Local sessions, origins, uploads and paths |
| `src/server/codex/` | Account, models, roles and isolation |
| `src/server/setup/` | Tool setup and capability status |
| `src/server/platform/` | Windows/macOS paths and tools |
| `src/server/editing/` | Plan, reviews, locks and transactions |
| `src/server/capcut/` | Native verification capability gate |
| `src/lib/native-capcut.ts` | Source preparation and approved commit |
| `src/lib/reference-edit-loop.ts` | Bounded editing/review controller |
| `scripts/capcut-*.mjs` | Trusted project/application operations |

`AI_EDITOR_CAPCUT_PATH` and `AI_EDITOR_DRAFTS_ROOT` override discovery without bypassing validation. Assets, logs, downloads and journals live in Git-ignored `.local-tools/`. Complete project backups are retained in `.ai-editor-backups` beside the original project.

## Verification

```sh
pnpm test
pnpm test:motion
pnpm lint
pnpm build
```

These checks include disposable security/setup fixtures, local MCP permissions, crash recovery and platform discovery. The Mac implementation includes native paths, Intel/Apple Silicon tool discovery, Retina-aware capture and guarded navigation. These automated checks were run on Windows; hardware-specific Mac permissions, playback and resource use need a first-device trial. This testing build does not claim certification for every CapCut version or Mac configuration. `scripts/check-worker-sandbox.mjs` is a legacy diagnostic, not the current MCP readiness check.

For an explicit application trial using your Codex allowance, `node scripts/reference-transfer-smoke.mjs <local-reference.mp4>` creates a disposable project with unrelated footage and submits a motion-transfer request through the normal app API. It retains the job ID under `.local-tools/smoke/`; it does not touch a personal project or open the desktop. See the audit for completed trials and their actual evidence limits.

For a disposable sound-design trial, run `node scripts/audio-edit-smoke.mjs` while the app is running. The v5 plan lets the editor preserve source sound or add original local procedural SFX/simple tonal music where appropriate. Generated WAVs and synthesis recipes stay local; native audio tracks retain timing and volume keyframes. The motion preview mixes the saved controls and checks clipping/silence. This feature does not install a song, voice or speech-recognition model, and does not establish native playback or listening quality.

Invalid editing-tool inputs return actionable repair details and bounded retries. A recovered tool call is shown separately from final quality approval. Chrome is used headlessly for motion previews. The pinned HyperFrames patch in `toolchain/patches/` reads Windows executable version metadata instead of launching `chrome.exe --version`; actual rendering still checks that the background browser works. The patch is retained in the toolchain lockfile for fresh Windows/macOS setup.
