# Native effect acquisition

The user authorized automatic acquisition of required free effects through the engine. Paid resources, purchases, footage uploads, arbitrary third-party packages and worker-controlled downloads remain excluded.

Current official material search returns resource IDs, STDraft URIs, descriptions and preview images. It did not return a desktop package URL in the inspected Motion Blur and Flicker responses. The installed local STDraft builder edits an in-memory document; it does not download native desktop bundles. A `vimo://` URI is not a download URL.

[CapCut's desktop instructions](https://www.capcut.com/resource/capcut-effects-download) describe downloading through its Effects library. A [community implementation](https://github.com/nguyenph88/Media-Editor-MCP/blob/main/packages/capcut-mcp/README.md) reports acquisition when a referenced draft opens, but this needs validation against the installed version. The local `ressdk_db` effect tables inspected on this machine were empty; no download URL was recovered. No login database, cookies or tokens were inspected.

## Integration gate

1. Use a disposable calibration project with one genuinely uncached, pinned free effect and an official matching resource ID.
2. Open through the same controller publication/session adapter used by the app. Observe whether CapCut acquires the package; do not alter the original library's cached files to manufacture a cache miss.
3. Validate the completed local bundle and named controls, retain provenance and hashes, then test its actual native appearance and unrelated-layer preservation.
4. Only after this succeeds, integrate a bounded, cancellable controller acquisition step before final compilation. Reuse cached resources. Record acquisition separately from native visual verification.
5. If first-open acquisition fails, retain an explicit missing-resource result. A desktop-library automation adapter would need its own observed UI contract, free-resource checks, tests and macOS acceptance. Do not invent a private HTTP endpoint or label the current lookup as downloading.

## Implemented controller path and evidence

`src/server/capcut/effect-acquisition.mjs` now implements the acquisition step, called by `discoverOfficialEffects` in normal editing jobs. It uses a synthetic three-second gray clip with no user footage, the global editing lock held by the controller, the existing publication/platform adapters, a 90-second cache wait and a fresh cleanup operation after cancellation. Each resource/version is attempted once per job; batches contain at most eight effects. Resource identity, pinned free status, expected version directory, metadata, named controls and bounded regular bundle files are checked. The official client fetches the package; AI-Editor never invents a private HTTP endpoint or reads login credentials. Receipts distinguish acquisition from native playback.

Windows CapCut 9.6.0.4097 acquired two genuinely uncached packages without manual library search, upload or export:

| Resource | Official ID | Expected cache version | Evidence |
| --- | --- | --- | --- |
| Flicker | `7399465469012430085` | `0bc9ee34335ba4f9d75e4a2b21f4d6e5` | `.local-tools/native-assets/download-probe-igPPMz/download-probe.json` |
| Strobe | `7399470084449684742` | `c5bed1ab7aee34bfb9b3c6ab3705eb28` | `.local-tools/native-assets/acquisition-smoke-GvANzX/result.json` and its acquisition receipt |

The first diagnostic used `scripts/native-resource-download-probe.mjs`; the second used `scripts/effect-acquisition-smoke.mjs`, calling the exact service now used by application jobs. Both read the acquired package's actual speed control. Polling tests cover incomplete extraction, timeout, cancellation and unsafe-cache errors. These checks establish acquisition, not shader correctness, reference similarity, effect scope or listening quality. Existing native comparison gates still apply.

Review found that metadata could appear before extraction completed. Discovery, initial cache checks and download polling now share a bundle probe: validate configuration and payload entry points, parse JSON, bound regular files and require a stable content fingerprint for two seconds. Interrupted/malformed partial metadata stays incomplete instead of prematurely failing. A staged-extraction regression covers these states and changing payloads; the actual Strobe cache passed the revised service (`acquisition-smoke-OfHESB/result.json`). This is a bounded readiness check, not a claim that a stable bundle renders correctly.

macOS cache paths and permission/platform adapters are implemented; real macOS first-open acquisition and native appearance remain untested. Unavailable packages retain an explicit gap. The broader Reference Video 1 workflow has not passed native visual acceptance.
