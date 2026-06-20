# Personal Radar Test Prompt: End-to-End Radar

Run a real end-to-end test for Personal Radar.

Do not search the web.
Do not modify repository files.
Do not print or reveal any ingest key.

## Secret Lookup

Use the first available key in this order:

1. `CLOUD_REPORT_INGEST_KEY` from the environment.
2. `DEEP_REPORT_INGEST_KEY` from the environment.
3. `CLOUD_REPORT_INGEST_KEY` parsed from the repository root `.secrets.local`.
4. `DEEP_REPORT_INGEST_KEY` parsed from the repository root `.secrets.local`.

Only report whether a key was found and its length. Never print the key value.

## Request

Preferred execution path: run the repository script from the project root:

```powershell
.\tools\automation\send-e2e-test-report.ps1
```

If the script cannot be run, POST this JSON manually to:

```text
https://radar.dailyingest.cn/ingest-report
```

Use a normal `User-Agent`, for example `personal-radar-e2e-test/1.0`.

```json
{
  "title": "Cloud Test Radar - YYYY-MM-DD",
  "contentZh": "# Cloud Test Radar - YYYY-MM-DD\n\n这是一条真实的端到端测试消息。\n\n它用于验证 Codex Automation 可以读取本地或远程 key、访问 Worker、写入 KV、触发 PushPlus，并在公开网站的 cloud-test-radar 测试分类中展示。\n\n如果你在微信和网站上看到这条内容，说明 Automation -> Worker -> KV -> Website -> PushPlus 链路已经跑通。",
  "contentEn": "# Cloud Test Radar - YYYY-MM-DD\n\nThis is a real end-to-end test message.\n\nIt verifies that Codex Automation can read a local or remote key, reach the Worker, write to KV, trigger PushPlus, and publish under the public cloud-test-radar test category.\n\nIf this appears in WeChat and on the website, the Automation -> Worker -> KV -> Website -> PushPlus path is working.",
  "category": "cloud-test-radar",
  "visibility": "public",
  "pushLanguage": "zh",
  "generatedAt": "current ISO timestamp",
  "sourceRunId": "cloud-test-radar-YYYY-MM-DD-v1"
}
```

Replace `YYYY-MM-DD` with the current Beijing date.

If the Worker returns `duplicate=true`, do not retry with a different date.

Report only:

- key source: `env`, `.secrets.local`, or `missing`
- key length
- HTTP status
- response is JSON
- ok
- stored
- pushed
- duplicate
- reason, if any
- report URL
- whether repository files changed
