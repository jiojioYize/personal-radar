param(
  [string]$AutomationId = "skill-radar",
  [string]$WorkerUrl = "https://radar.dailyingest.cn",
  [string]$SecretsPath = (Join-Path (Resolve-Path ".") ".secrets.local"),
  [string]$StatePath = (Join-Path (Resolve-Path ".") ".codex-forwarder-state.json"),
  [string]$LogPath = (Join-Path (Resolve-Path ".") ".codex-forwarder.log"),
  [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }),
  [string]$ReportPath = "",
  [string]$Category = "skill-radar",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [int]$LookbackHours = 36
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
  $start = $Text.IndexOf("<!-- zh -->")
  if ($start -lt 0) { return $null }

  $report = $Text.Substring($start).Trim()
  $report = [regex]::Replace($report, "(?m)^::inbox-item\{.*\}\s*$", "").Trim()
  if ($report.Length -lt 300) { return $null }
  if ($report -notmatch "(?s)<!--\s*zh\s*-->.*<!--\s*/zh\s*-->") { return $null }
  if ($report -notmatch "(?s)<!--\s*en\s*-->.*<!--\s*/en\s*-->") { return $null }
  if ($report -notmatch "(?m)^#\s+Skill Radar Deep Dive\s+-\s+\d{4}-\d{2}-\d{2}\s*$") { return $null }
  $zh = Get-MarkedSection -Text $report -Name "zh"
  $en = Get-MarkedSection -Text $report -Name "en"
  if (-not $zh -or -not $en) { return $null }
  if ($zh.Length -lt 1200 -or $en.Length -lt 1200) { return $null }
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

function Get-ReportFromJsonlFile {
  param([System.IO.FileInfo]$File, [string]$AutomationId)
  $best = $null
  foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $File.FullName -ErrorAction SilentlyContinue) {
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
        if (-not $best -or $report.Length -gt $best.Length) {
          $best = $report
        }
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
  $json = $Payload | ConvertTo-Json -Depth 8
  $bodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  Invoke-RestMethod `
    -Uri $Endpoint `
    -Method Post `
    -Headers @{ "x-radar-ingest-key" = $Key } `
    -ContentType "application/json; charset=utf-8" `
    -Body $bodyBytes
}

$ingestKey = Read-DotEnvValue -Path $SecretsPath -Name "DEEP_REPORT_INGEST_KEY"
$state = Read-State -Path $StatePath
Write-Log "Forwarder started. AutomationId=$AutomationId Category=$Category Visibility=$Visibility LookbackHours=$LookbackHours"

if ($ReportPath) {
  if (-not (Test-Path -LiteralPath $ReportPath)) {
    throw "Report file not found: $ReportPath"
  }
  $report = [ordered]@{
    content = Get-Content -Raw -Encoding UTF8 -LiteralPath $ReportPath
    source = (Resolve-Path -LiteralPath $ReportPath).Path
    generatedAt = (Get-Item -LiteralPath $ReportPath).LastWriteTimeUtc.ToString("o")
  }
} else {
  try {
    $report = Find-LatestCodexReport -CodexHome $CodexHome -AutomationId $AutomationId -LookbackHours $LookbackHours
  } catch {
    if ($_.Exception.Message -like "No recent Codex report found*") {
      Write-Log $_.Exception.Message
      return
    }
    throw
  }
}

$localized = Split-ReportLanguages -Content $report.content
Assert-ReadableReport -Content ($localized.contentZh + "`n" + $localized.contentEn)
$hashSourceZh = if ($localized.contentZh) { $localized.contentZh } else { "" }
$hashSourceEn = if ($localized.contentEn) { $localized.contentEn } else { "" }
$hash = Get-ReportHash -Content ($hashSourceZh + "`n---EN---`n" + $hashSourceEn)
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
