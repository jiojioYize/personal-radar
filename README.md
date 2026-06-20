# Personal Radar

Personal Radar is a small system for publishing AI-assisted daily radar reports. It combines Codex Automation for research, a Cloudflare Worker for storage and publishing, and PushPlus for personal WeChat delivery.

## Live Site

Open the public radar site:

<https://radar.dailyingest.cn/>

The site publishes daily radar reports generated from the current public channels.

## 中文使用指南

### 这个项目能做什么

Personal Radar 可以帮你做两件事：

- **看公开日报**：直接打开上面的 Live Site，查看已经发布的公开报告。
- **搭建自己的个人雷达**：用你自己的 Cloudflare Worker、PushPlus 和 Codex Automation，定时生成报告并推送到微信。

当前示例频道是 `skill-radar`，专门发现和筛选 AI-agent skills、Cursor/Cline/Roo rules、Claude/Claude Code skills、Codex skills，以及其他可以迁移复用的 agent rule packs。

### 如果你只是想看报告

直接访问：

```text
https://radar.dailyingest.cn
```

网页默认显示中文。如果报告包含英文版本，可以在页面上切换到 English。

### 如果你想部署自己的版本

1. Fork 或 clone 这个仓库。
2. 创建 Cloudflare KV namespace，并把 id 写入 `wrangler.toml`。
3. 设置 Worker secrets。
4. 部署 Worker。
5. 配置 Codex Automation 生成报告。
6. 配置本地 forwarder，把 Codex 报告转发到 Worker。
7. 配置 Windows Task Scheduler，让 forwarder 定时运行。

最小生产链路是：

```text
Codex Automation -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

### 安装依赖

```powershell
npm install
```

本地运行：

```powershell
npm run dev
```

打开：

```text
http://localhost:8787/run
```

`/run` 只用于手动 dry-run/debug，不是生产推送入口。

### 部署 Worker

```powershell
npm run deploy
```

Cloudflare Cron 默认关闭。推荐让 Codex Automation 负责智能搜索和写报告，让 Worker 只负责接收、存储、展示和推送。

### 配置 Worker secrets

PushPlus token：

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

可选 PushPlus channel：

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

报告 ingest key：

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

可选测试 key：

```powershell
npx wrangler secret put RADAR_TEST_KEY
```

### 推送一篇报告

Worker 接收双语 Markdown。中文用于微信推送，网页可以在中文和英文之间切换。

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
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

常用字段：

- `contentZh`: 中文 Markdown，默认用于 PushPlus。
- `contentEn`: 英文 Markdown，用于网页 English 视图。
- `pushLanguage`: `zh` 或 `en`，默认 `zh`。
- `visibility`: `public` 会展示在网站上，`private` 不会公开展示。
- `sourceRunId`: 用于防重复推送。

### 配置 Codex forwarder

forwarder 会从本地 Codex session 里找最新报告，并 POST 到 Worker。

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

报告里如果包含下面的标记，forwarder 会自动拆成中英双语：

```markdown
<!-- zh -->
# 中文报告
<!-- /zh -->

<!-- en -->
# English report
<!-- /en -->
```

本地需要有 `.secrets.local`：

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

Windows Task Scheduler 设置见 [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md)。

### 数据和隐私

不要提交这些文件或内容：

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- 生成的私人报告
- PushPlus、Telegram、Worker 或 Codex tokens

GitHub 仓库应该只包含代码、文档和示例配置。

## English Guide

### What This Project Does

Personal Radar supports two use cases:

- **Read the public daily radar**: open the Live Site and browse published reports.
- **Run your own personal radar**: deploy your own Worker, connect PushPlus, and use Codex Automation to generate and deliver reports.

The current example channel is `skill-radar`, which discovers practical AI-agent skills, Cursor/Cline/Roo rules, Claude/Claude Code skills, Codex skills, and portable agent rule packs.

### Read the Public Site

Open:

```text
https://radar.dailyingest.cn
```

Pages default to Chinese. If an English version is available, use the page language switch.

### Deploy Your Own

1. Fork or clone this repository.
2. Create a Cloudflare KV namespace and update `wrangler.toml`.
3. Set Worker secrets.
4. Deploy the Worker.
5. Configure Codex Automation to generate reports.
6. Configure the local forwarder to send Codex reports to the Worker.
7. Configure Windows Task Scheduler to run the forwarder automatically.

Production flow:

```text
Codex Automation -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

### Install

```powershell
npm install
```

Run locally:

```powershell
npm run dev
```

Open:

```text
http://localhost:8787/run
```

`/run` is only a manual dry-run/debug endpoint. Production publishing uses `/ingest-report`.

### Deploy

```powershell
npm run deploy
```

Cloudflare Cron is disabled by default. Codex Automation handles intelligent search and report writing; the Worker handles ingest, storage, rendering, and push delivery.

### Worker Secrets

PushPlus token:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

Optional PushPlus channel:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

Report ingest key:

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Codex Cloud low-privilege ingest key:

```powershell
npx wrangler secret put CLOUD_REPORT_INGEST_KEY
```

When this key is used, the Worker forces `category=skill-radar`, `visibility=public`, and `pushLanguage=zh`.

Optional test key:

```powershell
npx wrangler secret put RADAR_TEST_KEY
```

### Publish a Report

The Worker accepts bilingual Markdown. Chinese content is used for PushPlus by default, and the website can switch between Chinese and English.

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
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

Useful fields:

- `contentZh`: Chinese Markdown, used for PushPlus by default.
- `contentEn`: English Markdown, used by the website English view.
- `pushLanguage`: `zh` or `en`; defaults to `zh`.
- `visibility`: `public` appears on the website; `private` does not.
- `sourceRunId`: prevents duplicate delivery.

### Configure the Codex Forwarder

The forwarder reads the latest Codex report from local sessions and POSTs it to the Worker.

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

If the report contains these markers, the forwarder sends both language versions:

```markdown
<!-- zh -->
# 中文报告
<!-- /zh -->

<!-- en -->
# English report
<!-- /en -->
```

Create `.secrets.local`:

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

See [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md) for Windows Task Scheduler setup.

### Data and Privacy

Do not commit:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- generated private reports
- PushPlus, Telegram, Worker, or Codex tokens

This repository should contain only code, docs, and example configuration.
