# Encoding Playbook

This project moves report text through several boundaries:

```text
Codex session JSONL -> PowerShell forwarder -> JSON HTTP request -> Worker KV -> website + PushPlus
```

Any boundary can corrupt Chinese text if UTF-8 is not explicit.

## Symptoms

Typical mojibake looks like:

```text
涓 鎶 鍛 鐨 绛 杩 鏄 浠 鍙 寮
```

If these strings appear in a Chinese report, the content was probably read as a legacy Windows code page instead of UTF-8.

## Root Cause Found

Codex session files are UTF-8 JSONL. Windows PowerShell 5.1 `Get-Content` can default to the system ANSI code page when `-Encoding` is omitted.

That means this is unsafe for Codex session files:

```powershell
Get-Content -LiteralPath $path
```

Use this instead:

```powershell
Get-Content -Encoding UTF8 -LiteralPath $path
```

For raw text:

```powershell
Get-Content -Raw -Encoding UTF8 -LiteralPath $path
```

## HTTP Rule

When sending JSON with Chinese content from PowerShell, send explicit UTF-8 bytes and include `charset=utf-8`:

```powershell
$json = $payload | ConvertTo-Json -Depth 8
$bodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)

Invoke-RestMethod `
  -Uri $endpoint `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $bodyBytes
```

## Guardrail

The forwarder should refuse to send a report if it sees repeated mojibake markers before ingest. A failed forward is easier to fix than a corrupted public report plus a corrupted PushPlus message.

## Debug Checklist

1. Check the source Codex session with explicit UTF-8.
2. Check the forwarder log.
3. Check `.codex-forwarder-state.json` for Worker response fields.
4. If Worker says `stored=true pushed=true` but content is corrupted, inspect the client-side read/send encoding before changing Worker rendering.
5. If the source session is already corrupted, fix the automation prompt/output path instead.
