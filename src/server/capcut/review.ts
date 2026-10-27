import { existsSync } from "node:fs";
import { platformPaths } from "../platform/runtime.mjs";

/** Native export triggering is not a verified capture adapter. Never upgrade it to proof. */
export function nativeReviewCapability() {
  const paths = platformPaths();
  return { available: false, appInstalled: existsSync(paths.capcut),
    reason: existsSync(paths.capcut)
      ? "Open the editable test copy in CapCut to inspect it. Automatic native comparison is still in development, so replacing the original is unavailable."
      : "CapCut desktop was not found. Install CapCut or configure its application path. Native verification remains unavailable." };
}
