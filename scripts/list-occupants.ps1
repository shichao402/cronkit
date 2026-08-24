param(
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [string]$FileList = ""
)

$ErrorActionPreference = "Continue"
$target = [System.IO.Path]::GetFullPath($Target).TrimEnd("\", "/")
$list = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param($PidValue, $Name, $Source, $CommandLine)
  if (-not $PidValue) { return }
  $list.Add([pscustomobject]@{
      pid = [int]$PidValue
      name = [string]$Name
      source = [string]$Source
      commandLine = [string]$CommandLine
    }) | Out-Null
}

$needle = $target.Replace("\", "/").ToLowerInvariant()
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = [string]$_.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return }
  $norm = $cmd.Replace("\", "/").ToLowerInvariant()
  if ($norm.Contains($needle)) {
    Add-Result $_.ProcessId $_.Name "cmdline" $cmd
  }
}

$files = New-Object System.Collections.Generic.List[string]
function Add-File {
  param([string]$Candidate)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return }
  try {
    $full = [System.IO.Path]::GetFullPath($Candidate)
  } catch {
    return
  }
  if (Test-Path -LiteralPath $full) {
    [void]$files.Add($full)
  }
}

foreach ($candidate in @(
    $target,
    (Join-Path $target ".svn\wc.db"),
    (Join-Path $target "Project\Temp\UnityLockfile"),
    (Join-Path $target "Temp\UnityLockfile")
  )) {
  Add-File $candidate
}

if ($FileList -and (Test-Path -LiteralPath $FileList)) {
  Get-Content -LiteralPath $FileList -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object {
    Add-File $_
  }
}

$uniqueFiles = $files | Sort-Object -Unique

$code = @"
using System;
using System.Runtime.InteropServices;
public static class RestartMgr {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
}
"@
try { Add-Type -TypeDefinition $code -ErrorAction Stop | Out-Null } catch {}

function Get-RestartManagerPids {
  param([string[]]$Batch)
  if ($null -eq $Batch -or $Batch.Length -eq 0) { return }
  $session = [uint32]0
  $key = [guid]::NewGuid().ToString()
  try {
    if ([RestartMgr]::RmStartSession([ref]$session, 0, $key) -ne 0) { return }
    [void][RestartMgr]::RmRegisterResources($session, [uint32]$Batch.Length, $Batch, 0, [IntPtr]::Zero, 0, $null)
    $needed = [uint32]0
    $count = [uint32]0
    $reason = [uint32]0
    [void][RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reason)
    if ($needed -le 0) { return }
    $infos = New-Object RestartMgr+RM_PROCESS_INFO[] $needed
    $count = $needed
    [void][RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $infos, [ref]$reason)
    foreach ($info in $infos) {
      if ($info.Process.dwProcessId -gt 0) {
        Add-Result $info.Process.dwProcessId $info.strAppName "restart-manager" ""
      }
    }
  } catch {
  } finally {
    if ($session -ne 0) { [void][RestartMgr]::RmEndSession($session) }
  }
}

if ($uniqueFiles) {
  $arr = @($uniqueFiles)
  $batchSize = 64
  for ($i = 0; $i -lt $arr.Length; $i += $batchSize) {
    $end = [Math]::Min($i + $batchSize - 1, $arr.Length - 1)
    Get-RestartManagerPids -Batch $arr[$i..$end]
  }
}

$unique = $list | Sort-Object pid -Unique
if ($null -eq $unique) {
  Write-Output "[]"
} elseif ($unique -is [System.Array]) {
  $unique | ConvertTo-Json -Compress
} else {
  "[" + ($unique | ConvertTo-Json -Compress) + "]"
}
