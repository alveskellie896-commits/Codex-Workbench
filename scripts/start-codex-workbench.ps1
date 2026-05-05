param([switch]$Worker)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $workspace "public-link.log"
$statePath = Join-Path $workspace "autostart.log"
$lockPath = Join-Path $workspace ".codex-run\workbench-autostart.lock"

function Write-State($message) {
  Add-Content -LiteralPath $statePath -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message)
}

function Test-WorkbenchHealth($port) {
  $url = "http://127.0.0.1:$port/api/client-meta"
  try {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      $output = & curl.exe -sS --max-time 4 $url 2>$null
      return ($LASTEXITCODE -eq 0 -and [string]$output -match '"pwaVersion"')
    }
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri $url
    return ($response.StatusCode -eq 200 -and $response.Content -match '"pwaVersion"')
  } catch {
    return $false
  }
}

function Resolve-CommandPath($name) {
  return (Get-Command $name -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockPath) | Out-Null
Set-Content -LiteralPath $lockPath -Value ("pid={0}; started={1}" -f $PID, (Get-Date -Format o))

$env:CODEX_REMOTE_PORT = if ($env:CODEX_REMOTE_PORT) { $env:CODEX_REMOTE_PORT } else { "8787" }
$env:CODEX_PUBLIC_TUNNEL = if ($env:CODEX_PUBLIC_TUNNEL) { $env:CODEX_PUBLIC_TUNNEL } else { "tailscale" }
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

if ($Worker) {
  Set-Location -LiteralPath $workspace
  $npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { (Get-Command npm.cmd).Source } else { Resolve-CommandPath "npm" }
  $nodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { (Get-Command node.exe).Source } else { Resolve-CommandPath "node" }

  while ($true) {
    Write-State "Launching Codex Workbench public service."
    & cmd.exe /d /s /c "chcp 65001 >nul & `"$npmCommand`" run build >> `"$logPath`" 2>&1"
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) {
      Write-State "Build failed with code $buildExitCode; retrying in 10 seconds."
      Start-Sleep -Seconds 10
      continue
    }

    & cmd.exe /d /s /c "chcp 65001 >nul & `"$nodeCommand`" src/server/publicTunnel.js >> `"$logPath`" 2>&1"
    $serviceExitCode = $LASTEXITCODE
    Write-State "Service exited with code $serviceExitCode; restarting in 5 seconds."
    Start-Sleep -Seconds 5
  }
}

$requestedPort = [int]$env:CODEX_REMOTE_PORT
if (Test-WorkbenchHealth $requestedPort) {
  Write-State "Codex Workbench is already healthy on port $requestedPort."
  exit 0
}

$existingWorker = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and
  $_.CommandLine -and
  $_.CommandLine -like "*start-codex-workbench.ps1*" -and
  $_.CommandLine -like "*-Worker*"
}

if ($existingWorker) {
  Write-State "Codex Workbench worker is already starting or running."
  exit 0
}

Write-State "Starting Codex Workbench in the background."
Start-Process powershell -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $PSCommandPath,
  "-Worker"
)
