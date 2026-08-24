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

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  [Console]::Error.WriteLine("[$ts] $Message")
}

function Write-Result {
  param($Object)
  $Object | ConvertTo-Json -Compress -Depth 6
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
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
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

function Get-WindowLines {
  param($PidSet)
  $script:windowLines = New-Object System.Collections.Generic.List[string]
  if ($PidSet.Count -eq 0) { return @() }
  $enum = {
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    $wid = [uint32]0
    [void][IdleInput]::GetWindowThreadProcessId($hwnd, [ref]$wid)
    if ($PidSet.ContainsKey([int]$wid)) {
      $title = New-Object System.Text.StringBuilder 512
      $cls = New-Object System.Text.StringBuilder 256
      [void][IdleInput]::GetWindowText($hwnd, $title, $title.Capacity)
      [void][IdleInput]::GetClassName($hwnd, $cls, $cls.Capacity)
      $vis = [IdleInput]::IsWindowVisible($hwnd)
      $script:windowLines.Add(("hwnd=0x{0:X} pid={1} visible={2} class={3} title={4}" -f $hwnd.ToInt64(), $wid, $vis, $cls.ToString(), $title.ToString()))
    }
    return $true
  }
  try {
    $handler = [IdleInput+EnumProc]$enum
    [void][IdleInput]::EnumWindows($handler, [IntPtr]::Zero)
  } catch {
    Write-Log "EnumWindows failed: $($_.Exception.Message)"
  }
  return @($script:windowLines)
}

function Write-ProcDump {
  param([string]$Label, $Procs)
  $list = @($Procs)
  Write-Log "$Label count=$($list.Count)"
  $pidSet = @{}
  foreach ($p in $list) {
    $hwnd = [int64]0
    $title = ""
    $responding = $false
    $start = ""
    $path = ""
    try { $hwnd = [int64]$p.MainWindowHandle } catch {}
    try { $title = [string]$p.MainWindowTitle } catch {}
    try { $responding = [bool]$p.Responding } catch {}
    try { $start = $p.StartTime.ToString("s") } catch {}
    try { $path = [string]$p.Path } catch {}
    $cmd = ""
    try {
      $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
      if ($wmi) { $cmd = [string]$wmi.CommandLine }
    } catch {}
    Write-Log ("  {0} pid={1} session={2} responding={3} hwnd=0x{4:X} title={5} start={6} path={7}" -f $p.ProcessName, $p.Id, $p.SessionId, $responding, $hwnd, $title, $start, $path)
    if ($cmd) { Write-Log "    cmd=$cmd" }
    $pidSet[[int]$p.Id] = $true
  }
  $windows = Get-WindowLines $pidSet
  Write-Log "$Label enum-windows=$($windows.Count)"
  foreach ($line in $windows) { Write-Log "  $line" }
}

function Write-RelatedDump {
  $related = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $n = $_.ProcessName.ToLower()
    $n -match "rider|jetbrains|fsnotifier"
  })
  Write-ProcDump "related-jetbrains" $related
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
    $ok = $false
    $hwnd = 0
    $title = ""
    try { $hwnd = [int64]$proc.MainWindowHandle } catch {}
    try { $title = [string]$proc.MainWindowTitle } catch {}
    try { $ok = $proc.CloseMainWindow() } catch {
      Write-Log "CloseMainWindow pid=$($proc.Id) error=$($_.Exception.Message)"
    }
    Write-Log "CloseMainWindow pid=$($proc.Id) hwnd=0x$($hwnd.ToString('X')) ok=$ok title=$title"
  }
  $pidSet = @{}
  foreach ($proc in $Procs) { $pidSet[[int]$proc.Id] = $true }
  $script:postedClose = 0
  $enum = {
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    $wid = [uint32]0
    [void][IdleInput]::GetWindowThreadProcessId($hwnd, [ref]$wid)
    if ($pidSet.ContainsKey([int]$wid)) {
      $posted = [IdleInput]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      $script:postedClose += 1
      Write-Log ("PostMessage WM_CLOSE hwnd=0x{0:X} pid={1} posted={2}" -f $hwnd.ToInt64(), $wid, $posted)
    }
    return $true
  }
  try {
    $handler = [IdleInput+EnumProc]$enum
    [void][IdleInput]::EnumWindows($handler, [IntPtr]::Zero)
    Write-Log "PostMessage WM_CLOSE total=$($script:postedClose)"
  } catch {
    Write-Log "EnumWindows PostMessage failed: $($_.Exception.Message)"
  }
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
      Write-Log "wait-resend remaining=$($alive.Count) pids=$($alive.Id -join ',')"
      Write-ProcDump "wait-remaining" $alive
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

