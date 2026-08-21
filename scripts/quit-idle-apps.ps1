param(
  [Parameter(Mandatory = $true)]
  [string]$ProcessNames,
  [Parameter(Mandatory = $true)]
  [int]$IdleForMs,
  [string]$CountIdleFrom = "00:00",
  [string]$Until = "08:00",
  [int]$WaitMs = 180000,
  [switch]$QueryOnly
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Write-Result {
  param($Object)
  $Object | ConvertTo-Json -Compress -Depth 5
}

function Parse-TodayTime {
  param([string]$Hhmm, [datetime]$Now)
  $parts = $Hhmm.Split(":")
  return Get-Date -Year $Now.Year -Month $Now.Month -Day $Now.Day -Hour ([int]$parts[0]) -Minute ([int]$parts[1]) -Second 0
}

$code = @"
using System;
using System.Runtime.InteropServices;
public static class IdleInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")]
  public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static uint IdleMs() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) { return 0; }
    uint tick = (uint)Environment.TickCount;
    return tick - info.dwTime;
  }
}
"@
try { Add-Type -TypeDefinition $code -ErrorAction Stop | Out-Null } catch {}

$names = @($ProcessNames.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$procs = @(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.Id -gt 0 })

if ($QueryOnly) {
  Write-Result ([pscustomobject]@{
      action = "query"
      count  = $procs.Count
      pids   = @($procs | ForEach-Object { $_.Id })
      names  = @($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
    })
  exit 0
}

$now = Get-Date
$windowStart = Parse-TodayTime $CountIdleFrom $now
$windowEnd = Parse-TodayTime $Until $now
if ($windowEnd -le $windowStart) {
  $windowEnd = $windowEnd.AddDays(1)
}

if ($now -lt $windowStart -or $now -ge $windowEnd) {
  Write-Result ([pscustomobject]@{
      action = "skip"
      reason = "outside-window"
      count  = $procs.Count
    })
  exit 0
}

$idleMs = [uint32]0
try { $idleMs = [IdleInput]::IdleMs() } catch { $idleMs = 0 }
$lastInput = $now.AddMilliseconds(-1 * [double]$idleMs)
$idleStart = $windowStart
if ($lastInput -gt $windowStart) {
  $idleStart = $lastInput
}
$elapsedMs = [int]($now - $idleStart).TotalMilliseconds
if ($elapsedMs -lt $IdleForMs) {
  Write-Result ([pscustomobject]@{
      action    = "skip"
      reason    = "idle-too-short"
      idleMs    = $idleMs
      elapsedMs = $elapsedMs
      needMs    = $IdleForMs
      lastInput = $lastInput.ToString("s")
      idleStart = $idleStart.ToString("s")
      count     = $procs.Count
    })
  exit 0
}

if ($procs.Count -eq 0) {
  Write-Result ([pscustomobject]@{
      action    = "none"
      reason    = "no-process"
      idleMs    = $idleMs
      elapsedMs = $elapsedMs
    })
  exit 0
}

$targetPids = @($procs | ForEach-Object { $_.Id })
foreach ($proc in $procs) {
  try { [void]$proc.CloseMainWindow() } catch {}
}

$pidSet = @{}
foreach ($id in $targetPids) { $pidSet[[int]$id] = $true }
$enum = {
  param([IntPtr]$hwnd, [IntPtr]$lParam)
  $wid = [uint32]0
  [void][IdleInput]::GetWindowThreadProcessId($hwnd, [ref]$wid)
  if ($pidSet.ContainsKey([int]$wid)) {
    [void][IdleInput]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  return $true
}
try {
  $handler = [IdleInput+EnumProc]$enum
  [void][IdleInput]::EnumWindows($handler, [IntPtr]::Zero)
} catch {}

$deadline = (Get-Date).AddMilliseconds($WaitMs)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1000
  $alive = @(Get-Process -Id $targetPids -ErrorAction SilentlyContinue)
  if ($alive.Count -eq 0) {
    Write-Result ([pscustomobject]@{
        action    = "close"
        reason    = "closed"
        idleMs    = $idleMs
        elapsedMs = $elapsedMs
        closed    = $targetPids
      })
    exit 0
  }
}

$remaining = @(Get-Process -Id $targetPids -ErrorAction SilentlyContinue)
$remainTags = @($remaining | ForEach-Object { ($_.ProcessName + ":" + $_.Id) })
$closed = @($targetPids | Where-Object { $remainTags -notmatch (":" + $_) })
Write-Result ([pscustomobject]@{
    action    = "timeout"
    reason    = "graceful-timeout"
    idleMs    = $idleMs
    closed    = $closed
    remaining = $remainTags
  })
exit 2
