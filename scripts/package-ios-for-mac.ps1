$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktop = [Environment]::GetFolderPath("Desktop")
$stagingRoot = Join-Path $env:TEMP "Codex-Workbench-iOS-package"
$staging = Join-Path $stagingRoot "Codex-Workbench"
$zipPath = Join-Path $desktop "Codex-Workbench-iOS.zip"

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $staging | Out-Null

$excludeDirs = @(
  "node_modules",
  "dist",
  ".git",
  ".codex-run",
  "coverage",
  "DerivedData"
)

$excludeFiles = @(
  ".env",
  "publicTunnel.stderr.log",
  "publicTunnel.stdout.log"
)

Get-ChildItem -LiteralPath $repoRoot -Force | ForEach-Object {
  if (($excludeDirs -notcontains $_.Name) -and ($excludeFiles -notcontains $_.Name)) {
    $target = Join-Path $staging $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
  }
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path $staging -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Host "iOS package created:"
Write-Host $zipPath
Write-Host ""
Write-Host "Send this zip to a Mac, unzip it, then read ios/CodexWorkbench/INSTALL_ZH.md."
