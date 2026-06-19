# Personal Radar

A lightweight Cloudflare Workers project for scheduled personal information radar channels.

Current MVP channel:

- `skill-radar`: finds broadly useful skills for AI agents, including Codex-native skills, other agent rules/skills, MCP servers, workflow patterns, document/browser automation, and reusable automation projects from public GitHub search.

## What works now

- HTTP endpoint: `GET /run` returns a Markdown report.
- HTTP endpoint: `GET /health` returns a small JSON health check.
- HTTP endpoint: `POST /ingest-report` accepts a protected deep-dive report and forwards it through PushPlus.
- Scheduled handler: Cloudflare Cron can run the same radar job.
- Result classification: each item is labelled as `Codex Skill`, `Other Agent Skill`, `MCP Server`, `Document Skill`, `Agent Workflow`, or `General AI Tool`.
- PushPlus adapter: set `PUSHPLUS_TOKEN` as a Worker secret to send Markdown reports to WeChat through PushPlus.

## Local development

```powershell
npm install
npm run dev
```

Then open:

```text
http://localhost:8787/run
```

## Deployment

```powershell
npm run deploy
```

## PushPlus setup

Set the PushPlus token as a Cloudflare Worker secret:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

Optional channel override:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

If `PUSHPLUS_CHANNEL` is not set, the Worker uses `wechat`.

## Deep report ingest

Create a separate ingest key for Codex automation or another trusted producer:

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Then send a Markdown report through the Worker:

```powershell
Invoke-RestMethod `
  -Uri "https://personal-radar.jiojioyizeradar.workers.dev/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{ title = "Skill Radar Deep Dive"; content = "# Report body" } | ConvertTo-Json)
```

Cloudflare cron schedules use UTC. The current config runs daily at 00:00 UTC, which is 08:00 Beijing time.

## Next extension points

- Add GitHub Issues output if this becomes an open-source project.
- Add Telegram push if Telegram becomes convenient later.
- Add channels such as `ai-tools-radar`, `gamedev-radar`, `paper-radar`, or `design-radar`.
- Add KV-based deduplication and preference scoring.
