param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName UIAutomationClient
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing;
public static class NativeClockPixels {
 public static void Threshold(Bitmap bitmap,int start){
  for(int y=0;y<bitmap.Height;y++)for(int x=start;x<bitmap.Width;x++){
   var c=bitmap.GetPixel(x,y);bitmap.SetPixel(x,y,System.Math.Max(c.R,System.Math.Max(c.G,c.B))>60?Color.Black:Color.White);
  }
 }
}
'@
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public class NativeCapCutWindow {
 public static string Obstruction = "";
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 public delegate bool WindowCallback(IntPtr h, IntPtr arg);
 [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr arg);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr arg);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder name,int max);
 public static string Class(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
 public static IntPtr[] Children(IntPtr parent){var result=new List<IntPtr>();EnumChildWindows(parent,(h,arg)=>{Rect r;if(IsWindowVisible(h)&&GetWindowRect(h,out r)&&r.Right-r.Left>=200&&r.Bottom-r.Top>=120)result.Add(h);return true;},IntPtr.Zero);return result.ToArray();}
 public static IntPtr[] Windows(uint[] pids) {
  var result=new List<IntPtr>();
  EnumWindows((h,arg)=>{ uint pid; GetWindowThreadProcessId(h,out pid); Rect r;
   if(Array.IndexOf(pids,pid)>=0 && IsWindowVisible(h) && GetWindowRect(h,out r) && (IsIconic(h) || r.Right-r.Left>=200 && r.Bottom-r.Top>=200)) result.Add(h);
   return true; },IntPtr.Zero);
  return result.ToArray();
 }
 public static bool Unoccluded(IntPtr target, Rect[] regions) {
  Rect bounds; if(!GetWindowRect(target,out bounds))return false;
  uint targetPid;GetWindowThreadProcessId(target,out targetPid);
  var children=Children(target);var surfaces=Windows(new uint[]{targetPid});bool clear=true;
  EnumWindows((h,arg)=>{
   if(h==target)return false;
   Rect r;if(!IsWindowVisible(h)||IsIconic(h)||!GetWindowRect(h,out r)||r.Right<=bounds.Left||r.Left>=bounds.Right||r.Bottom<=bounds.Top||r.Top>=bounds.Bottom)return true;
   if(regions.Length>0){bool intersects=false;foreach(var area in regions)if(r.Right>area.Left&&r.Left<area.Right&&r.Bottom>area.Top&&r.Top<area.Bottom){intersects=true;break;}if(!intersects)return true;}
   if(IsChild(target,h))return true;
   uint pid;GetWindowThreadProcessId(h,out pid);
   // The native Qt player has a top-level render surface mirroring its child
   // viewport. Only that exact surface is allowed above the editor.
   if(pid==targetPid && System.Text.RegularExpressions.Regex.IsMatch(Class(h),"^Qt[0-9]+QWindow(Icon|ToolSaveBits)$") && r.Left>=bounds.Left&&r.Top>bounds.Top&&r.Right<=bounds.Right&&r.Bottom<bounds.Bottom) {
    foreach(var child in children){Rect c;if(GetWindowRect(child,out c)&&c.Left==r.Left&&c.Top==r.Top&&c.Right==r.Right&&c.Bottom==r.Bottom)return true;}
    // On this Qt build the player and its backing surface are both top-level,
    // with identical bounds and complementary classes, rather than HWND children.
    foreach(var other in surfaces){Rect c;if(other!=h&&Class(other)!=Class(h)&&System.Text.RegularExpressions.Regex.IsMatch(Class(other),"^Qt[0-9]+QWindow(Icon|ToolSaveBits)$")&&GetWindowRect(other,out c)&&c.Left==r.Left&&c.Top==r.Top&&c.Right==r.Right&&c.Bottom==r.Bottom)return true;}
   }
   Obstruction=Class(h)+" "+r.Left+","+r.Top+","+(r.Right-r.Left)+","+(r.Bottom-r.Top)+" sameProcess="+(pid==targetPid);
   clear=false;return false;
  },IntPtr.Zero);
  return clear;
 }
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
[void][NativeCapCutWindow]::SetProcessDPIAware()
$processes = @(Get-Process -Name CapCut -ErrorAction SilentlyContinue)
$windows = @([NativeCapCutWindow]::Windows([uint32[]]@($processes.Id)))
if (-not $windows.Count) { throw 'CapCut has no usable visible window. Keep its project window open.' }
$foreground = [NativeCapCutWindow]::GetForegroundWindow()
if ($request.projectOnly) {
 # Qt also creates transient full-screen tool/overlay windows. Their bounds are
 # not the editor bounds, even though they belong to the CapCut process.
 $editors = @($windows | Where-Object { [NativeCapCutWindow]::Class($_) -match '^Qt\d+QWindowIcon$' })
 if (-not $editors.Count) { throw 'CapCut has no usable visible window. Waiting for its editor.' }
 $handle = $editors | Sort-Object { $bounds=New-Object NativeCapCutWindow+Rect; [void][NativeCapCutWindow]::GetWindowRect($_,[ref]$bounds); ($bounds.Right-$bounds.Left)*($bounds.Bottom-$bounds.Top) } -Descending | Select-Object -First 1
} elseif ($windows -contains $foreground) { $handle=$foreground }
else { $handle=$windows[0] } # EnumWindows is in Z order: reacquire the topmost CapCut dialog.
if ($request.projectOnly) {
 $enabledDeadline=[DateTime]::UtcNow.AddSeconds(5)
 while(-not [NativeCapCutWindow]::IsWindowEnabled($handle) -and [DateTime]::UtcNow -lt $enabledDeadline){Start-Sleep -Milliseconds 100}
 if(-not [NativeCapCutWindow]::IsWindowEnabled($handle)){throw 'A CapCut dialog is blocking the editor. Resolve the dialog before player inspection.'}
}
$capcutPid = [uint32]0
[void][NativeCapCutWindow]::GetWindowThreadProcessId($handle,[ref]$capcutPid)
$process = Get-Process -Id $capcutPid
if ($request.executable -and [IO.Path]::GetFullPath($process.Path) -ne [IO.Path]::GetFullPath($request.executable)) { throw 'CapCut executable identity changed.' }
if ([NativeCapCutWindow]::IsIconic($handle)) { [void][NativeCapCutWindow]::ShowWindow($handle, 9); Start-Sleep -Milliseconds 700 }
[void][NativeCapCutWindow]::SetForegroundWindow($handle)
if ([NativeCapCutWindow]::GetForegroundWindow() -ne $handle) {
 try { [System.Windows.Automation.AutomationElement]::FromHandle($handle).SetFocus() } catch { }
}
Start-Sleep -Milliseconds 200
if ([NativeCapCutWindow]::GetForegroundWindow() -ne $handle) { throw 'CapCut could not receive focus. Keep the desktop unlocked and CapCut available.' }
$rect = New-Object NativeCapCutWindow+Rect
if (-not [NativeCapCutWindow]::GetWindowRect($handle,[ref]$rect)) { throw 'CapCut window disappeared.' }
$width = $rect.Right-$rect.Left; $height = $rect.Bottom-$rect.Top
if ($width -lt 200 -or $height -lt 200) { throw 'CapCut is minimized or unavailable.' }
# A thumbnail click can leave the cursor over a new editor control and create a
# tooltip. Move without clicking to the title-bar border before observing pixels.
[void][NativeCapCutWindow]::SetCursorPos($rect.Left+[int]($width/2),$rect.Top+5)
Start-Sleep -Milliseconds 300
$bitmap = New-Object Drawing.Bitmap $width,$height
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$pixels=@()
$captureRegions=@()
if($request.protectHeader) {
 $header=New-Object NativeCapCutWindow+Rect
 $header.Left=$rect.Left;$header.Top=$rect.Top;$header.Right=$rect.Right;$header.Bottom=$rect.Top+[Math]::Min($height,80*[NativeCapCutWindow]::GetDpiForWindow($handle)/96.0)
 $captureRegions+=$header
}
foreach($region in @($request.captureRegions)) {
 if($null -eq $region){continue}
 if($region.x -lt 0 -or $region.y -lt 0 -or $region.width -le 0 -or $region.height -le 0 -or $region.x+$region.width -gt $width -or $region.y+$region.height -gt $height){throw 'Capture region outside CapCut.'}
 $area=New-Object NativeCapCutWindow+Rect
 $area.Left=$rect.Left+$region.x;$area.Top=$rect.Top+$region.y;$area.Right=$area.Left+$region.width;$area.Bottom=$area.Top+$region.height
 $captureRegions+=$area
}
function Assert-CaptureWindow {
 $capturePid=[uint32]0; $captureRect=New-Object NativeCapCutWindow+Rect
 [void][NativeCapCutWindow]::GetWindowThreadProcessId($handle,[ref]$capturePid)
 if (-not [NativeCapCutWindow]::IsWindow($handle) -or $capturePid -ne $capcutPid -or [NativeCapCutWindow]::GetForegroundWindow() -ne $handle -or
     -not [NativeCapCutWindow]::GetWindowRect($handle,[ref]$captureRect) -or
     $captureRect.Left -ne $rect.Left -or $captureRect.Top -ne $rect.Top -or $captureRect.Right -ne $rect.Right -or $captureRect.Bottom -ne $rect.Bottom) {
  throw 'Native capture interrupted: CapCut focus or window changed.'
 }
 if (-not [NativeCapCutWindow]::Unoccluded($handle,[NativeCapCutWindow+Rect[]]$captureRegions)) { throw ('Native capture interrupted: another window covers CapCut. '+[NativeCapCutWindow]::Obstruction) }
}
try {
 Assert-CaptureWindow
 $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
 Assert-CaptureWindow
 $bitmap.Save($request.screenshot,[Drawing.Imaging.ImageFormat]::Png)
 foreach ($sample in @($request.samples)) { if ($null -eq $sample) {continue}; if($sample.x -lt 0 -or $sample.y -lt 0 -or $sample.x -ge $width -or $sample.y -ge $height){throw 'Sample outside CapCut.'}; $color=$bitmap.GetPixel([int]$sample.x,[int]$sample.y); $pixels+=@{r=$color.R;g=$color.G;b=$color.B;x=$sample.x;y=$sample.y} }
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$hasher=[Security.Cryptography.SHA256]::Create()
try { $hash=([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($request.screenshot)))).Replace('-','').ToLower() } finally { $hasher.Dispose() }
# OCR stays on this machine using the Windows language pack. No service upload.
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
function Await-Operation($operation, [Type]$type) {
 $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
 $task = $method.MakeGenericMethod($type).Invoke($null,@($operation)); $task.Wait(); return $task.Result
}
function Read-OcrFile([string]$path) {
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
 $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $software = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
 $language = New-Object Windows.Globalization.Language 'en-US'
 $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
 if ($null -eq $engine) { throw 'A Windows OCR language pack is required for native CapCut export.' }
 $result = Await-Operation ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
 $words = @()
 foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) { $r=$word.BoundingRect; $words += @{text=($word.Text -replace '[\x00-\x1F]',' ');x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height} }
  if (@($line.Words).Count -gt 1) {
   $left=($line.Words.BoundingRect.X | Measure-Object -Minimum).Minimum
   $top=($line.Words.BoundingRect.Y | Measure-Object -Minimum).Minimum
   $right=($line.Words | ForEach-Object {$_.BoundingRect.X+$_.BoundingRect.Width} | Measure-Object -Maximum).Maximum
   $bottom=($line.Words | ForEach-Object {$_.BoundingRect.Y+$_.BoundingRect.Height} | Measure-Object -Maximum).Maximum
   $words += @{text=($line.Text -replace '[\x00-\x1F]',' ');x=$left;y=$top;width=$right-$left;height=$bottom-$top}
  }
 }
} finally { if ($software) {$software.Dispose()}; $stream.Dispose() }
return ,$words
}
# Enlarge tiles so small toolbar labels remain readable without exceeding the
# Windows OCR bitmap limit. Coordinates are mapped back to the original window.
$sourceImage = [Drawing.Image]::FromFile($request.screenshot)
$words = @()
try {
 for ($tileY=0; $tileY -lt $height; $tileY+=1000) {
  for ($tileX=0; $tileX -lt $width; $tileX+=1000) {
   $tileWidth=[Math]::Min(1000,$width-$tileX); $tileHeight=[Math]::Min(1000,$height-$tileY)
   $tile=New-Object Drawing.Bitmap ($tileWidth*2),($tileHeight*2)
   $g=[Drawing.Graphics]::FromImage($tile)
   $tilePath=$request.screenshot+".$tileX-$tileY.png"
   $attributes=New-Object Drawing.Imaging.ImageAttributes
   $matrix=New-Object Drawing.Imaging.ColorMatrix (,[single[][]]@(@(-0.299,-0.299,-0.299,0,0),@(-0.587,-0.587,-0.587,0,0),@(-0.114,-0.114,-0.114,0,0),@(0,0,0,1,0),@(1,1,1,0,1)))
   $attributes.SetColorMatrix($matrix)
   try { $g.DrawImage($sourceImage,(New-Object Drawing.Rectangle 0,0,($tileWidth*2),($tileHeight*2)),$tileX,$tileY,$tileWidth,$tileHeight,[Drawing.GraphicsUnit]::Pixel,$attributes); $tile.Save($tilePath,[Drawing.Imaging.ImageFormat]::Png) }
   finally { $g.Dispose(); $tile.Dispose(); $attributes.Dispose() }
   foreach ($word in (Read-OcrFile $tilePath)) { $word.x=$tileX+$word.x/2; $word.y=$tileY+$word.y/2; $word.width/=2; $word.height/=2; $words+=$word }
  }
 }
} finally { $sourceImage.Dispose() }
if ($request.ocrRegion) {
 $r=$request.ocrRegion
 if($r.x -lt 0 -or $r.y -lt 0 -or $r.width -le 0 -or $r.height -le 0 -or $r.x+$r.width -gt $width -or $r.y+$r.height -gt $height){throw 'OCR region outside CapCut.'}
 $sourceImage=[Drawing.Image]::FromFile($request.screenshot)
 $tile=New-Object Drawing.Bitmap ([int]($r.width*4+180)),([int]($r.height*4))
 $g=[Drawing.Graphics]::FromImage($tile)
 $tilePath=$request.screenshot+'.region.png'
 try {
  $g.Clear([Drawing.Color]::White); $g.DrawImage($sourceImage,(New-Object Drawing.Rectangle 180,0,([int]($r.width*4)),$tile.Height),[int]$r.x,[int]$r.y,[int]$r.width,[int]$r.height,[Drawing.GraphicsUnit]::Pixel)
  $font=New-Object Drawing.Font 'Arial',24; $g.DrawString('Time',$font,[Drawing.Brushes]::Black,10,50);$font.Dispose()
  [NativeClockPixels]::Threshold($tile,180)
  $tile.Save($tilePath,[Drawing.Imaging.ImageFormat]::Png)
 }
 finally {$g.Dispose();$tile.Dispose();$sourceImage.Dispose()}
 foreach($word in (Read-OcrFile $tilePath)){ if($word.x -lt 180){continue}; $word.x=$r.x+($word.x-180)/4; $word.y=$r.y+$word.y/4; $word.width/=4; $word.height/=4; $words+=$word }
}
Assert-CaptureWindow
if ($request.action -ne 'inspect') {
 if ($request.window -ne $handle.ToInt64() -or $request.width -ne $width -or $request.height -ne $height) { throw 'CapCut window changed before input.' }
 # Require the expected visible anchor again immediately before every input.
 if (-not $request.anchor -or -not @($words | Where-Object { $_.text -eq $request.anchor }).Count) { throw 'CapCut state changed before input; expected label missing.' }
 if ([NativeCapCutWindow]::GetForegroundWindow() -ne $handle) { throw 'CapCut lost focus before input.' }
 $currentRect=New-Object NativeCapCutWindow+Rect
 if(-not [NativeCapCutWindow]::GetWindowRect($handle,[ref]$currentRect) -or $currentRect.Left -ne $rect.Left -or $currentRect.Top -ne $rect.Top -or $currentRect.Right -ne $rect.Right -or $currentRect.Bottom -ne $rect.Bottom){throw 'CapCut moved before input. Retry with a stable window.'}
 if ($request.action -eq 'click' -or $request.action -eq 'set-text') {
  if ($request.x -lt 0 -or $request.y -lt 0 -or $request.x -ge $width -or $request.y -ge $height) { throw 'Click outside CapCut.' }
  [void][NativeCapCutWindow]::SetCursorPos($rect.Left+[int]$request.x,$rect.Top+[int]$request.y)
  [NativeCapCutWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [NativeCapCutWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  if ($request.action -eq 'set-text') {
   Start-Sleep -Milliseconds 200
   if ([NativeCapCutWindow]::GetForegroundWindow() -ne $handle) { throw 'Text control opened another window; no text was entered.' }
   Add-Type -AssemblyName System.Windows.Forms
   [System.Windows.Forms.SendKeys]::SendWait('^a')
   $literal=[string]::Join('',@($request.text.ToCharArray() | ForEach-Object { if ([string]$_ -match '[+^%~(){}]') {'{'+[string]$_+'}'} else {[string]$_} }))
   [System.Windows.Forms.SendKeys]::SendWait($literal)
   [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  }
 } elseif ($request.action -eq 'export') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('^e')
 } elseif ($request.action -eq 'navigate') {
  if ($request.frames -lt 0 -or $request.frames -gt 3600 -or [int]$request.frames -ne $request.frames) { throw 'Invalid frame navigation.' }
  Add-Type -AssemblyName System.Windows.Forms
  if ($request.reset) { [System.Windows.Forms.SendKeys]::SendWait('{HOME}') }
  if ($request.frames -gt 0) { [System.Windows.Forms.SendKeys]::SendWait('{RIGHT '+[int]$request.frames+'}') }
 } else { throw 'Unsupported native input action.' }
}
$panels=@((@($windows)+@([NativeCapCutWindow]::Children($handle))) | Sort-Object -Unique | ForEach-Object {$b=New-Object NativeCapCutWindow+Rect;[void][NativeCapCutWindow]::GetWindowRect($_,[ref]$b);@{window=$_.ToInt64();class=[NativeCapCutWindow]::Class($_);x=$b.Left-$rect.Left;y=$b.Top-$rect.Top;width=$b.Right-$b.Left;height=$b.Bottom-$b.Top}})
@{window=$handle.ToInt64();width=$width;height=$height;scale=([NativeCapCutWindow]::GetDpiForWindow($handle)/96.0);words=$words;panels=$panels;pixels=$pixels;screenshot=$request.screenshot;sha256=$hash;executable=$process.Path;version=$process.FileVersion;action=$request.action} | ConvertTo-Json -Depth 5 -Compress
