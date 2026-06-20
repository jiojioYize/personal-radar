# Personal Radar

Personal Radar is a small system for publishing AI-assisted daily radar reports. It combines Codex Automation for research, a Cloudflare Worker for storage and publishing, and PushPlus for personal WeChat delivery.

## Live Site

Open the public radar site:

<https://radar.dailyingest.cn/>

The site publishes public AI-agent skill and rule radar reports. Pages default to Chinese and can switch to English when a bilingual report is available.

## 中文指南

### 这个项目做什么

Personal Radar 支持两条使用路径：

- **阅读公开日报**：直接打开 Live Site，查看已经发布的公开雷达报告。
- **部署自己的个人雷达**：用你自己的 Cloudflare Worker、PushPlus 和 Codex Automation，定时生成报告并推送到微信。

当前示例频道是 `skill-radar`，专门发现和筛选 AI-agent skills、Cursor/Cline/Roo rules、Claude/Claude Code skills、Codex skills，以及其他可迁移复用的 agent rule packs。

### 当前推荐架构

当前推荐主线是本地 Codex Automation：

```text
Local Codex Automation -> Worker /ingest-report -> KV + public site + PushPlus
```

原因是 Codex Automation 目前更适合在本地/工作树环境里创建和调度。Cloud 执行链路已经验证可用，但 Cloud Automation 创建/调度目前不是稳定主路径。

Cloud 相关 prompt 和低权限 key 仍然保留，作为未来备用路径和手动测试路径。

### 仓库里的 prompt

- `prompts/skill-radar-local.md`：当前推荐的正式本地自动化 prompt。
- `prompts/skill-radar-cloud.md`：Cloud/远程环境备用 prompt。
- `prompts/cloud-test-radar.md`：端到端测试 prompt，会写入 `cloud-test-radar` 测试频道。

正式每日任务建议读取：

```text
请读取并执行仓库中的 prompts/skill-radar-local.md。
```

测试任务可以读取：

```text
请读取并执行仓库中的 prompts/cloud-test-radar.md。
```

### 本地密钥

在项目根目录创建 `.secrets.local`：

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

不要提交这个文件。

本地自动化会优先从环境变量读取 `DEEP_REPORT_INGEST_KEY`，如果没有，再从 `.secrets.local` 读取。任务回复只能报告 key 是否存在和 key 长度，不能打印 key。

### Worker secrets

部署到 Cloudflare Worker 前需要设置 secrets：

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

可选：

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
npx wrangler secret put RADAR_TEST_KEY
npx wrangler secret put CLOUD_REPORT_INGEST_KEY
```

`CLOUD_REPORT_INGEST_KEY` 是低权限 Cloud/测试 key。当前不是主线必需；保留它是为了未来远程自动化或受限环境测试。

### 安装和本地运行

```powershell
npm install
npm run dev
```

打开：

```text
http://localhost:8787/run
```

`/run` 只用于手动 dry-run/debug；生产发布入口是 `/ingest-report`。

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

`tools/codex-forwarder/` 是本地桥接备用方案。它会扫描本地 Codex session，提取最新报告并 POST 到 Worker。

推荐先尝试本地 Codex Automation 直接执行 `prompts/skill-radar-local.md`。如果自动化任务能生成报告但沙盒网络无法 POST，再启用 forwarder 作为补救。

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

The current recommended path uses local Codex Automation:

```text
Local Codex Automation -> Worker /ingest-report -> KV + public site + PushPlus
```

Cloud execution has been verified manually, but Cloud Automation creation and scheduling are not the stable primary path for this project yet. Cloud prompts and the low-privilege key remain available as a future or test path.

### Prompt Files

- `prompts/skill-radar-local.md`: recommended production prompt for local automation.
- `prompts/skill-radar-cloud.md`: backup prompt for Cloud or remote environments.
- `prompts/cloud-test-radar.md`: end-to-end test prompt that publishes under the `cloud-test-radar` test category.

For the formal daily automation, use:

```text
Please read and execute prompts/skill-radar-local.md.
```

For an end-to-end test, use:

```text
Please read and execute prompts/cloud-test-radar.md.
```

### Local Secret

Create `.secrets.local` in the repository root:

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

Do not commit this file.

The local automation prompt first checks `DEEP_REPORT_INGEST_KEY` from the environment. If it is missing, it reads `.secrets.local`. It must never print the key.

### Worker Secrets

Required:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Optional:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
npx wrangler secret put RADAR_TEST_KEY
npx wrangler secret put CLOUD_REPORT_INGEST_KEY
```

`CLOUD_REPORT_INGEST_KEY` is a low-privilege key for Cloud or restricted-environment tests. It is not required for the current local automation path.

### Install and Run Locally

```powershell
npm install
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

`tools/codex-forwarder/` is a fallback local bridge. It scans local Codex sessions, extracts the latest report, and POSTs it to the Worker.

Try the local automation prompt first. Use the forwarder only if the automation can generate a report but cannot POST to the Worker because of sandbox networking.

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
- generated private reports
- PushPlus, Worker, Codex, or other tokens

This repository should contain only code, docs, and example configuration.
