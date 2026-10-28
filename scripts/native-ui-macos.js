/* JXA controller driver. Run only with /usr/bin/osascript -l JavaScript.
 * The user grants macOS permissions; this driver never changes TCC settings. */
/* global ObjC, $, Ref, Application, delay */
/* eslint-disable @typescript-eslint/no-unused-expressions -- ObjC zero-argument methods are property invocations in JXA. */
ObjC.import('AppKit');
ObjC.import('Vision');
ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');

// Capture and input must refer to the same observed native window, including
// its screen position. Window capture excludes other applications' pixels.
function assertStableWindow(expected, current, active) {
  const before = expected.kCGWindowBounds, after = current && current.kCGWindowBounds;
  if (!active || !current || current.kCGWindowNumber !== expected.kCGWindowNumber
    || current.kCGWindowOwnerPID !== expected.kCGWindowOwnerPID
    || current.kCGWindowOwnerName !== 'CapCut'
    || ['X', 'Y', 'Width', 'Height'].some(key => before[key] !== after[key]))
    throw new Error('Native capture interrupted: CapCut focus or window changed.');
}

// macOS normally exposes Qt child views through Accessibility, not as separate
// CG windows. Read their observed geometry; never infer a viewport from colors.
function accessibilityPanels(windows, bounds, scale) {
  const matches = windows.filter(window => {
    try {
      const p = window.position(), s = window.size();
      return Math.abs(p[0] - bounds.X) < 2 && Math.abs(p[1] - bounds.Y) < 2
        && Math.abs(s[0] - bounds.Width) < 2 && Math.abs(s[1] - bounds.Height) < 2;
    } catch { return false; }
  });
  if (matches.length !== 1) throw new Error('Cannot identify one matching macOS Accessibility window.');
  const panels = [], pending = [{ node: matches[0], depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { node, depth } = pending.shift();
    if (++visited > 250 || depth > 12) throw new Error('CapCut Accessibility inspection exceeded its bounded view traversal.');
    try {
      const p = node.position(), s = node.size();
      if (depth > 0 && s[0] >= 200 && s[1] >= 120) panels.push({ window: `ax-${visited}`,
        x: (p[0] - bounds.X) * scale, y: (p[1] - bounds.Y) * scale, width: s[0] * scale, height: s[1] * scale });
    } catch { /* Some accessible leaves have no geometry. */ }
    let children = [];
    try { children = node.uiElements(); } catch { /* A leaf may not expose children. */ }
    if (children.length + pending.length + visited > 250) throw new Error('CapCut Accessibility inspection exceeded its bounded view traversal.');
    children.forEach(child => pending.push({ node: child, depth: depth + 1 }));
  }
  return panels;
}

function run(argv) { // eslint-disable-line @typescript-eslint/no-unused-vars -- osascript entry point
  const data = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  const request = JSON.parse(ObjC.unwrap(data));
  if (!$.AXIsProcessTrusted()) throw new Error('macOS Accessibility permission is required for the application that launches AI-Editor. Enable it in System Settings > Privacy & Security > Accessibility, then retry.');
  if (!$.CGPreflightScreenCaptureAccess()) throw new Error('macOS Screen & System Audio Recording permission is required to inspect the CapCut window. Enable screen recording for the application that launches AI-Editor, then restart it. No microphone permission is needed.');
  if (request.action === 'preflight') return JSON.stringify({ platform: 'darwin', accessibility: true, screenRecording: true });
  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID))
    .filter(w => w.kCGWindowOwnerName === 'CapCut' && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 200 && w.kCGWindowBounds.Height >= 150);
  if (!windows.length) throw new Error('CapCut has no usable visible window. Keep its project window open.');
  const win = request.projectOnly ? [...windows].sort((a, b) => b.kCGWindowBounds.Width * b.kCGWindowBounds.Height - a.kCGWindowBounds.Width * a.kCGWindowBounds.Height)[0] : windows[0], bounds = win.kCGWindowBounds;
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(win.kCGWindowOwnerPID);
  const executable = ObjC.unwrap(app.executableURL.path);
  if (request.executable && request.executable !== executable) throw new Error('CapCut executable identity changed.');
  app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
  delay(0.2);
  if (!app.isActive) throw new Error('CapCut could not receive focus.');
  const assertWindow = () => {
    const current = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID))
      .find(w => w.kCGWindowNumber === win.kCGWindowNumber);
    assertStableWindow(win, current, Boolean(app.isActive));
  };
  assertWindow();
  const capture = $.NSTask.alloc.init;
  capture.launchPath = '/usr/sbin/screencapture';
  capture.arguments = $(['-x', '-o', '-l', String(win.kCGWindowNumber), request.screenshot]);
  capture.launch; capture.waitUntilExit;
  if (capture.terminationStatus !== 0) throw new Error('CapCut window capture failed. Check macOS Screen Recording permission.');
  assertWindow();
  const image = $.NSBitmapImageRep.imageRepWithContentsOfFile(request.screenshot);
  const width = Number(image.pixelsWide), height = Number(image.pixelsHigh);
  const scale = width / bounds.Width;
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(height / bounds.Height - scale) > 0.02)
    throw new Error('CapCut capture dimensions do not match the observed Retina window.');
  for (const region of request.captureRegions || []) {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
      || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
      || region.x + region.width > width || region.y + region.height > height)
      throw new Error('Capture region outside CapCut.');
  }
  const events = Application('System Events');
  let axPanels = [];
  if (request.projectOnly) {
    try {
      const process = events.processes.byName('CapCut');
      if (process.unixId() !== win.kCGWindowOwnerPID) throw new Error('CapCut process identity changed.');
      axPanels = accessibilityPanels(process.windows(), bounds, scale);
    } catch (error) { throw new Error('macOS player inspection needs an accessible CapCut view hierarchy and Automation permission for System Events. ' + error.message); }
  }
  const recognize = $.VNRecognizeTextRequest.alloc.init;
  recognize.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  recognize.usesLanguageCorrection = false;
  recognize.recognitionLanguages = $(['en-US']);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(request.screenshot), $({}));
  const error = Ref();
  if (!handler.performRequestsError($([recognize]), error)) throw new Error('Local macOS Vision recognition failed.');
  const words = [];
  recognize.results.js.forEach(observation => {
    const candidate = observation.topCandidates(1).js[0], box = observation.boundingBox;
    const text = ObjC.unwrap(candidate.string);
    const append = (text, box) => words.push({ text, x: box.origin.x * width, y: (1 - box.origin.y - box.size.height) * height,
      width: box.size.width * width, height: box.size.height * height });
    append(text, box);
    if (/\s/.test(text)) {
      const pattern = /\S+/g; let match;
      while ((match = pattern.exec(text))) {
        const item = candidate.boundingBoxForRangeError($.NSMakeRange(match.index, match[0].length), null);
        if (item) append(match[0], item.boundingBox);
      }
    }
  });
  const pixels = (request.samples || []).map(point => {
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) throw new Error('Sample outside CapCut.');
    const color = image.colorAtXY(point.x, point.y).colorUsingColorSpace($.NSColorSpace.deviceRGBColorSpace);
    return { ...point, r: Math.round(color.redComponent * 255), g: Math.round(color.greenComponent * 255), b: Math.round(color.blueComponent * 255) };
  });
  assertWindow();
  if (request.action !== 'inspect') {
    if (request.window !== win.kCGWindowNumber || request.width !== width || request.height !== height) throw new Error('CapCut window changed before input.');
    if (!request.anchor || !words.some(w => w.text.toLowerCase() === request.anchor.toLowerCase())) throw new Error('CapCut state changed before input; expected label missing.');
    if (!app.isActive) throw new Error('CapCut lost focus before input.');
    try {
      if (request.action === 'click' || request.action === 'set-text') {
        if (request.x < 0 || request.y < 0 || request.x >= width || request.y >= height) throw new Error('Click outside CapCut.');
        const point = $.CGPointMake(bounds.X + request.x * bounds.Width / width, bounds.Y + request.y * bounds.Height / height);
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft));
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft));
        if (request.action === 'set-text') { delay(0.2); events.keystroke('a', { using: 'command down' }); events.keystroke(request.text); events.keyCode(48); }
      } else if (request.action === 'export') {
        events.keystroke('e', { using: 'command down' });
      } else if (request.action === 'navigate') {
        if (!Number.isInteger(request.frames) || request.frames < 0 || request.frames > 3600) throw new Error('Invalid frame navigation.');
        if (request.reset) events.keyCode(115);
        for (let i = 0; i < request.frames; i++) { assertWindow(); events.keyCode(124); }
      } else if (request.action === 'folder-path') {
        events.keystroke('g', { using: ['command down', 'shift down'] }); delay(0.4);
        events.keystroke(request.text); events.keyCode(36);
      } else throw new Error('Unsupported native input action.');
    } catch (error) { throw new Error('macOS native input failed. Check Automation permission for System Events and Accessibility for the launcher. ' + error.message); }
  }
  const bundle = $.NSBundle.bundleWithPath(ObjC.unwrap(app.bundleURL.path));
  const version = ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleShortVersionString'));
  const panels = windows.map(w => ({ window: w.kCGWindowNumber, x: (w.kCGWindowBounds.X - bounds.X) * scale,
    y: (w.kCGWindowBounds.Y - bounds.Y) * scale, width: w.kCGWindowBounds.Width * scale, height: w.kCGWindowBounds.Height * scale }));
  panels.push(...axPanels);
  return JSON.stringify({ window: win.kCGWindowNumber, width, height, scale, words, panels, pixels, executable, version, screenshot: request.screenshot, action: request.action });
}