function Force-Kill {
  param($Procs)
  $ids = @($Procs | ForEach-Object { [int]$_.Id })
  Write-Log "force-kill pids=$($ids -join ',')"
  foreach ($id in $ids) {
    try {
      $out = & taskkill.exe /PID $id /T /F 2>&1 | Out-String
      Write-Log "taskkill pid=$id $($out.Trim())"
    } catch {
      Write-Log "taskkill pid=$id error=$($_.Exception.Message)"
    }
  }
  Start-Sleep -Milliseconds 1500
  $remain = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
  Write-ProcDump "force-kill-after" $remain
  return $remain
}

function Complete-ForceKill {
  param($Idle, $Procs, $Reason)
  $before = @($Procs | ForEach-Object { ($_.ProcessName + ":" + $_.Id) })
  $remain = Force-Kill $Procs
  $remainTags = @($remain | ForEach-Object { ($_.ProcessName + ":" + $_.Id) })
  Write-Result ([pscustomobject]@{
      action    = "close"
      reason    = $Reason
      idleMs    = $Idle.idleMs
      elapsedMs = $Idle.elapsedMs
      killed    = $before
      remaining = $remainTags
    })
  if ($remain.Count -eq 0) {
    exit 0
  }
  exit 2
}

Write-Log "quit-idle names=$($names -join ',') idleForMs=$IdleForMs from=$CountIdleFrom until=$Until waitMs=$WaitMs retryIntervalMs=$RetryIntervalMs queryOnly=$QueryOnly"
$procs = Get-TargetProcs
Write-ProcDump "target" $procs
Write-RelatedDump

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
  Write-Log "skip outside-window now=$($now.ToString('s')) start=$($script:windowStart.ToString('s')) end=$($windowEnd.ToString('s'))"
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
  Write-Log ("idle snapshot idleMs={0} elapsedMs={1} needMs={2} lastInput={3} idleStart={4} enough={5}" -f $idle.idleMs, $idle.elapsedMs, $IdleForMs, $idle.lastInput.ToString("s"), $idle.idleStart.ToString("s"), $idle.idleEnough)
  Write-ProcDump "try-target" $current
  if (-not $idle.idleEnough) {
    Write-Log "outcome=idle-too-short"
    return [pscustomobject]@{ outcome = "idle-too-short"; idle = $idle; procs = $current }
  }
  if ($current.Count -eq 0) {
    Write-Log "outcome=none"
    return [pscustomobject]@{ outcome = "none"; idle = $idle; procs = $current }
  }
  if (Test-WindowlessOnly $current) {
    Write-Log "outcome=leftover-no-window (MainWindowHandle all zero)"
    Write-RelatedDump
    return [pscustomobject]@{ outcome = "leftover-no-window"; idle = $idle; procs = $current }
  }
  $targetPids = @($current | ForEach-Object { $_.Id })
  Write-Log "sending close to pids=$($targetPids -join ',')"
  Send-Close $current
  $remaining = Wait-ForExit $targetPids $WaitMs
  Write-ProcDump "after-wait" $remaining
  if ($remaining.Count -eq 0) {
    Write-Log "outcome=closed"
    return [pscustomobject]@{ outcome = "closed"; idle = $idle; procs = $current; targetPids = $targetPids }
  }
  if (Test-WindowlessOnly $remaining) {
    Write-Log "outcome=leftover-no-window after wait"
    Write-RelatedDump
    return [pscustomobject]@{ outcome = "leftover-no-window"; idle = $idle; procs = $remaining; targetPids = $targetPids }
  }
  Write-Log "outcome=timeout remaining=$($remaining.Count)"
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
  $killReason = if ($result.outcome -eq "leftover-no-window") { "leftover-forced-kill" } else { "timeout-forced-kill" }
  Complete-ForceKill $idle $result.procs $killReason
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
    Complete-ForceKill $lastIdle $result.procs "leftover-forced-kill"
  }
  if ($result.outcome -eq "timeout") {
    Complete-ForceKill $lastIdle $result.procs "timeout-forced-kill"
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
Complete-ForceKill $lastIdle $final "timeout-forced-kill"
