# Personal Radar

## Live Site

- Public radar: <https://personal-radar.jiojioyizeradar.workers.dev>

## 中文说明

Personal Radar 是一个个人信息雷达工具，用来定时发现、整理、发布和推送高价值信息。当前主频道是 `skill-radar`，聚焦真正可复用的 AI-agent skills 和规则包，例如 Codex skills、Claude/Claude Code skills、Cursor rules、Cline/Roo rules，以及可以直接迁移的 agent rule packs。

这个项目把智能推荐、稳定投递和公开展示拆成几层：

- Codex Automation 负责高质量搜索、筛选和撰写报告。
- Cloudflare Worker 负责接收报告、写入 KV、渲染公开网站，并推送消息。
- 本地 Codex forwarder 负责把 Codex 自动化产出的报告转发到 Worker，绕过自动化 shell 网络受限的问题。
- GitHub 仓库只放代码、文档和示例配置，不存放私人报告、密钥或个人偏好。

### 公开日报

Worker 会展示公开报告：

- `GET /`: 最新公开报告。
- `GET /reports`: 历史报告列表。
- `GET /reports/:category/:date`: 单篇历史报告。

只有 `visibility: "public"` 的报告会展示在网站上。`private` 报告可以被推送和存储，但不会出现在公开页面。

公开页面默认显示中文；如果报告包含英文版本，可以通过 `?lang=en` 切换。

### 个人推送

自部署时的生产链路是：

```text
Codex Automation -> local forwarder -> Worker /ingest-report -> KV + website + PushPlus
```

PushPlus 默认推送中文内容。如果 ingest payload 里提供了 `contentZh`，微信推送会优先使用中文；网页则可以在中文和英文之间切换。

### 本地开发

```powershell
npm install
npm run dev
```

然后打开：

```text
http://localhost:8787/run
```

### 部署

```powershell
npm run deploy
```

Cloudflare Cron 已在 `wrangler.toml` 中关闭。Worker 自带的 `/run` 只保留为手动 dry-run/debug 入口；生产报告通过 `/ingest-report` 写入。

### Worker Secrets

设置 PushPlus token：

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

可选 PushPlus channel：

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

设置 ingest key：

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

可选测试 key：

```powershell
npx wrangler secret put RADAR_TEST_KEY
```

### Deep Report Ingest

发送双语报告到 Worker：

```powershell
Invoke-RestMethod `
  -Uri "https://personal-radar.jiojioyizeradar.workers.dev/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive"
    contentZh = "# 中文报告正文"
    contentEn = "# English report body"
    pushLanguage = "zh"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-19T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

字段说明：

- `title`: 报告标题。
- `contentZh`: 中文 Markdown 正文，默认用于 PushPlus 推送。
- `contentEn`: 英文 Markdown 正文，用于网页英文视图。
- `content`: 兼容旧版的单语言 Markdown 正文。
- `pushLanguage`: `zh` 或 `en`，默认 `zh`。
- `category`: 报告命名空间，默认 `skill-radar`。
- `visibility`: `public` 或 `private`，默认 `private`。
- `generatedAt`: ISO 时间戳，默认 ingest 时间。
- `sourceRunId`: 生产者运行 ID，用于防重复。

时间和去重：

- `RADAR_TIME_ZONE` 在 `wrangler.toml` 中设置为 `Asia/Shanghai`。
- 历史归档日期和公开 URL 使用配置的业务时区，不直接使用 UTC 日期。
- 同一个 `sourceRunId` 只接受一次。
- 同一个 `category + date` 只接受一次。

KV key：

- `report:<category>:<YYYY-MM-DD>`
- `latest:<category>:public`
- `latest:<category>:private`
- `reports:index:<category>`
- `source-run:<sourceRunId>`

### Codex Local Forwarder

从仓库根目录运行：

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

forwarder 会：

- 从 `.secrets.local` 读取 `DEEP_REPORT_INGEST_KEY`。
- 扫描本地 Codex session JSONL，寻找最新 `skill-radar` 报告。
- 识别 `<!-- zh -->...<!-- /zh -->` 和 `<!-- en -->...<!-- /en -->` 双语区块。
- POST 到 Worker `/ingest-report`。
- 写入 `.codex-forwarder-state.json`，避免重复转发。

Windows Task Scheduler 设置见 [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md)。

### 仓库卫生

不要提交：

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- 生成的私人报告
- PushPlus、Telegram、Worker 或 Codex tokens

