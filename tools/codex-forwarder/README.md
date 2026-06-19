# Codex Forwarder

This is a local bridge for Codex Automation reports. It exists because Codex Automation can generate high-quality radar reports, but its sandboxed shell may not be able to POST to the public Worker endpoint.

The script scans recent local Codex session JSONL files, extracts the latest radar-like Markdown report, and POSTs it to the Worker `/ingest-report` endpoint. It keeps local sent state so the same report is not forwarded twice.

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

## Required secret

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
