$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logPath = Join-Path $projectRoot ".github-discovery.log"
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot "collect-github.mjs"

try {
  $output = & $node --disable-warning=ExperimentalWarning $script 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $status = if ($exitCode -eq 0) { "SUCCESS" } else { "FAILED" }
  $entry = "[{0}] {1}`r`n{2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $status, $output.Trim()
  Add-Content -LiteralPath $logPath -Value $entry -Encoding UTF8
  exit $exitCode
} catch {
  $entry = "[{0}] FAILED`r`n{1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message
  Add-Content -LiteralPath $logPath -Value $entry -Encoding UTF8
  exit 1
}
