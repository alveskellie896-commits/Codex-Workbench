param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [string]$Out
)

$ErrorActionPreference = "Stop"
$resolved = Resolve-Path -LiteralPath $Path
$output = if ($Out) { $Out } else { "$($resolved.Path).base64" }

[Convert]::ToBase64String([IO.File]::ReadAllBytes($resolved.Path)) | Set-Content -Path $output -NoNewline

Write-Host "Base64 written to:"
Write-Host $output
