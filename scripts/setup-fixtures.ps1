$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$fixtures = Join-Path $root "fixtures"
New-Item -ItemType Directory -Force -Path "$fixtures\svn-repo" | Out-Null
if (-not (Test-Path "$fixtures\svn-repo\format")) {
  svnadmin create "$fixtures\svn-repo"
}
$repoUrl = "file:///" + ($fixtures.Replace("\", "/")) + "/svn-repo"
if (-not (Test-Path "$fixtures\wc\.svn")) {
  svn checkout $repoUrl "$fixtures\wc"
}
New-Item -ItemType Directory -Force -Path "$fixtures\wc\ProjectSettings" | Out-Null
Set-Content -Path "$fixtures\wc\ProjectSettings\ProjectVersion.txt" -Value "m_EditorVersion: 2022.3.21f1`n" -Encoding utf8
if (-not (Test-Path "$fixtures\tools-wc\.svn")) {
  svn checkout $repoUrl "$fixtures\tools-wc"
}
New-Item -ItemType Directory -Force -Path "$fixtures\tools-wc\scripts" | Out-Null
Set-Content -Path "$fixtures\tools-wc\scripts\nightly-check.ps1" -Value "Write-Host 'nightly-check ok'" -Encoding utf8
Write-Host "fixtures ready under $fixtures"
