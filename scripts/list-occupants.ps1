param(
  [Parameter(Mandatory = $true)]
  [string]$Target
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
foreach ($candidate in @(
    $target,
    (Join-Path $target ".svn\wc.db"),
    (Join-Path $target "Project\Temp\UnityLockfile"),
    (Join-Path $target "Temp\UnityLockfile")
  )) {
  if (Test-Path $candidate) { [void]$files.Add($candidate) }
}

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

if ($files.Count -gt 0) {
  $session = [uint32]0
  $key = [guid]::NewGuid().ToString()
  try {
    if ([RestartMgr]::RmStartSession([ref]$session, 0, $key) -eq 0) {
      $fileArray = $files.ToArray()
      [void][RestartMgr]::RmRegisterResources($session, [uint32]$fileArray.Length, $fileArray, 0, [IntPtr]::Zero, 0, $null)
      $needed = [uint32]0
      $count = [uint32]0
      $reason = [uint32]0
      [void][RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reason)
      if ($needed -gt 0) {
        $infos = New-Object RestartMgr+RM_PROCESS_INFO[] $needed
        $count = $needed
        [void][RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $infos, [ref]$reason)
        foreach ($info in $infos) {
          if ($info.Process.dwProcessId -gt 0) {
            Add-Result $info.Process.dwProcessId $info.strAppName "restart-manager" ""
          }
        }
      }
    }
  } catch {
  } finally {
    if ($session -ne 0) { [void][RestartMgr]::RmEndSession($session) }
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
