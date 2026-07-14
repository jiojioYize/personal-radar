param(
  [string]$AutomationId = "skill-radar",
  [string]$WorkerUrl = "https://radar.dailyingest.cn",
  [string]$SecretsPath = (Join-Path (Resolve-Path ".") ".secrets.local"),
  [string]$StatePath = (Join-Path (Resolve-Path ".") ".codex-forwarder-state.json"),
  [string]$LogPath = (Join-Path (Resolve-Path ".") ".codex-forwarder.log"),
  [string]$OutboxDir = (Join-Path (Resolve-Path ".") "reports\outbox"),
  [string]$ReportPath = "",
  [string]$Category = "skill-radar",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [int]$LookbackHours = 36,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message)
  $line = "[$((Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz"))] $Message"
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Read-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Secrets file not found: $Path"
  }
  foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $Path) {
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
  $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
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

function Select-ReportMarkdown {
  param([string]$Text)
  if (-not $Text) { return $null }
  $start = $Text.IndexOf("<!-- zh -->")
  if ($start -lt 0) { return $null }

  $report = $Text.Substring($start).Trim()
  $report = [regex]::Replace($report, "(?m)^::inbox-item\{.*\}\s*$", "").Trim()
  if ($report.Length -lt 100) { return $null }
  if ($report -notmatch "(?s)<!--\s*zh\s*-->.*<!--\s*/zh\s*-->") { return $null }
  if ($report -notmatch "(?s)<!--\s*en\s*-->.*<!--\s*/en\s*-->") { return $null }
  if ($report -notmatch "(?m)^#\s+Skill Radar Deep Dive\s+-\s+\d{4}-\d{2}-\d{2}\s*$") { return $null }
  $zh = Get-MarkedSection -Text $report -Name "zh"
  $en = Get-MarkedSection -Text $report -Name "en"
  if (-not $zh -or -not $en) { return $null }
  return $report
}

function Assert-ReadableReport {
  param([string]$Content)
  $mojibakeMarkers = @(0x6D93, 0x93B6, 0x935B, 0x9428, 0x7EDB, 0x6769, 0x93C4, 0x6D60, 0x9359, 0x5BEE, 0x20AC) |
    ForEach-Object { [string][char]$_ }
  $pattern = ($mojibakeMarkers | ForEach-Object { [regex]::Escape($_) }) -join "|"
  $mojibakeMatches = [regex]::Matches($Content, $pattern).Count
  if ($mojibakeMatches -ge 5) {
    throw "Report looks mojibaked before ingest; refusing to send. Check UTF-8 decoding."
  }
}

function Get-MarkedSection {
  param([string]$Text, [string]$Name)
  $pattern = "(?s)<!--\s*$([regex]::Escape($Name))\s*-->\s*(.*?)\s*<!--\s*/$([regex]::Escape($Name))\s*-->"
  $match = [regex]::Match($Text, $pattern)
  if ($match.Success) {
    return $match.Groups[1].Value.Trim()
  }
  return $null
}

function Split-ReportLanguages {
  param([string]$Content)
  $zh = Get-MarkedSection -Text $Content -Name "zh"
  $en = Get-MarkedSection -Text $Content -Name "en"
  if ($zh -or $en) {
    return [ordered]@{
      contentZh = $zh
      contentEn = $en
      content = $(if ($zh) { $zh } else { $en })
    }
  }
  return [ordered]@{
    contentZh = $null
    contentEn = $Content
    content = $Content
  }
}

function Find-LatestOutboxReport {
  param([string]$OutboxDir, [int]$LookbackHours)
  if (-not (Test-Path -LiteralPath $OutboxDir)) {
    return $null
  }

  $since = (Get-Date).AddHours(-1 * $LookbackHours)
  $files = Get-ChildItem -LiteralPath $OutboxDir -File -Filter "*.md" |
    Where-Object { $_.LastWriteTime -ge $since } |
    Sort-Object LastWriteTime -Descending

  foreach ($file in $files) {
    $sidecarPath = $file.FullName -replace "\.md$", ".quality.json"
    if (-not (Test-Path -LiteralPath $sidecarPath)) {
      continue
    }
    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
    $report = Select-ReportMarkdown -Text $content
    if ($report) {
      return [ordered]@{
        content = $report
        source = $file.FullName
        sidecarSource = $sidecarPath
        generatedAt = $file.LastWriteTimeUtc.ToString("o")
      }
    }
  }

  return $null
}

function Read-StructuredReport {
  param(
    [string]$SidecarPath,
    [string]$MarkdownPath,
    [string]$MarkdownContent
  )
  if (-not (Test-Path -LiteralPath $SidecarPath)) {
    throw "Structured report sidecar not found: $SidecarPath"
  }

  $structured = Get-Content -Raw -Encoding UTF8 -LiteralPath $SidecarPath | ConvertFrom-Json
  if ($structured.schemaVersion -notin @(2, 3)) {
    throw "Unsupported structured report schemaVersion in $SidecarPath"
  }
  if ($structured.channel -ne "skill-radar") {
    throw "Structured report channel must be skill-radar"
  }
  if ($structured.status -notin @("published", "no_update")) {
    throw "Structured report status must be published or no_update"
  }

  $fileName = [System.IO.Path]::GetFileName($MarkdownPath)
  if ($fileName -notmatch "^skill-radar-(\d{4}-\d{2}-\d{2})\.md$") {
    throw "Markdown filename does not match the Stage 2 report convention: $fileName"
  }
  if ($structured.reportDate -ne $Matches[1]) {
    throw "Sidecar reportDate does not match Markdown filename"
  }

  $items = @($structured.items)
  if ($structured.status -eq "published" -and ($items.Count -lt 1 -or $items.Count -gt 6)) {
    throw "Published structured reports must contain 1-6 items"
  }
  if ($structured.status -eq "no_update" -and $items.Count -ne 0) {
    throw "no_update structured reports must contain zero items"
  }
  if ([int]$structured.stats.selectedCount -ne $items.Count) {
    throw "Sidecar selectedCount does not match items"
  }

  $lastPosition = -1
  foreach ($item in $items) {
    if (-not $item.title -or -not $item.sourceUrl) {
      throw "Every structured item needs title and sourceUrl"
    }
    if ($item.sourceUrl -notmatch "^https://") {
      throw "Structured item sourceUrl must use HTTPS: $($item.sourceUrl)"
    }
    $escapedTitle = [regex]::Escape([string]$item.title)
    $headingMatch = [regex]::Match(
      $MarkdownContent,
      "(?m)^##\s+\d+\.\s+$escapedTitle\s*$"
    )
    if (-not $headingMatch.Success) {
      throw "Structured item title is missing from Markdown: $($item.title)"
    }
    $position = $headingMatch.Index
    if ($position -lt $lastPosition) {
      throw "Structured item order does not match Markdown"
    }
    if (-not $MarkdownContent.Contains([string]$item.sourceUrl)) {
      throw "Structured item source is missing from Markdown: $($item.sourceUrl)"
    }
    $lastPosition = $position
  }

  return $structured
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
  $json = $Payload | ConvertTo-Json -Depth 20
  $bodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  Invoke-RestMethod `
    -Uri $Endpoint `
    -Method Post `
    -Headers @{ "x-radar-ingest-key" = $Key } `
    -ContentType "application/json; charset=utf-8" `
    -Body $bodyBytes
}

$state = Read-State -Path $StatePath
Write-Log "Forwarder started. AutomationId=$AutomationId Category=$Category Visibility=$Visibility LookbackHours=$LookbackHours OutboxDir=$OutboxDir"

if ($ReportPath) {
  if (-not (Test-Path -LiteralPath $ReportPath)) {
    throw "Report file not found: $ReportPath"
  }
  $report = [ordered]@{
    content = Get-Content -Raw -Encoding UTF8 -LiteralPath $ReportPath
    source = (Resolve-Path -LiteralPath $ReportPath).Path
    sidecarSource = ((Resolve-Path -LiteralPath $ReportPath).Path -replace "\.md$", ".quality.json")
    generatedAt = (Get-Item -LiteralPath $ReportPath).LastWriteTimeUtc.ToString("o")
  }
} else {
  $report = Find-LatestOutboxReport -OutboxDir $OutboxDir -LookbackHours $LookbackHours
  if ($report) {
    Write-Log "Using outbox report: $($report.source)"
  } else {
    Write-Log "No recent outbox report found for $AutomationId"
    return
  }
}

$localized = Split-ReportLanguages -Content $report.content
Assert-ReadableReport -Content ($localized.contentZh + "`n" + $localized.contentEn)
$structuredReport = Read-StructuredReport `
  -SidecarPath $report.sidecarSource `
  -MarkdownPath $report.source `
  -MarkdownContent $report.content
if ($ValidateOnly) {
  Write-Log "Validated Stage 2 report pair. Markdown=$($report.source) Sidecar=$($report.sidecarSource) Status=$($structuredReport.status) Items=$(@($structuredReport.items).Count)"
  return
}

$ingestKey = Read-DotEnvValue -Path $SecretsPath -Name "DEEP_REPORT_INGEST_KEY"
$hashSourceZh = if ($localized.contentZh) { $localized.contentZh } else { "" }
$hashSourceEn = if ($localized.contentEn) { $localized.contentEn } else { "" }
$structuredHashSource = $structuredReport | ConvertTo-Json -Depth 20 -Compress
$hash = Get-ReportHash -Content ($hashSourceZh + "`n---EN---`n" + $hashSourceEn + "`n---STRUCTURED---`n" + $structuredHashSource)
$sourceRunId = "$AutomationId-$hash"
if ($state.sent.ContainsKey($sourceRunId)) {
  Write-Log "Already forwarded $sourceRunId"
  return
}

$title = if ($localized.content -match "(?m)^#\s+(.+)$") { $Matches[1].Trim() } else { "Skill Radar Deep Dive" }
$payload = @{
  title = $title
  content = $localized.content
  contentZh = $localized.contentZh
  contentEn = $localized.contentEn
  pushLanguage = "zh"
  category = $Category
  visibility = $Visibility
  generatedAt = $report.generatedAt
  sourceRunId = $sourceRunId
  structuredReport = $structuredReport
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
  $stored = if ($null -ne $response.stored) { $response.stored } else { "unknown" }
  $pushed = if ($null -ne $response.pushed) { $response.pushed } else { "unknown" }
  $duplicate = if ($null -ne $response.duplicate) { $response.duplicate } else { "false" }
  $reason = if ($response.reason) { " reason=$($response.reason)" } else { "" }
  Write-Log "Worker accepted $sourceRunId. stored=$stored pushed=$pushed duplicate=$duplicate$reason endpoint=$endpoint"
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
  Write-Log "Failed to forward $sourceRunId`: $($_.Exception.Message)"
  throw
}
