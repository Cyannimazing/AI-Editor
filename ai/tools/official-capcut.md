# Official ChatGPT × CapCut plugin

The official plugin and the community native desktop CLI serve different representations. Select the owning workflow explicitly. A successful login, search, local builder return, cloud save and native desktop render are separate completion events.

## Application bridge

AI-Editor uses Codex App Server's configured `capcut_creation` server. Codex owns OAuth, callback listeners and credential storage. Connect from the app's **Connect CapCut** button; retain the app process until it reports completion. Do not ask users for cookies, tokens, callback codes or credential files. Worker sessions remain restricted; trusted services broker selected official operations.

During Run, the controller automatically searches each chosen native effect using `search_capcut_material`, preserves the authoritative URI, and returns discovered controls to the motion specialist and lead before compilation. The user does not search for effects. The planner may also request up to three additional task-relevant resourceQueries. Searches are cached within the job and are read-only text requests; they do not upload footage or spend generation credits. Missing server, failed login and missing search capability are reported separately. Broader uploads, cloud writes and generation are not enabled by connecting.

For a unique matching no-cost catalog effect, the host invokes the installed official `apply_video_effect` and `update_material` Python functions locally. The adapter consumes their validated effect segment, checks its URI/timing/control values, and translates those fields into the native desktop candidate. A matching installed resource bundle supplies real `effects_adjust_*` control names, ranges and defaults. Numeric plan `params` follow that discovered order as percentages of min..max; `[]` keeps the actual defaults. Do not invent generic parameter names. Missing or ambiguous matches and absent native resources remain verification gaps, not successful visual matches.

The host retains the plugin result, native binding, resource hashes and execution receipts in the job. Complete effect bundles travel with published review projects. This is AI-Editor's desktop adapter, not an official STDraft-to-desktop converter. Construction, local resource availability and native playback are separately recorded. The tested bridge targets installed plugin 0.2.6 and requires Python 3; other versions need an adapter check.

## Discover resources correctly

Use `search_capcut_material` with `type`, `prompt` and optional `top_n` (1–20). Categories include video/character effects, filters, transitions, fonts, text effects/templates, music and sound effects. Preserve exact user names; otherwise describe the intended result. Some categories return curated lists whose order is not query-ranked. Query changes do not make an empty curated list into a search result.

Keep returned resource_id, stdraft_uri, title/author/description, duration and category. A thumbnail is not an effect package or playable audio. A found material is not an applied edit and does not prove it is free or usable on the installed desktop build. Do not purchase or select known paid resources.

## Local STDraft editing

The installed `capcut-stdraft-builder` skill provides local Python atomic functions for video/photo/text/captions, audio, fonts, text effects/templates, video effects, filters, transitions, updates, removals and placement. These functions process STDraft in memory without OAuth/network. Read its `reference/application.md` and function implementation before invoking the host adapter. Prefer its atomic functions instead of hand-assembling protocol structures. Inspect the returned complete draft and validation warnings.

STDraft is not native desktop `draft_content.json`. A local builder result cannot simply overwrite a desktop draft. New media must use the owning workflow's supported URI types; workers must not invent asset:// references or reinterpret vimo:// as a filesystem path. The trusted offline effect adapter owns a local-only source binding for its in-memory working draft; that working document is never uploaded or treated as an existing cloud project. Captions/plain text require valid fonts. Keep actual font and source URI metadata.

## Optional Web collaboration

Web collaboration owns exactly one cloud draft per session. Read current state immediately before editing; if stale, fetch the current snapshot. Apply atomic functions to that baseline, then push the complete validated document with its matching base version. A browser save wins conflicts; refetch and rebase instead of blindly retrying a previous push.

New local media normally requires explicit upload and returned vid:// or tos:// references. Preserve existing asset:// and catalog sid:// or vimo:// references. Uploads/cloud writes need a separately enabled, user-authorized app workflow; they remain disabled now. Do not upload selected media merely because the user connected their account.

Automatic captions follow the caption/post-editing workflow. Caption-only tasks must not be switched to an AI rough-cut task. AI rough cutting is for assembling/restructuring footage and is not proof of a native editable desktop result. Paid generation/credits and external paid services remain prohibited.

Reference: the installed CapCut 0.2.6 skills `mcp-auth`, `capcut-stdraft-builder`, `video-editing/references/materials.md`, `video-editing/references/auto-captions.md` and `web-collaborative-editing`. App-side integration uses official Codex App Server methods, not manually copied OAuth credentials or rewritten MCP endpoints.
