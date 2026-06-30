# Personal Radar

Personal Radar is a small system for publishing AI-assisted daily radar reports. It combines Codex Automation for research, a Cloudflare Worker for storage and publishing, and PushPlus for personal WeChat delivery.

## Live Site

Open the public radar site:

<https://radar.dailyingest.cn/>

The site publishes public AI-agent skill and rule radar reports. Pages default to Chinese and can switch to English when a bilingual report is available.

## Project Notes

- [MVP Stage 1 Record](docs/mvp-stage-1.md): current production flow, completed scope, operational checklist, and next-stage candidates.
- [Encoding Playbook](docs/encoding-playbook.md): UTF-8 and PowerShell lessons from the report delivery chain.

## 中文指南

### 这个项目做什么

Personal Radar 支持两条使用路径：

- **阅读公开日报**：直接打开 Live Site，查看已经发布的公开雷达报告。
- **部署自己的个人雷达**：用你自己的 Cloudflare Worker、PushPlus 和 Codex Automation，定时生成报告并推送到微信。

当前示例频道是 `skill-radar`，专门发现和筛选 AI-agent skills、Cursor/Cline/Roo rules、Claude/Claude Code skills、Codex skills，以及其他可迁移复用的 agent rule packs。

### 当前推荐架构

当前推荐主线是本地 Codex Automation 加本地 forwarder：

```text
Local Codex Automation -> reports/outbox -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

原因是 Codex Automation 目前更适合在本地/工作树环境里创建和调度，但自动化 shell 的网络出站可能失败。让 Codex Automation 只生成报告文件，再由普通 Windows PowerShell 运行 forwarder 负责联网推送，是当前最稳的生产路径。

### 仓库里的 prompt

- `prompts/skill-radar-local.md`：正式本地自动化 prompt。

正式每日任务建议读取：

```text
请读取并执行仓库中的 prompts/skill-radar-local.md。
```

这个 prompt 会把正式报告写到：

```text
reports/outbox/skill-radar-YYYY-MM-DD.md
```

### 本地密钥

在项目根目录创建 `.secrets.local`：

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

不要提交这个文件。

本地 Codex Automation 不需要读取这个 key。forwarder 会从 `.secrets.local` 读取 `DEEP_REPORT_INGEST_KEY` 并转发报告，不能打印 key。

### Worker secrets

部署到 Cloudflare Worker 前需要设置 secrets：

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

可选：

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

### 安装和本地运行

```powershell
npm install
npm run dev
```

打开：

```text
http://localhost:8787/health
```

生产发布入口是 `/ingest-report`。Worker 不负责搜索或生成报告。

### 部署 Worker

```powershell
npm run deploy
```

Cloudflare Cron 默认关闭。推荐让 Codex Automation 负责智能搜索和写报告，让 Worker 负责接收、存储、展示和推送。

### 手动发布一篇报告

Worker 接收双语 Markdown。中文默认用于 PushPlus，网页可在中文和英文之间切换。

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive - 2026-06-20"
    contentZh = "# Skill Radar Deep Dive - 2026-06-20`n`n中文报告正文"
    contentEn = "# Skill Radar Deep Dive - 2026-06-20`n`nEnglish report body"
    pushLanguage = "zh"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-20T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

常用字段：

- `contentZh`：中文 Markdown，默认用于 PushPlus。
- `contentEn`：英文 Markdown，用于网页 English 视图。
- `pushLanguage`：`zh` 或 `en`，默认 `zh`。
- `visibility`：`public` 会展示在网站上；`private` 不会公开展示。
- `sourceRunId`：用于防止重复推送。

### Codex forwarder

`tools/codex-forwarder/` 是当前生产桥接方案。它会读取 `reports/outbox/` 中最新的完整报告并 POST 到 Worker。

本地 Codex Automation 负责执行 `prompts/skill-radar-local.md` 并输出完整报告。forwarder 负责在稍后读取报告并推送。

运行：

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

详见 [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md)。

### 数据和隐私

不要提交：

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`
- `reports/outbox/*.md`
- 生成的私人报告
- PushPlus、Worker、Codex 或其他 token

GitHub 仓库应该只包含代码、文档和示例配置。

## English Guide

### What This Project Does

Personal Radar supports two use cases:

- **Read the public daily radar**: open the Live Site and browse published reports.
- **Run your own personal radar**: deploy your own Worker, connect PushPlus, and use Codex Automation to generate and deliver reports.

The current example channel is `skill-radar`, which discovers practical AI-agent skills, Cursor/Cline/Roo rules, Claude/Claude Code skills, Codex skills, and portable agent rule packs.

### Recommended Architecture

The current recommended path uses local Codex Automation plus the local forwarder:

```text
Local Codex Automation -> reports/outbox -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

Local Codex Automation is suitable for scheduled research and report generation, but its shell network access may fail. It writes a report file under `reports/outbox/`; the forwarder runs from normal Windows PowerShell and handles network delivery to the Worker.

### Prompt Files

- `prompts/skill-radar-local.md`: production prompt for local automation.

For the formal daily automation, use:

```text
Please read and execute prompts/skill-radar-local.md.
```

That prompt writes the final report to:

```text
reports/outbox/skill-radar-YYYY-MM-DD.md
```

### Local Secret

Create `.secrets.local` in the repository root:

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

Do not commit this file.

The local Codex Automation prompt does not need this key. The forwarder reads `DEEP_REPORT_INGEST_KEY` from `.secrets.local` and must never print it.

### Worker Secrets

Required:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Optional:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

### Install and Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:8787/health
```

Production publishing uses `/ingest-report`. The Worker does not search for or generate reports.

### Deploy

```powershell
npm run deploy
```

Cloudflare Cron is disabled by default. Codex Automation handles intelligent search and report writing; the Worker handles ingest, storage, rendering, and push delivery.

### Publish a Report Manually

The Worker accepts bilingual Markdown. Chinese content is used for PushPlus by default, and the website can switch between Chinese and English.

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive - 2026-06-20"
    contentZh = "# Skill Radar Deep Dive - 2026-06-20`n`n中文报告正文"
    contentEn = "# Skill Radar Deep Dive - 2026-06-20`n`nEnglish report body"
    pushLanguage = "zh"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-20T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

Useful fields:

- `contentZh`: Chinese Markdown, used for PushPlus by default.
- `contentEn`: English Markdown, used by the website English view.
- `pushLanguage`: `zh` or `en`; defaults to `zh`.
- `visibility`: `public` appears on the website; `private` does not.
- `sourceRunId`: prevents duplicate delivery.

### Codex Forwarder

`tools/codex-forwarder/` is the production local bridge. It reads the latest complete report from `reports/outbox/` and POSTs it to the Worker.

Run it after the Codex Automation schedule. The local state file prevents duplicate forwarding.

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

See [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md).

### Data and Privacy

Do not commit:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`
- `reports/outbox/*.md`
- generated private reports
- PushPlus, Worker, Codex, or other tokens

This repository should contain only code, docs, and example configuration.
