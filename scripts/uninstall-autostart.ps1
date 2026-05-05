$ErrorActionPreference = "Stop"

$taskName = "CodexWorkbenchAutostart"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed autostart task: $taskName"
} else {
  Write-Output "Autostart task not found: $taskName"
}
