# HyperFrames 0.8.193 browser preflight

The pinned patch changes only the Windows Chrome version probe. The upstream
`chrome.exe --version` call can hand a new window to the user's normal browser.
On Windows, read ProductVersion from executable metadata using a noninteractive,
hidden PowerShell process with a literal, quote-escaped path. Other platforms
retain their existing version probe. The actual renderer still launches and
validates a separate headless browser; this does not mark rendering successful
from file metadata alone.

`pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace` in toolchain
applies the version-specific, hash-bound patch. Reinspect upstream preflight and
repeat a real render before upgrading; do not silently drop this patch. App
render invocations disable automatic package updates/installations.
