# Codex Forwarder

This is the production local bridge for Codex Automation reports.

The recommended production path is `prompts/skill-radar-local.md`, where local Codex Automation generates the bilingual report but does not POST to the Worker. The automation writes a report file under `reports/outbox/`, and this forwarder POSTs that file to the public Worker endpoint from a normal Windows PowerShell process.

The script scans `reports/outbox/*.md` for the latest valid report. It keeps local sent state so the same report is not forwarded twice.

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

To forward a specific Markdown file instead of scanning the outbox:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1 -ReportPath "C:\path\to\report.md"
```

To override the outbox directory:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1 -OutboxDir "C:\path\to\outbox"
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

## Encoding Safety

Codex report files are UTF-8. The forwarder reads report files with explicit `-Encoding UTF8`, sends JSON as UTF-8 bytes, and refuses to send reports that look mojibaked.

See [`../../docs/encoding-playbook.md`](../../docs/encoding-playbook.md).
