param(
  [Parameter(Mandatory = $true)]
  [int]$WaitPid,

  [Parameter(Mandatory = $true)]
  [string]$RequestPath
)

$ErrorActionPreference = "Stop"

# Windows 不允许替换仍在运行的根 exe。先等 Electron 主进程完全退出，再启动
# 独立 sidecar；请求放 JSON 文件里，避免路径空格经过多层命令行转义后变形。
Wait-Process -Id $WaitPid -ErrorAction SilentlyContinue

$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
if (-not $request.sidecar -or -not (Test-Path -LiteralPath $request.sidecar -PathType Leaf)) {
  throw "apply sidecar not found: $($request.sidecar)"
}

$arguments = @($request.arguments | ForEach-Object { [string]$_ })
& ([string]$request.sidecar) @arguments
exit $LASTEXITCODE
