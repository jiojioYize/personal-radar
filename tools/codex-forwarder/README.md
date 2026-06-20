# Codex Forwarder

This is a fallback local bridge for Codex Automation reports.

The recommended production path is now `prompts/skill-radar-local.md`, where local Codex Automation reads `.secrets.local` and POSTs directly to the Worker. Use this forwarder only if Automation can generate a report but cannot POST to the public Worker endpoint because of sandbox networking.

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
