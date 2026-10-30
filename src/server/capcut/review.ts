import { existsSync } from "node:fs";
import { platformPaths } from "../platform/runtime.mjs";
import { join } from "node:path";

/** Adapter readiness is separate from successful capture of any particular edit. */
export function nativeReviewCapability() {
  const paths = platformPaths();
  const installed = existsSync(paths.capcut);
  const driver = process.platform === 'darwin' ? 'native-ui-macos.js' : 'native-ui-windows.ps1';
  return { available: installed && existsSync(join(process.cwd(), 'scripts', driver)), appInstalled: installed,
    reason: installed
      ? "Review uses project files and the approximate preview. AI-Editor does not open or close CapCut. Desktop capture permissions are not required for this workflow."
      : "CapCut desktop was not found. Install it to open your saved projects manually. File and preview review does not control the desktop." };
}
