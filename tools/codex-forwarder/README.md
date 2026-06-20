# Codex Forwarder

This is the production local bridge for Codex Automation reports.

The recommended production path is `prompts/skill-radar-local.md`, where local Codex Automation generates the bilingual report but does not POST to the Worker. This forwarder reads the completed report from local Codex session output and POSTs it to the public Worker endpoint from a normal Windows PowerShell process.

The script scans recent local Codex session JSONL files, extracts the latest radar-like Markdown report, and POSTs it to the Worker `/ingest-report` endpoint. It keeps local sent state so the same report is not forwarded twice.

When the Codex report includes these markers, the forwarder sends both language versions:

```markdown
<!-- zh -->
# 中文报告
<!-- /zh -->

<!-- en -->
# English report
<!-- /en -->
```

Push delivery defaults to Chinese (`pushLanguage = "zh"`). The public website can switch between Chinese and English when both sections are present.

## Usage

Run from the repository root:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

Useful options:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1 `
  -AutomationId "skill-radar" `
  -Visibility public `
  -Category skill-radar
```

To forward a specific Markdown file instead of scanning Codex sessions:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1 -ReportPath "C:\path\to\report.md"
```

## Required Secret

Create `.secrets.local` in the repository root:

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

Do not commit this file.

## Windows Task Scheduler

Create a daily task after the Codex automation schedule, for example 08:20 Beijing time.

Program:

```text
powershell.exe
```

Arguments:

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\Users\Zander Sun\personal-radar\tools\codex-forwarder\forward-codex-report.ps1"
```

Start in:

```text
C:\Users\Zander Sun\personal-radar
```

For more resilience, run it every 10 minutes during the morning window. The local state file prevents duplicate forwarding.

## Logs

Task Scheduler runs in the background, so you may not see a console window. The forwarder writes a local log file:

```text
.codex-forwarder.log
```

This file is ignored by Git.
