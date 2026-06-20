# Personal Radar Cloud Prompt: Test Radar

Run a real Cloud end-to-end test for Personal Radar.

Do not search the web.
Do not modify repository files.
Do not print or reveal `CLOUD_REPORT_INGEST_KEY`.

Use `CLOUD_REPORT_INGEST_KEY` from the environment as the `x-radar-ingest-key` header.

POST this JSON to:

```text
https://personal-radar.jiojioyizeradar.workers.dev/ingest-report
```

Use a normal `User-Agent`, for example `personal-radar-cloud-real-test/1.0`.

```json
{
  "title": "Cloud Test Radar - YYYY-MM-DD",
  "contentZh": "# Cloud Test Radar - YYYY-MM-DD\n\n这是一条真实 Cloud 全链路测试消息。\n\n它用于验证 Codex Cloud 可以读取环境变量、访问 Worker、写入 KV、触发 PushPlus，并在公开网站的 cloud-test-radar 测试分类中展示。\n\n如果你在微信和网站上看到这条内容，说明 Cloud -> Worker -> KV -> Website -> PushPlus 链路已经跑通。",
  "contentEn": "# Cloud Test Radar - YYYY-MM-DD\n\nThis is a real Cloud end-to-end test message.\n\nIt verifies that Codex Cloud can read the environment variable, reach the Worker, write to KV, trigger PushPlus, and publish under the public cloud-test-radar test category.\n\nIf this appears in WeChat and on the website, the Cloud -> Worker -> KV -> Website -> PushPlus path is working.",
  "category": "cloud-test-radar",
  "visibility": "public",
  "pushLanguage": "zh",
  "generatedAt": "current ISO timestamp",
  "sourceRunId": "cloud-test-radar-YYYY-MM-DD-v1"
}
```

Replace `YYYY-MM-DD` with the current Beijing date.

Report only:

- env var exists
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

