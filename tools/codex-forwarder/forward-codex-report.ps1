param(
  [string]$AutomationId = "skill-radar",
  [string]$WorkerUrl = "https://personal-radar.jiojioyizeradar.workers.dev",
  [string]$SecretsPath = (Join-Path (Resolve-Path ".") ".secrets.local"),
  [string]$StatePath = (Join-Path (Resolve-Path ".") ".codex-forwarder-state.json"),
  [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }),
  [string]$ReportPath = "",
  [string]$Category = "skill-radar",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [int]$LookbackHours = 36
)

$ErrorActionPreference = "Stop"

function Read-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Secrets file not found: $Path"
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*#") { continue }
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.+?)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  throw "Missing $Name in $Path"
}

function Read-State {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{ sent = @{}; pending = @() }
  }
  $state = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  $sent = @{}
  if ($state.sent) {
    foreach ($property in $state.sent.PSObject.Properties) {
      $sent[$property.Name] = $property.Value
    }
  }
  $pending = @()
  if ($state.pending) {
    $pending = @($state.pending)
  }
  return @{ sent = $sent; pending = $pending }
}

function Write-State {
  param([string]$Path, [hashtable]$State)
  $payload = [ordered]@{
    sent = $State.sent
    pending = @($State.pending)
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-TextFromJson {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [string]) { return @($Value) }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += Get-TextFromJson $item
    }
    return $items
  }
  if ($Value.PSObject.Properties) {
    $items = @()
    foreach ($property in $Value.PSObject.Properties) {
      if ($property.Name -in @("encrypted_content", "arguments")) { continue }
      $items += Get-TextFromJson $property.Value
    }
    return $items
  }
  return @()
}

function Select-ReportMarkdown {
  param([string]$Text)
  if (-not $Text) { return $null }
  $start = $Text.IndexOf("# Skill Radar Deep Dive")
  if ($start -lt 0) {
    $start = $Text.IndexOf("# Personal Radar")
  }
  if ($start -lt 0) { return $null }

  $report = $Text.Substring($start).Trim()
  $report = [regex]::Replace($report, "(?m)^::inbox-item\{.*\}\s*$", "").Trim()
  if ($report.Length -lt 300) { return $null }
  if ($report -notmatch "##\s+1\." -and $report -notmatch "## Suggested Next Installs") { return $null }
  return $report
}

function Get-ReportFromJsonlFile {
  param([System.IO.FileInfo]$File, [string]$AutomationId)
  $best = $null
  foreach ($line in Get-Content -LiteralPath $File.FullName -ErrorAction SilentlyContinue) {
    if (-not $line.Trim()) { continue }
    try {
      $json = $line | ConvertFrom-Json -ErrorAction Stop
    } catch {
      continue
    }
    $texts = Get-TextFromJson $json
    foreach ($text in $texts) {
      $report = Select-ReportMarkdown -Text $text
      if (-not $report) { continue }
      $looksLikeAutomation = $report -match [regex]::Escape($AutomationId) -or $report -match "Codex|Claude|Cursor|Cline|Roo|SKILL\.md"
      if ($looksLikeAutomation) {
        $best = $report
      }
    }
  }
  return $best
}

function Find-LatestCodexReport {
  param([string]$CodexHome, [string]$AutomationId, [int]$LookbackHours)
  $sessionsRoot = Join-Path $CodexHome "sessions"
  if (-not (Test-Path -LiteralPath $sessionsRoot)) {
    throw "Codex sessions directory not found: $sessionsRoot"
  }
  $since = (Get-Date).AddHours(-1 * $LookbackHours)
  $files = Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Filter "*.jsonl" |
    Where-Object { $_.LastWriteTime -ge $since } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 80

  foreach ($file in $files) {
    $report = Get-ReportFromJsonlFile -File $file -AutomationId $AutomationId
    if ($report) {
      return [ordered]@{
        content = $report
        source = $file.FullName
        generatedAt = $file.LastWriteTimeUtc.ToString("o")
      }
    }
  }
  throw "No recent Codex report found for $AutomationId"
}

function Get-ReportHash {
  param([string]$Content)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
  return [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
}

function Send-Report {
  param(
    [string]$Endpoint,
    [string]$Key,
    [hashtable]$Payload
  )
  Invoke-RestMethod `
    -Uri $Endpoint `
    -Method Post `
    -Headers @{ "x-radar-ingest-key" = $Key } `
    -ContentType "application/json" `
    -Body ($Payload | ConvertTo-Json -Depth 8)
}

$ingestKey = Read-DotEnvValue -Path $SecretsPath -Name "DEEP_REPORT_INGEST_KEY"
$state = Read-State -Path $StatePath

if ($ReportPath) {
  if (-not (Test-Path -LiteralPath $ReportPath)) {
    throw "Report file not found: $ReportPath"
  }
  $report = [ordered]@{
    content = Get-Content -Raw -LiteralPath $ReportPath
    source = (Resolve-Path -LiteralPath $ReportPath).Path
    generatedAt = (Get-Item -LiteralPath $ReportPath).LastWriteTimeUtc.ToString("o")
  }
} else {
  $report = Find-LatestCodexReport -CodexHome $CodexHome -AutomationId $AutomationId -LookbackHours $LookbackHours
}

$hash = Get-ReportHash -Content $report.content
$sourceRunId = "$AutomationId-$hash"
if ($state.sent.ContainsKey($sourceRunId)) {
  Write-Host "Already forwarded $sourceRunId"
  return
}

$title = if ($report.content -match "(?m)^#\s+(.+)$") { $Matches[1].Trim() } else { "Skill Radar Deep Dive" }
$payload = @{
  title = $title
  content = $report.content
  category = $Category
  visibility = $Visibility
  generatedAt = $report.generatedAt
  sourceRunId = $sourceRunId
}
$endpoint = "$($WorkerUrl.TrimEnd('/'))/ingest-report"

try {
  $response = Send-Report -Endpoint $endpoint -Key $ingestKey -Payload $payload
  $state.sent[$sourceRunId] = [ordered]@{
    sentAt = (Get-Date).ToUniversalTime().ToString("o")
    source = $report.source
    category = $Category
    visibility = $Visibility
    workerResponse = $response
  }
  $state.pending = @($state.pending | Where-Object { $_.sourceRunId -ne $sourceRunId })
  Write-State -Path $StatePath -State $state
  Write-Host "Forwarded $sourceRunId to $endpoint"
} catch {
  $state.pending = @($state.pending | Where-Object { $_.sourceRunId -ne $sourceRunId })
  $state.pending += [ordered]@{
    sourceRunId = $sourceRunId
    failedAt = (Get-Date).ToUniversalTime().ToString("o")
    source = $report.source
    category = $Category
    visibility = $Visibility
    error = $_.Exception.Message
  }
  Write-State -Path $StatePath -State $state
  throw
}