使用 `.secrets.local.example` 作为本地密钥模板。

## English

Personal Radar is a lightweight personal information radar for scheduled discovery, publication, and push delivery. The current primary channel is `skill-radar`, focused on practical AI-agent skills and portable rule packs such as Codex skills, Claude/Claude Code skills, Cursor rules, Cline/Roo rules, and reusable agent rule packs.

The project separates intelligence, delivery, and publishing:

- Codex Automation performs high-quality research, filtering, and report writing.
- Cloudflare Worker receives reports, stores them in KV, renders the public site, and sends push messages.
- The local Codex forwarder bridges Codex Automation output into the Worker when the automation shell cannot reach remote endpoints.
- GitHub stores code, docs, and example configuration only; it does not store private reports, secrets, or personal preferences.

### Public Daily Radar

The Worker serves public reports:

- `GET /`: latest public report.
- `GET /reports`: public report archive.
- `GET /reports/:category/:date`: one stored report.

Only reports ingested with `visibility: "public"` are shown on the website. Private reports can still be stored and pushed, but are not rendered publicly.

Public pages default to Chinese. When an English version is available, use `?lang=en` to switch.

### Personal Push

The production pipeline is:

```text
Codex Automation -> local forwarder -> Worker /ingest-report -> KV + website + PushPlus
```

PushPlus uses Chinese content by default. When `contentZh` is present, it is used for WeChat push delivery; the website can switch between Chinese and English.

### Local Development

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:8787/run
```

### Deployment

```powershell
npm run deploy
```

Cloudflare Cron is intentionally disabled in `wrangler.toml`. Worker-native `/run` remains only as a manual dry-run/debug endpoint; production reports are published through `/ingest-report`.

### Worker Secrets

Set the PushPlus token:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

Optional PushPlus channel:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

Set the ingest key:

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Optional test key:

```powershell
npx wrangler secret put RADAR_TEST_KEY
```

### Deep Report Ingest

Send a bilingual report:

```powershell
Invoke-RestMethod `
  -Uri "https://personal-radar.jiojioyizeradar.workers.dev/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive"
    contentZh = "# 中文报告正文"
    contentEn = "# English report body"
    pushLanguage = "zh"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-19T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

Payload fields:

- `title`: report title.
- `contentZh`: Chinese Markdown body, used for PushPlus by default.
- `contentEn`: English Markdown body, used by the website English view.
- `content`: legacy single-language Markdown fallback.
- `pushLanguage`: `zh` or `en`; defaults to `zh`.
- `category`: report namespace; defaults to `skill-radar`.
- `visibility`: `public` or `private`; defaults to `private`.
- `generatedAt`: ISO timestamp; defaults to ingest time.
- `sourceRunId`: producer run ID for deduplication.

Time and deduplication:

- `RADAR_TIME_ZONE` is set to `Asia/Shanghai` in `wrangler.toml`.
- Archive dates and public URLs use the configured business time zone rather than raw UTC dates.
- The same `sourceRunId` is accepted once.
- The same `category + date` is accepted once.

KV keys:

- `report:<category>:<YYYY-MM-DD>`
- `latest:<category>:public`
- `latest:<category>:private`
- `reports:index:<category>`
- `source-run:<sourceRunId>`

### Codex Local Forwarder

Run from the repository root:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

The forwarder:

- reads `DEEP_REPORT_INGEST_KEY` from `.secrets.local`;
- scans local Codex session JSONL files for the latest `skill-radar` report;
- extracts `<!-- zh -->...<!-- /zh -->` and `<!-- en -->...<!-- /en -->` sections when present;
- POSTs the report to `/ingest-report`;
- writes `.codex-forwarder-state.json` to avoid duplicate forwarding.

See [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md) for Windows Task Scheduler setup.

### Repository Hygiene

Do not commit:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- generated private reports
- PushPlus, Telegram, Worker, or Codex tokens

Use `.secrets.local.example` as the local secrets template.

## Future Extension Points

- Replace the local forwarder with Codex Cloud or another remote Codex runtime if it can reliably POST to the Worker.
- Add D1 when multi-user preferences, feedback, and search need relational queries.
- Add R2 when long-term Markdown/HTML archives outgrow KV.
- Add protected history endpoints so Codex deep dives can avoid repeating recently recommended items.
- Add preference memory so useful/not useful feedback adjusts future ranking.
