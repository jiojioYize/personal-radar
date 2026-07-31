# Personal Radar

**[中文版](README.zh.md)** | [English](README.md)

Personal Radar 是一款用于缓解 AI 时代信息焦虑的个人信息雷达。它会按日发现、核验、解释、发布并推送经过筛选的信息。首个频道 `skill-radar` 聚焦可复用的 AI-agent skills、rules、modes 和 instruction packs。

## 在线网站

<https://radar.dailyingest.cn/>

公开网站提供最新报告、历史归档，以及双语报告的中文 / English 切换。

## 这个项目做什么

Personal Radar 当前支持两条使用路径：

- **阅读公开雷达**：无需部署，直接查看已经发布的 `skill-radar` 报告。
- **运行自己的雷达**：配置 Codex Automation、Cloudflare Worker、PushPlus 和本地 forwarder，生成并推送自己的报告。

当前生产系统仍是单用户、单频道、本地优先，是已经可以日常运行的 MVP，而不是成熟的多用户托管服务。

## 推荐架构

```text
代码生成来源计划 -> Local Codex Automation
-> 来源核验与质量判断
-> reports/outbox -> local forwarder
-> Worker /ingest-report -> KV + 公开网站 + PushPlus
```

Codex Automation 负责研究和生成报告。由于它的 shell 网络访问可能失败，Automation 只写入经过校验的本地产物，不直接发布。普通 Windows PowerShell 定时任务稍后运行 forwarder，负责联网投递。Worker 负责存储报告、渲染网站和发送 PushPlus 消息。

## 正式生产 Prompt

正式每日自动化读取：

```text
prompts/skill-radar-local.md
```

推荐的 Codex Automation 指令：

```text
请读取并执行仓库中的 prompts/skill-radar-local.md。
```

Prompt 会按照代码生成的计划轮换 skill 注册表、官方目录和有限的社区来源。代码负责具体 artifact、历史和 review-state 约束；隔离上下文的核验角色检查所有合格候选的一手来源，主模型再基于有效证据做定性推荐判断。

成功运行后写入：

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

质量 Sidecar 是唯一事实源，Markdown 由它确定性生成。

标准生产流程不依赖可选的 GitHub collector。collector 只保留用于有边界的证据实验：

```powershell
npm run discovery:github
```

隔离数据和调度规则见 [tools/discovery/README.md](tools/discovery/README.md)。

## 本地密钥

在项目根目录创建 `.secrets.local`：

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

不要提交这个文件。Codex Automation 不需要读取该密钥；本地 forwarder 会读取它，但不能打印它。

## Worker Secrets

设置必需的 Cloudflare Worker secrets：

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

可选：

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

## 安装和本地运行

```powershell
npm install
npm run dev
```

打开健康检查：

```text
http://localhost:8787/health
```

生产发布入口是 `/ingest-report`。Worker 不负责搜索或生成报告。

运行测试：

```powershell
npm test
```

## 部署 Worker

```powershell
npm run deploy
```

Cloudflare Cron 默认关闭。生产环境使用 `PUSHPLUS_TEMPLATE=html`，`markdown` 仅作为兼容选项。

## 运行 Forwarder

生产 forwarder 要求同一天的 Markdown 和 `.quality.json` 成对存在。它会验证日期、项目顺序和来源，然后将两份内容 POST 到 Worker。

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

应在 Codex Automation 计划时间之后运行。它通过本地状态避免重复投递。Windows Task Scheduler 配置和故障排查见 [tools/codex-forwarder/README.md](tools/codex-forwarder/README.md)。

## 手动发布报告

`/ingest-report` 也接受双语 Markdown，供手动发布或兼容客户端使用：

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive - 2026-06-20"
    contentZh = "# Skill Radar Deep Dive - 2026-06-20`n`n中文报告正文"
    contentEn = "# Skill Radar Deep Dive - 2026-06-20`n`nEnglish report content"
    pushLanguage = "zh"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-20T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

常用字段：

- `contentZh`：中文 Markdown，默认用于 PushPlus。
- `contentEn`：英文 Markdown，用于网站 English 视图。
- `pushLanguage`：`zh` 或 `en`，默认 `zh`。
- `visibility`：`public` 会展示在网站；`private` 不公开。
- `sourceRunId`：防止重复投递。

## 数据和隐私

不要提交：

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`
- `reports/outbox/` 下生成的报告
- `reports/state/`、`reports/feedback/` 和 `reports/inbox/` 下的生产状态
- 私人报告，以及 PushPlus、Worker、Codex 或其他 token

公开仓库只包含代码、文档、Schema、测试、Prompt 和示例配置。

## 项目文档

- [MVP Stage 1 记录](docs/mvp-stage-1.md)：初始生产架构与验收。
- [Stage 2 内容质量](docs/stage-2-content-quality.md)：结构化报告、质量规则、上线过程与生产验收。
- [Skill 来源审计](docs/skill-source-audit.md)：来源版图与 artifact 边界。
- [Agent Harness](docs/agent-harness.md)：核验角色、分歧处理和 Harness v2 证据。
- [Harness v2 影子 Prompt](prompts/skill-radar-multi-agent-production-shadow.md)：隔离的生产格式回归测试。
- [产品策略](docs/product-strategy.md)：长期产品、用户、网站和存储方向。
- [事故日志](docs/incident-log.md)：运行事故与后续决策。
- [编码手册](docs/encoding-playbook.md)：投递链路中的 UTF-8 与 PowerShell 经验。
