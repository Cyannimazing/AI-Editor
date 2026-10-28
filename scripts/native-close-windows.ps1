$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CapCutGracefulClose {
 public delegate bool Callback(IntPtr h, IntPtr arg);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback fn, IntPtr arg);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
 public static IntPtr Top(uint[] pids) {
  IntPtr found=IntPtr.Zero; long area=0;
  EnumWindows((h,a)=>{uint pid; Rect r; GetWindowThreadProcessId(h,out pid);
   if(Array.IndexOf(pids,pid)>=0 && IsWindowVisible(h) && GetWindowRect(h,out r) && r.Right-r.Left>200 && r.Bottom-r.Top>150){long size=(long)(r.Right-r.Left)*(r.Bottom-r.Top);if(size>area){found=h;area=size;}}return true;},IntPtr.Zero);
  return found!=IntPtr.Zero && IsWindowEnabled(found)?found:IntPtr.Zero;
 }
}
'@
$lastSent=@{}
$deadline=[DateTime]::UtcNow.AddSeconds(25)
do {
 $items=@(Get-Process -Name CapCut -ErrorAction SilentlyContinue)
 if (-not $items.Count) {exit 0}
 $handle=[CapCutGracefulClose]::Top([uint32[]]@($items.Id))
 # Qt can reuse the editor HWND for the home window after saving. A second
 # graceful close is then required. Never close through a disabled modal owner.
 if ($handle -ne [IntPtr]::Zero) {
  $key=$handle.ToInt64(); $now=[DateTime]::UtcNow
  if (-not $lastSent.ContainsKey($key) -or ($now-$lastSent[$key]).TotalSeconds -ge 3) {
   [void][CapCutGracefulClose]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero); $lastSent[$key]=$now
  }
 }
 Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
throw 'CapCut did not finish saving/closing. Resolve its dialog; no original or candidate write was performed.'
