# Local media, timing and audio

Use the host-discovered FFmpeg/FFprobe paths and observed codec/filter support. Version, installed file, compiled capability and successful execution are separate checks. Prefer typed FFmpeg toolkit adapters when registered; otherwise the trusted application may use explicit native argument arrays. Never construct a shell command from prompts or filenames.

## Evidence preparation

- Probe dimensions, pixel format, rotation, duration, frame rate, time bases, streams and audio layout before editing. Do not infer them from the extension. Preserve source originals.
- Keep raw media duration, the selected clip's source interval, its target interval and the full project duration separate. The controller reads the same canonical CapCut document used for native edits, rather than preferring an older mirror. A longer project does not make the selected clip longer.
- Constant playback speed needs serialized native evidence. A missing source duration is interpreted using the declared speed. An out-of-bounds unretimed default range can only be reconciled when an explicit non-unit speed yields a valid source interval; never invent a slowdown from file length. Ambiguous speeds/materials and genuinely missing footage stop preparation with a diagnostic. The receipt retains serialized versus effective timing and hashed document/source identity.
- The pinned CLI leaves a neutral 1× speed companion when changing the segment's speed; that default must not override a valid explicit segment speed. Multiple referenced speed records or conflicting non-neutral speeds require resolution before preparation.
- Extract frames with recorded timestamps. A 6x6 contact sheet is read left-to-right and top-to-bottom. Supply a per-sheet timestamp list, sampling rate and video duration to the model; the worker must not need filesystem tools to find that metadata.
- Short transitions need consecutive frames. Long-video overview sampling is a first pass, not evidence that every fast event was inspected. Host frame extraction should target suspected intervals without sending unbounded images to the model.
- The host can measure shared footage with local SIFT feature matching and RANSAC similarity fits. Reliable samples include source-to-reference scale, signed native x/y, rotation, inlier count, residual error and frame hashes. Unrelated footage, insufficient spatial coverage and ambiguous fits remain unmatched. Use these measurements plus synchronized enlarged panels to establish motion; never infer absent source pixels, optical fidelity or audio from a geometric fit.
- Generate local procedural stills/textures, extract mattes, rasterize vector assets and prepare alpha-bearing overlays using an appropriate registered tool. Retain inputs, generation parameters, intermediate source and output metadata.

## Editing primitives

FFmpeg supports trim/setpts, concat/xfade, scaling/cropping/padding, overlays, blend modes, color correction, channel operations, blur, frame differences and many other filters. Discover the exact installed filter and its options. A technique can be composed from several operations; do not assume that lacking a same-named filter means it cannot be reproduced.

Use native CapCut controls for promised native editable elements. Use FFmpeg for measurements, source preparation, previews and appropriately disclosed generated assets. A fully processed replacement video loses internal effect editability and cannot silently replace native layers.

Probe outputs after each new codec/alpha/timing pipeline. Check duration against the required interval and sample first/last frames. Compilation or exit code 0 alone does not establish visual correctness. Use bounded dimensions/FPS/timeouts and caching keyed by source/parameters.

## Sound and captions

Measure silence, peaks, integrated loudness, beats/onsets and synchronization with local tools. Use measurements to create native cuts/fades/volume keyframes; do not claim to hear audio from images. Keep original audio unless changes are requested.

HyperFrames exposes `audio`, `beats`, `normalize-audio` and local transcription/TTS workflows. Query their help and runtime status. `transcribe` can use Parakeet or Whisper; `tts` can use Kokoro. These require separate runtimes/models. An installed HyperFrames CLI does not establish those models are present. Prepare vetted local runtimes through setup and record versions/provenance before using them. Avoid silent cloud fallbacks. An audio file's existence is not a verified transcript.

Import verified timestamped words/SRT/VTT into native caption/text tracks. Preserve exact wording, punctuation and cue timing. Separate transcript uncertainty from a limitation of the video-editing tools.

For sound creation, use local synthesis/procedural generation or a verified local model with compatible rights. Do not fetch an arbitrary copyrighted song or use a paid speech/music service.

The current v5 engine exposes local procedural composition directly in the validated plan: audio decision/rationale, generated assets and timed clips. Layer sine oscillators or filtered noise with frequency sweeps, attack/release and pan. Retain the original source audio; add separate native tracks with volume curves for fades/ducking. Hash-cached 48kHz stereo WAVs retain their `.source.json` recipe during packaging. Maximum 12 assets, 60 seconds per asset, 180 seconds total, 256 layers per asset and 900 layer-seconds per job. Up to 64 timed audio clips; no paths, URLs or executable code in synthesis parameters.

The motion preview mixes source and added audio from serialized native controls, including volume curves. `audio-mix-report-N.json` records timing, peaks, RMS, clipped samples and each track's decoded duration. Deterministic clipping/silence findings cannot be overruled by an AI review. Native audio effects and perceptual/semantic listening remain unverified until actual playback is checked. No song, voice or transcription model is installed by this feature.

Sources: https://ffmpeg.org/documentation.html ; installed FFmpeg help and filter capabilities; installed HyperFrames command help.
