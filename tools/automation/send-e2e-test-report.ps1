param(
  [string]$WorkerUrl = "https://radar.dailyingest.cn",
  [string]$SecretsPath = (Join-Path (Resolve-Path ".") ".secrets.local")
)

$ErrorActionPreference = "Stop"

function Read-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*#") { continue }
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.+?)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Get-IngestKey {
  if ($env:CLOUD_REPORT_INGEST_KEY) {
    return @{ source = "env:CLOUD_REPORT_INGEST_KEY"; value = $env:CLOUD_REPORT_INGEST_KEY }
  }
  if ($env:DEEP_REPORT_INGEST_KEY) {
    return @{ source = "env:DEEP_REPORT_INGEST_KEY"; value = $env:DEEP_REPORT_INGEST_KEY }
  }

  $cloudKey = Read-DotEnvValue -Path $SecretsPath -Name "CLOUD_REPORT_INGEST_KEY"
  if ($cloudKey) {
    return @{ source = ".secrets.local:CLOUD_REPORT_INGEST_KEY"; value = $cloudKey }
  }

  $deepKey = Read-DotEnvValue -Path $SecretsPath -Name "DEEP_REPORT_INGEST_KEY"
  if ($deepKey) {
    return @{ source = ".secrets.local:DEEP_REPORT_INGEST_KEY"; value = $deepKey }
  }

  return @{ source = "missing"; value = "" }
}

function ConvertTo-BeijingDate {
  $utcNow = (Get-Date).ToUniversalTime()
  return $utcNow.AddHours(8).ToString("yyyy-MM-dd")
}

function Get-GitStatusChanged {
  try {
    $status = & git status --short
    return -not [string]::IsNullOrWhiteSpace(($status -join "`n"))
  } catch {
    return $null
  }
}

$keyInfo = Get-IngestKey
$date = ConvertTo-BeijingDate
$endpoint = "$($WorkerUrl.TrimEnd('/'))/ingest-report"
$healthUrl = "$($WorkerUrl.TrimEnd('/'))/health"

$summary = [ordered]@{
  keySource = $keyInfo.source
  keyLength = $keyInfo.value.Length
  healthStatus = $null
  ingestStatus = $null
  responseIsJson = $false
  ok = $null
  stored = $null
  pushed = $null
  duplicate = $null
  reason = $null
  reportUrl = $null
  error = $null
  repositoryFilesChanged = Get-GitStatusChanged
}

if (-not $keyInfo.value) {
  $summary.error = "missing-ingest-key"
  $summary | ConvertTo-Json -Depth 8
  exit 1
}

try {
  $health = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -Headers @{
    "User-Agent" = "personal-radar-e2e-test/1.0"
  }
  $summary.healthStatus = [int]$health.StatusCode
} catch {
  $summary.error = "health failed: $($_.Exception.Message)"
  $summary.repositoryFilesChanged = Get-GitStatusChanged
  $summary | ConvertTo-Json -Depth 8
  exit 1
}

$payload = [ordered]@{
  title = "Cloud Test Radar - $date"
  contentZh = "# Cloud Test Radar - $date`n`n这是一条真实的端到端测试消息。`n`n它用于验证 Codex Automation 可以读取本地或远程 key、访问 Worker、写入 KV、触发 PushPlus，并在公开网站的 cloud-test-radar 测试分类中展示。`n`n如果你在微信和网站上看到这条内容，说明 Automation -> Worker -> KV -> Website -> PushPlus 链路已经跑通。"
  contentEn = "# Cloud Test Radar - $date`n`nThis is a real end-to-end test message.`n`nIt verifies that Codex Automation can read a local or remote key, reach the Worker, write to KV, trigger PushPlus, and publish under the public cloud-test-radar test category.`n`nIf this appears in WeChat and on the website, the Automation -> Worker -> KV -> Website -> PushPlus path is working."
  category = "cloud-test-radar"
  visibility = "public"
  pushLanguage = "zh"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceRunId = "cloud-test-radar-$date-v1"
}

try {
  $body = $payload | ConvertTo-Json -Depth 8
  $response = Invoke-RestMethod `
    -Uri $endpoint `
    -Method Post `
    -UseBasicParsing `
    -Headers @{
      "x-radar-ingest-key" = $keyInfo.value
      "User-Agent" = "personal-radar-e2e-test/1.0"
    } `
    -ContentType "application/json; charset=utf-8" `
    -Body $body

  $summary.ingestStatus = 200
  $summary.responseIsJson = $true
  $summary.ok = $response.ok
  $summary.stored = $response.stored
  $summary.pushed = $response.pushed
  $summary.duplicate = $response.duplicate
  $summary.reason = $response.reason
  if ($response.report -and $response.report.category -and $response.report.date) {
    $summary.reportUrl = "$($WorkerUrl.TrimEnd('/'))/reports/$($response.report.category)/$($response.report.date)"
  }
} catch {
  $summary.error = $_.Exception.Message
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $summary.ingestStatus = [int]$_.Exception.Response.StatusCode
  }
}

$summary.repositoryFilesChanged = Get-GitStatusChanged
$summary | ConvertTo-Json -Depth 8

if ($summary.error) {
  exit 1
}
