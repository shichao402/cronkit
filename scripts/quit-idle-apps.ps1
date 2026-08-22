param(
  [Parameter(Mandatory = $true)]
  [string]$ProcessNames,
  [Parameter(Mandatory = $true)]
  [int]$IdleForMs,
  [string]$CountIdleFrom = "00:00",
  [string]$Until = "08:00",
  [int]$WaitMs = 180000,
  [int]$RetryIntervalMs = 0,
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

function Get-TargetProcs {
  @(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.Id -gt 0 })
}

function Get-IdleSnapshot {
  $now = Get-Date
  $idleMs = [uint32]0
  try { $idleMs = [IdleInput]::IdleMs() } catch { $idleMs = 0 }
  $lastInput = $now.AddMilliseconds(-1 * [double]$idleMs)
  $idleStart = $script:windowStart
  if ($lastInput -gt $script:windowStart) {
    $idleStart = $lastInput
  }
  $elapsedMs = [int]($now - $idleStart).TotalMilliseconds
  return [pscustomobject]@{
    now        = $now
    idleMs     = $idleMs
    lastInput  = $lastInput
    idleStart  = $idleStart
    elapsedMs  = $elapsedMs
    idleEnough = ($elapsedMs -ge $IdleForMs)
  }
}

function Send-Close {
  param($Procs)
  foreach ($proc in $Procs) {
    try { [void]$proc.CloseMainWindow() } catch {}
  }
  $pidSet = @{}
  foreach ($proc in $Procs) { $pidSet[[int]$proc.Id] = $true }
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
}

function Wait-ForExit {
  param($TargetPids, $WaitMsLocal)
  $deadline = (Get-Date).AddMilliseconds($WaitMsLocal)
  $resendEvery = [Math]::Min(15000, [Math]::Max(3000, [int]($WaitMsLocal / 6)))
  $nextResend = (Get-Date).AddMilliseconds($resendEvery)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    $alive = @(Get-Process -Id $TargetPids -ErrorAction SilentlyContinue)
    if ($alive.Count -eq 0) {
      return @()
    }
    if ((Get-Date) -ge $nextResend) {
      Send-Close $alive
      $nextResend = (Get-Date).AddMilliseconds($resendEvery)
    }
  }
  return @(Get-Process -Id $TargetPids -ErrorAction SilentlyContinue)
}

