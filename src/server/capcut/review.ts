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
      ? process.platform === 'darwin'
        ? "CapCut and the Mac inspection driver are installed. Permission readiness is checked when native review starts. Allow Accessibility and Screen Recording for the app that starts AI-Editor (Terminal/iTerm or your IDE), and Automation for System Events/CapCut when requested. Confirm the launcher named by macOS. Keep CapCut in English and the desktop unlocked."
        : "Native player inspection runs on a disposable copy without exporting. Keep CapCut in English and the desktop unlocked. File checks and visual verification are reported separately."
      : "CapCut desktop was not found. Install CapCut or configure its application path. Native verification remains unavailable." };
}
