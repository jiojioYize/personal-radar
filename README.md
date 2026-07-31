# Personal Radar

[中文版](README.zh.md) | **[English](README.md)**

Personal Radar is a personal information radar for reducing AI-era information
overload. It discovers, verifies, explains, publishes, and delivers a curated
daily report. The first channel, `skill-radar`, focuses on reusable AI-agent
skills, rules, modes, and instruction packs.

## Live Site

<https://radar.dailyingest.cn/>

The public site provides the latest report, historical archives, and Chinese /
English switching for bilingual reports.

## What This Project Does

Personal Radar currently supports two paths:

- **Read the public radar**: browse the published `skill-radar` reports without
  deploying anything.
- **Run your own radar**: configure Codex Automation, a Cloudflare Worker,
  PushPlus, and the local forwarder to generate and deliver your own reports.

The current production system is single-user, single-channel, and local-first.
It is a working MVP rather than a hosted multi-user service.

## Recommended Architecture

```text
Code-generated source plan -> Local Codex Automation
-> source verification and quality decisions
-> reports/outbox -> local forwarder
-> Worker /ingest-report -> KV + public site + PushPlus
```

Codex Automation handles research and report generation. Its shell network
access may fail, so it writes validated local artifacts instead of publishing
directly. A normal Windows PowerShell task runs the forwarder later and handles
network delivery. The Worker stores reports, renders the website, and sends
PushPlus notifications.

## Production Prompt

The formal daily automation reads:

```text
prompts/skill-radar-local.md
```

Suggested Codex Automation instruction:

```text
Please read and execute prompts/skill-radar-local.md.
```

The prompt follows a code-generated rotation across a skill registry,
first-party catalogs, and bounded community sources. Code applies artifact,
history, and review-state constraints. Fresh-context verifier roles check
eligible primary sources, and the main model makes qualitative recommendation
decisions from validated evidence.

Successful runs write:

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

The quality Sidecar is the source of truth. Markdown is generated
deterministically from it.

The standard production flow does not require the optional GitHub collector.
The collector remains available only for bounded evidence experiments:

```powershell
npm run discovery:github
```

See [tools/discovery/README.md](tools/discovery/README.md) for its isolated
data and scheduling rules.

## Local Secret

Create `.secrets.local` in the repository root:

```text
DEEP_REPORT_INGEST_KEY=replace-with-your-ingest-key
```

Do not commit this file. Codex Automation does not need the key. The local
forwarder reads it and must never print it.

## Worker Secrets

Set the required Cloudflare Worker secrets:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Optional:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

## Install And Run Locally

```powershell
npm install
npm run dev
```

Open the health endpoint:

```text
http://localhost:8787/health
```

Production publishing uses `/ingest-report`. The Worker does not search for or
generate reports.

Run the test suite:

```powershell
npm test
```

## Deploy The Worker

```powershell
npm run deploy
```

Cloudflare Cron is disabled by default. Production uses
`PUSHPLUS_TEMPLATE=html`; `markdown` remains a compatibility option.

## Run The Forwarder

The production forwarder requires a matching Markdown and `.quality.json`
pair. It validates their date, item order, and sources before POSTing both to
the Worker.

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

Run it after the Codex Automation schedule. Its local state prevents duplicate
delivery. See
[tools/codex-forwarder/README.md](tools/codex-forwarder/README.md) for Windows
Task Scheduler setup and troubleshooting.

## Publish A Report Manually

The endpoint also accepts a bilingual Markdown report for manual or compatible
clients:

```powershell
Invoke-RestMethod `
  -Uri "https://<your-worker-url>/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive - 2026-06-20"
    contentZh = "# Skill Radar Deep Dive - 2026-06-20`n`nChinese report content"
    contentEn = "# Skill Radar Deep Dive - 2026-06-20`n`nEnglish report content"
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

## Data And Privacy

Do not commit:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`
- generated reports under `reports/outbox/`
- production state under `reports/state/`, `reports/feedback/`, and
  `reports/inbox/`
- private reports or any PushPlus, Worker, Codex, or other tokens

The public repository contains code, documentation, schemas, tests, prompts,
and example configuration.

## Project Documentation

- [MVP Stage 1 Record](docs/mvp-stage-1.md): initial production architecture
  and acceptance.
- [Stage 2 Content Quality](docs/stage-2-content-quality.md): structured
  reports, quality rules, rollout, and production acceptance.
- [Skill Source Audit](docs/skill-source-audit.md): source landscape and
  artifact boundaries.
- [Agent Harness](docs/agent-harness.md): verifier roles, disagreement
  handling, and Harness v2 evidence.
- [Harness v2 Shadow Prompt](prompts/skill-radar-multi-agent-production-shadow.md):
  isolated production-format regression testing.
- [Product Strategy](docs/product-strategy.md): long-term product, user,
  website, and storage direction.
- [Incident Log](docs/incident-log.md): operational incidents and resulting
  decisions.
- [Encoding Playbook](docs/encoding-playbook.md): UTF-8 and PowerShell lessons
  from the delivery chain.