function Test-WindowlessOnly {
  param($Procs)
  if ($Procs.Count -eq 0) { return $false }
  $withWindow = @($Procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
  return ($withWindow.Count -eq 0)
}

function Write-Timeout {
  param($Idle, $TargetPids, $Remaining, $Reason)
  $remainTags = @($Remaining | ForEach-Object { ($_.ProcessName + ":" + $_.Id) })
  $closed = @($TargetPids | Where-Object { $remainTags -notmatch (":" + $_) })
  Write-Result ([pscustomobject]@{
      action    = "timeout"
      reason    = $Reason
      idleMs    = $Idle.idleMs
      elapsedMs = $Idle.elapsedMs
      closed    = $closed
      remaining = $remainTags
    })
}

$procs = Get-TargetProcs

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
$script:windowStart = Parse-TodayTime $CountIdleFrom $now
$windowEnd = Parse-TodayTime $Until $now
if ($windowEnd -le $script:windowStart) {
  $windowEnd = $windowEnd.AddDays(1)
}

if ($now -lt $script:windowStart -or $now -ge $windowEnd) {
  Write-Result ([pscustomobject]@{
      action = "skip"
      reason = "outside-window"
      count  = $procs.Count
    })
  exit 0
}

function Try-CloseOnce {
  $idle = Get-IdleSnapshot
  $current = Get-TargetProcs
  if (-not $idle.idleEnough) {
    return [pscustomobject]@{ outcome = "idle-too-short"; idle = $idle; procs = $current }
  }
  if ($current.Count -eq 0) {
    return [pscustomobject]@{ outcome = "none"; idle = $idle; procs = $current }
  }
  if (Test-WindowlessOnly $current) {
    return [pscustomobject]@{ outcome = "leftover-no-window"; idle = $idle; procs = $current }
  }
  $targetPids = @($current | ForEach-Object { $_.Id })
  Send-Close $current
  $remaining = Wait-ForExit $targetPids $WaitMs
  if ($remaining.Count -eq 0) {
    return [pscustomobject]@{ outcome = "closed"; idle = $idle; procs = $current; targetPids = $targetPids }
  }
  if (Test-WindowlessOnly $remaining) {
    return [pscustomobject]@{ outcome = "leftover-no-window"; idle = $idle; procs = $remaining; targetPids = $targetPids }
  }
  return [pscustomobject]@{ outcome = "timeout"; idle = $idle; procs = $remaining; targetPids = $targetPids }
}

if ($RetryIntervalMs -le 0) {
  $result = Try-CloseOnce
  $idle = $result.idle
  if ($result.outcome -eq "idle-too-short") {
    Write-Result ([pscustomobject]@{
        action    = "skip"
        reason    = "idle-too-short"
        idleMs    = $idle.idleMs
        elapsedMs = $idle.elapsedMs
        needMs    = $IdleForMs
        lastInput = $idle.lastInput.ToString("s")
        idleStart = $idle.idleStart.ToString("s")
        count     = $result.procs.Count
      })
    exit 0
  }
  if ($result.outcome -eq "none") {
    Write-Result ([pscustomobject]@{
        action    = "none"
        reason    = "no-process"
        idleMs    = $idle.idleMs
        elapsedMs = $idle.elapsedMs
      })
    exit 0
  }
  if ($result.outcome -eq "closed") {
    Write-Result ([pscustomobject]@{
        action    = "close"
        reason    = "closed"
        idleMs    = $idle.idleMs
        elapsedMs = $idle.elapsedMs
        closed    = $result.targetPids
      })
    exit 0
  }
  $reason = if ($result.outcome -eq "leftover-no-window") { "leftover-no-window" } else { "graceful-timeout" }
  $pids = @($result.targetPids)
  if (-not $pids) { $pids = @($result.procs | ForEach-Object { $_.Id }) }
  Write-Timeout $idle $pids $result.procs $reason
  exit 2
}

$lastIdle = Get-IdleSnapshot
while ((Get-Date) -lt $windowEnd) {
  $result = Try-CloseOnce
  $lastIdle = $result.idle
  if ($result.outcome -eq "closed") {
    Write-Result ([pscustomobject]@{
        action    = "close"
        reason    = "closed"
        idleMs    = $lastIdle.idleMs
        elapsedMs = $lastIdle.elapsedMs
        closed    = $result.targetPids
      })
    exit 0
  }
  if ($result.outcome -eq "none") {
    Write-Result ([pscustomobject]@{
        action    = "none"
        reason    = "no-process"
        idleMs    = $lastIdle.idleMs
        elapsedMs = $lastIdle.elapsedMs
      })
    exit 0
  }
  if ($result.outcome -eq "leftover-no-window") {
    $pids = @($result.targetPids)
    if (-not $pids) { $pids = @($result.procs | ForEach-Object { $_.Id }) }
    Write-Timeout $lastIdle $pids $result.procs "leftover-no-window"
    exit 2
  }
  $sleepMs = $RetryIntervalMs
  $remainMs = [int]($windowEnd - (Get-Date)).TotalMilliseconds
  if ($remainMs -le 0) { break }
  if ($sleepMs -gt $remainMs) { $sleepMs = $remainMs }
  Start-Sleep -Milliseconds $sleepMs
}

$final = Get-TargetProcs
if ($final.Count -eq 0) {
  Write-Result ([pscustomobject]@{
      action    = "none"
      reason    = "no-process"
      idleMs    = $lastIdle.idleMs
      elapsedMs = $lastIdle.elapsedMs
    })
  exit 0
}
if (-not $lastIdle.idleEnough) {
  Write-Result ([pscustomobject]@{
      action    = "skip"
      reason    = "idle-too-short"
      idleMs    = $lastIdle.idleMs
      elapsedMs = $lastIdle.elapsedMs
      needMs    = $IdleForMs
      lastInput = $lastIdle.lastInput.ToString("s")
      idleStart = $lastIdle.idleStart.ToString("s")
      count     = $final.Count
    })
  exit 0
}
Write-Timeout $lastIdle @($final | ForEach-Object { $_.Id }) $final "graceful-timeout"
exit 2
